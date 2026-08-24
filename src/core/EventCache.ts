import { TFile } from "obsidian";

import FullNoteCalendar, {
    FullNoteEventLocation,
} from "../calendars/FullNoteCalendar";
import { CalendarInfo, OFCEvent } from "../types";
import { LocalEventIndex, LocalEventRecord } from "./LocalEventIndex";

export type LocalCalendarInitializer = (info: CalendarInfo) => FullNoteCalendar;

export type CacheEntry = { event: OFCEvent; id: string; sourceId: string };

export type UpdateViewCallback = (
    info:
        | {
              type: "events";
              toRemove: string[];
              toAdd: CacheEntry[];
          }
        | { type: "resync" }
) => void;

const eventsEqual = (left: OFCEvent, right: OFCEvent): boolean => {
    const leftKeys = Object.keys(left) as Array<keyof OFCEvent>;
    const rightKeys = Object.keys(right) as Array<keyof OFCEvent>;
    if (leftKeys.length !== rightKeys.length) return false;
    return leftKeys.every((key) => {
        if (!Object.prototype.hasOwnProperty.call(right, key)) return false;
        const leftValue = left[key];
        const rightValue = right[key];
        if (Array.isArray(leftValue) && Array.isArray(rightValue)) {
            return (
                leftValue.length === rightValue.length &&
                leftValue.every((value, index) => value === rightValue[index])
            );
        }
        return leftValue === rightValue;
    });
};

export type CachedEvent = Pick<LocalEventRecord, "event" | "id">;

export type OFCEventSource = {
    events: CachedEvent[];
    editable: boolean;
    color: string;
    id: string;
};

interface MutationGuard {
    paths: Set<string>;
    queuedCallbacks: SuppressedVaultCallback[];
}

type SuppressedVaultCallback =
    | { type: "changed"; path: string }
    | { type: "deleted"; path: string }
    | { type: "renamed"; oldPath: string; newPath: string };

/** Runtime coordinator for the single configured full-note source. */
export default class EventCache {
    private createLocalCalendar: LocalCalendarInitializer;
    private calendar: FullNoteCalendar | null = null;
    private index = new LocalEventIndex(null);
    private publishedRecordsById = new Map<string, LocalEventRecord>();
    private publishedIdByPath = new Map<string, string>();
    private updateViewCallbacks: UpdateViewCallback[] = [];
    private activeMutationsByPath = new Map<string, MutationGuard>();
    private population: { epoch: number; promise: Promise<void> } | null = null;
    initialized = false;

    constructor(createLocalCalendar: LocalCalendarInitializer) {
        this.createLocalCalendar = createLocalCalendar;
    }

    reset(infos: CalendarInfo[]): void {
        this.initialized = false;
        this.population = null;
        const source = infos.find((info) => info.type === "local") || null;
        this.calendar = source ? this.createLocalCalendar(source) : null;
        const calendar = this.calendar;
        this.index.reset(
            calendar
                ? { sourceId: calendar.id, directory: calendar.directory }
                : null
        );
        this.establishPublicationBaseline();
        this.resync();
    }

    populate(): Promise<void> {
        const calendar = this.calendar;
        if (!calendar) {
            this.initialized = true;
            return Promise.resolve();
        }
        const epoch = this.index.epoch;
        if (this.population?.epoch === epoch) {
            return this.population.promise;
        }
        let promise: Promise<void>;
        promise = this.populateEpoch(calendar, epoch).finally(() => {
            if (this.population?.promise === promise) {
                this.population = null;
            }
        });
        this.population = { epoch, promise };
        return promise;
    }

    private async populateEpoch(
        calendar: FullNoteCalendar,
        epoch: number
    ): Promise<void> {
        while (epoch === this.index.epoch) {
            const result = await this.index.populate(calendar);
            if (result === "applied") {
                if (epoch === this.index.epoch) {
                    this.initialized = true;
                    this.establishPublicationBaseline();
                }
                return;
            }
        }
        await this.populate();
    }

    resync(): void {
        for (const callback of [...this.updateViewCallbacks]) {
            try {
                callback({ type: "resync" });
            } catch (error) {
                console.error(
                    "Keyboard Calendar cache subscriber failed",
                    error
                );
            }
        }
    }

    getAllEvents(): OFCEventSource[] {
        const calendar = this.calendar;
        if (!calendar) return [];
        const events = this.index
            .getImmutableRecordsForCache()
            .map(({ event, id }) => ({ event, id }));
        return [
            {
                editable: true,
                events,
                color: calendar.color,
                id: calendar.id,
            },
        ];
    }

    getEventById(id: string): OFCEvent | null {
        return this.index.getRecord(id)?.event || null;
    }

    hasLocalCalendar(): boolean {
        return this.calendar !== null;
    }

    getInfoForFullNoteEvent(eventId: string): {
        location: { path: string };
    } | null {
        const path = this.index.getPathForId(eventId);
        if (!path) return null;
        return {
            location: { path },
        };
    }

    on(eventType: "update", callback: UpdateViewCallback): UpdateViewCallback {
        if (eventType === "update") this.updateViewCallbacks.push(callback);
        return callback;
    }

    off(eventType: "update", callback: UpdateViewCallback): void {
        if (eventType !== "update") return;
        const index = this.updateViewCallbacks.indexOf(callback);
        if (index >= 0) this.updateViewCallbacks.splice(index, 1);
    }

    async createEvent(event: OFCEvent): Promise<FullNoteEventLocation> {
        const calendar = this.calendar;
        if (!calendar) throw new Error("Local event source is not registered.");
        const plannedPath = calendar.getNewEventPath();
        const mutation = this.acquireMutationPaths([plannedPath]);
        const mutationEpoch = this.index.epoch;
        let released = false;
        try {
            const persisted = await calendar.createEvent(event, plannedPath);
            const { location, event: persistedEvent } = persisted;
            const finalPath = location.file.path;
            if (finalPath !== plannedPath || !calendar.hasFile(finalPath)) {
                throw new Error(
                    `Created event note was not found at ${finalPath}.`
                );
            }
            if (mutationEpoch !== this.index.epoch) {
                this.releaseMutation(mutation);
                released = true;
                await this.reconcileMutationPaths([
                    ...mutation.paths,
                    finalPath,
                ]);
                return location;
            }
            this.index.commit(finalPath, persistedEvent);
            this.publishTouched([finalPath]);
            if (mutation.queuedCallbacks.length > 0) {
                this.releaseMutation(mutation);
                released = true;
                await this.drainSuppressedCallbacks(mutation);
            }
            return location;
        } catch (error) {
            this.releaseMutation(mutation);
            released = true;
            await this.reconcileMutationPaths([...mutation.paths, plannedPath]);
            throw error;
        } finally {
            if (!released) this.releaseMutation(mutation);
        }
    }

    async updateEventWithId(
        eventId: string,
        newEvent: OFCEvent
    ): Promise<boolean> {
        const oldRecord = this.index.getRecord(eventId);
        const info = this.getInfoForFullNoteEvent(eventId);
        const calendar = this.calendar;
        if (!info || !calendar) throw new Error("Event does not exist");
        const { location } = info;
        if (!oldRecord) throw new Error("Event does not exist");
        const persistedEvent = this.mergePersistedMetadata(
            oldRecord.event,
            newEvent
        );
        const oldPath = location.path;
        const plannedPath = calendar.getNewLocation(location, persistedEvent)
            .file.path;
        const mutationPaths = [...new Set([oldPath, plannedPath])];
        const mutation = this.acquireMutationPaths(mutationPaths);
        const mutationEpoch = this.index.epoch;
        let released = false;
        try {
            const persisted = await calendar.modifyEvent(
                location,
                persistedEvent
            );
            const { location: finalLocation, event: diskEvent } = persisted;
            const finalPath = finalLocation.file.path;
            if (finalPath !== plannedPath || !calendar.hasFile(finalPath)) {
                throw new Error(
                    `Updated event note was not found at ${finalPath}.`
                );
            }
            if (mutationEpoch !== this.index.epoch) {
                this.releaseMutation(mutation);
                released = true;
                await this.reconcileMutationPaths([
                    ...mutation.paths,
                    oldPath,
                    finalPath,
                ]);
                return true;
            }
            this.index.commitRename(oldPath, finalPath, diskEvent);
            this.publishTouched([oldPath, finalPath]);
            if (mutation.queuedCallbacks.length > 0) {
                this.releaseMutation(mutation);
                released = true;
                await this.drainSuppressedCallbacks(mutation);
            }
            return true;
        } catch (error) {
            this.releaseMutation(mutation);
            released = true;
            await this.reconcileMutationPaths([...mutation.paths]);
            throw error;
        } finally {
            if (!released) this.releaseMutation(mutation);
        }
    }

    processEvent(
        id: string,
        process: (event: OFCEvent) => OFCEvent
    ): Promise<boolean> {
        const event = this.getEventById(id);
        if (!event) throw new Error("Event does not exist");
        return this.updateEventWithId(id, process(event));
    }

    async fileUpdated(file: TFile): Promise<void> {
        if (
            this.queueSuppressedCallback({ type: "changed", path: file.path }, [
                file.path,
            ])
        ) {
            return;
        }
        const calendar = this.calendar;
        if (!calendar) return;
        try {
            await this.index.refresh(file.path, calendar, {
                path: file.path,
                handle: file,
            });
        } finally {
            this.publishTouched([file.path]);
        }
    }

    async fileRenamed(file: TFile, oldPath: string): Promise<void> {
        const calendar = this.calendar;
        if (!calendar) return;
        calendar.fileRenamed(oldPath, file.path);
        if (
            this.queueSuppressedCallback(
                { type: "renamed", oldPath, newPath: file.path },
                [oldPath, file.path]
            )
        ) {
            return;
        }
        try {
            await this.index.rename(oldPath, file.path, calendar, {
                path: file.path,
                handle: file,
            });
        } finally {
            this.publishTouched([oldPath, file.path]);
        }
    }

    fileDeleted(path: string): void {
        if (this.queueSuppressedCallback({ type: "deleted", path }, [path])) {
            return;
        }
        this.index.deletePath(path);
        this.publishTouched([path]);
    }

    private acquireMutationPaths(paths: string[]): MutationGuard {
        if (paths.some((path) => this.activeMutationsByPath.has(path))) {
            throw new Error("An event note mutation is already in progress.");
        }
        const mutation: MutationGuard = {
            paths: new Set(paths),
            queuedCallbacks: [],
        };
        mutation.paths.forEach((path) => {
            this.activeMutationsByPath.set(path, mutation);
            this.index.invalidatePath(path);
        });
        return mutation;
    }

    private releaseMutation(mutation: MutationGuard): void {
        mutation.paths.forEach((path) => {
            if (this.activeMutationsByPath.get(path) === mutation) {
                this.activeMutationsByPath.delete(path);
            }
        });
    }

    private queueSuppressedCallback(
        callback: SuppressedVaultCallback,
        paths: string[]
    ): boolean {
        const mutations = new Set(
            paths.flatMap((path) => {
                const mutation = this.activeMutationsByPath.get(path);
                return mutation ? [mutation] : [];
            })
        );
        if (mutations.size === 0) return false;
        for (const mutation of mutations) {
            mutation.queuedCallbacks.push(callback);
            for (const path of paths) {
                mutation.paths.add(path);
                if (!this.activeMutationsByPath.has(path)) {
                    this.activeMutationsByPath.set(path, mutation);
                }
            }
        }
        return true;
    }

    private async drainSuppressedCallbacks(
        mutation: MutationGuard
    ): Promise<void> {
        const paths = mutation.queuedCallbacks.flatMap((callback) => {
            switch (callback.type) {
                case "changed":
                case "deleted":
                    return [callback.path];
                case "renamed":
                    return [callback.oldPath, callback.newPath];
            }
        });
        await this.reconcileMutationPaths(paths);
    }

    private async reconcileMutationPaths(paths: string[]): Promise<void> {
        const calendar = this.calendar;
        if (!calendar) return;
        const epoch = this.index.epoch;
        const uniquePaths = [...new Set(paths)];
        uniquePaths.forEach((path) => this.index.commit(path, null));
        const diskAdapter = {
            listFiles: () => calendar.listFiles(),
            readEvent: (path: string) => calendar.readEventFromDisk(path),
        };
        for (const path of uniquePaths) {
            if (epoch !== this.index.epoch) break;
            try {
                await this.index.refresh(path, diskAdapter);
            } catch (error) {
                console.error(
                    `Could not reconcile event note ${path} from disk`,
                    error
                );
            }
        }
        this.publishTouched(uniquePaths);
    }

    private mergePersistedMetadata(
        previous: OFCEvent,
        requested: OFCEvent
    ): OFCEvent {
        const merged = { ...requested } as OFCEvent;
        if (previous.id === undefined) {
            delete merged.id;
        } else {
            merged.id = previous.id;
        }
        if (previous.categories === undefined) {
            delete merged.categories;
        } else {
            merged.categories = [...previous.categories];
        }
        if (previous.attendingDates === undefined) {
            delete merged.attendingDates;
        } else {
            merged.attendingDates = [...previous.attendingDates];
        }
        if (merged.type === "single") {
            if (
                previous.type === "single" &&
                previous.completed !== undefined
            ) {
                merged.completed = previous.completed;
            } else {
                delete merged.completed;
            }
        }
        return merged;
    }

    private establishPublicationBaseline(): void {
        this.publishedRecordsById.clear();
        this.publishedIdByPath.clear();
        for (const record of this.index.getImmutableRecordsForCache()) {
            this.publishedRecordsById.set(record.id, record);
            this.publishedIdByPath.set(record.path, record.id);
        }
    }

    private publishTouched(paths: string[]): void {
        const toRemove = new Set<string>();
        const toAdd: CacheEntry[] = [];
        for (const path of new Set(paths)) {
            const previousId = this.publishedIdByPath.get(path);
            const previous = previousId
                ? this.publishedRecordsById.get(previousId)
                : undefined;
            const currentId = this.index.getIdForPath(path);
            const current = currentId
                ? this.index.getImmutableRecordForCache(currentId)
                : null;

            if (
                previous &&
                (!current ||
                    current.id !== previous.id ||
                    !eventsEqual(previous.event, current.event))
            ) {
                toRemove.add(previous.id);
            }
            if (
                current &&
                (!previous ||
                    previous.id !== current.id ||
                    !eventsEqual(previous.event, current.event))
            ) {
                const publicRecord = this.index.getRecord(current.id);
                if (!publicRecord) {
                    throw new Error(
                        `Event ${current.id} disappeared during publication.`
                    );
                }
                toAdd.push({
                    id: publicRecord.id,
                    event: publicRecord.event,
                    sourceId: publicRecord.sourceId,
                });
            }

            if (previousId) {
                this.publishedRecordsById.delete(previousId);
                this.publishedIdByPath.delete(path);
            }
            if (current) {
                this.publishedRecordsById.set(current.id, current);
                this.publishedIdByPath.set(path, current.id);
            }
        }
        if (toRemove.size > 0 || toAdd.length > 0) {
            this.updateViews([...toRemove], toAdd);
        }
    }

    private updateViews(toRemove: string[], toAdd: CacheEntry[]): void {
        for (const callback of [...this.updateViewCallbacks]) {
            try {
                callback({
                    type: "events",
                    toRemove: [...toRemove],
                    toAdd: toAdd.map(({ id, sourceId, event }) => ({
                        id,
                        sourceId,
                        event: {
                            ...event,
                            ...(event.categories
                                ? { categories: [...event.categories] }
                                : {}),
                            ...(event.attendingDates
                                ? {
                                      attendingDates: [...event.attendingDates],
                                  }
                                : {}),
                            ...(event.type === "recurring"
                                ? {
                                      ...(event.daysOfWeek
                                          ? {
                                                daysOfWeek: [
                                                    ...event.daysOfWeek,
                                                ],
                                            }
                                          : {}),
                                      ...(event.skipDates
                                          ? {
                                                skipDates: [...event.skipDates],
                                            }
                                          : {}),
                                  }
                                : event.type === "rrule" && event.skipDates
                                ? { skipDates: [...event.skipDates] }
                                : {}),
                        },
                    })),
                });
            } catch (error) {
                console.error(
                    "Keyboard Calendar cache subscriber failed",
                    error
                );
            }
        }
    }
}
