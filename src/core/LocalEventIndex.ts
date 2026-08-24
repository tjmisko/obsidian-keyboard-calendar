import type { OFCEvent } from "../types";

export interface LocalEventSource {
    sourceId: string;
    directory: string;
}

export interface LocalEventFile {
    path: string;
    handle?: unknown;
}

/** Read boundary used by the single-source local event index. */
export interface LocalEventReadAdapter {
    listFiles(): readonly LocalEventFile[] | Promise<readonly LocalEventFile[]>;
    readEvent(path: string, file?: LocalEventFile): Promise<OFCEvent | null>;
}

export interface LocalEventRecord {
    kind: "local";
    id: string;
    path: string;
    sourceId: string;
    event: OFCEvent;
}

export interface LocalEventIndexSnapshot {
    epoch: number;
    revision: number;
    source: LocalEventSource | null;
    recordsById: ReadonlyMap<string, LocalEventRecord>;
    idByPath: ReadonlyMap<string, string>;
}

export type LocalEventIndexApplyResult = "applied" | "stale";

const cloneEvent = (event: OFCEvent): OFCEvent => {
    const cloned = { ...event } as OFCEvent;
    if (event.categories) cloned.categories = [...event.categories];
    if (event.attendingDates) {
        cloned.attendingDates = [...event.attendingDates];
    }
    if (event.type === "recurring") {
        const recurring = cloned as Extract<OFCEvent, { type: "recurring" }>;
        if (event.daysOfWeek) recurring.daysOfWeek = [...event.daysOfWeek];
        if (event.skipDates) recurring.skipDates = [...event.skipDates];
    } else if (event.type === "rrule" && event.skipDates) {
        (cloned as Extract<OFCEvent, { type: "rrule" }>).skipDates = [
            ...event.skipDates,
        ];
    }
    return cloned;
};

const cloneRecord = (record: LocalEventRecord): LocalEventRecord => ({
    ...record,
    event: cloneEvent(record.event),
});

const freezeEvent = (event: OFCEvent): OFCEvent => {
    const frozen = cloneEvent(event);
    if (frozen.categories) Object.freeze(frozen.categories);
    if (frozen.attendingDates) Object.freeze(frozen.attendingDates);
    if (frozen.type === "recurring") {
        if (frozen.daysOfWeek) Object.freeze(frozen.daysOfWeek);
        if (frozen.skipDates) Object.freeze(frozen.skipDates);
    } else if (frozen.type === "rrule" && frozen.skipDates) {
        Object.freeze(frozen.skipDates);
    }
    return Object.freeze(frozen) as OFCEvent;
};

const storedRecord = (
    source: LocalEventSource,
    path: string,
    id: string,
    event: OFCEvent
): LocalEventRecord =>
    Object.freeze({
        kind: "local" as const,
        id,
        path,
        sourceId: source.sourceId,
        event: freezeEvent(event),
    });

const normalizedDirectory = (directory: string): string =>
    directory.replace(/^\/+|\/+$/g, "");

export const isDirectChildMarkdownPath = (
    directory: string,
    path: string
): boolean => {
    if (!path || path.startsWith("/") || !/\.md$/i.test(path)) {
        return false;
    }
    const normalized = normalizedDirectory(directory);
    if (!normalized) {
        return !path.includes("/");
    }
    const prefix = `${normalized}/`;
    if (!path.startsWith(prefix)) {
        return false;
    }
    const relativePath = path.slice(prefix.length);
    return relativePath.length > 0 && !relativePath.includes("/");
};

/** Collision-safe deterministic ID for the configured source/path tuple. */
export const localEventRecordId = (sourceId: string, path: string): string =>
    `local-event:${encodeURIComponent(sourceId)}:${encodeURIComponent(path)}`;

const localEventRecordIdForEncodedSource = (
    encodedSourceId: string,
    path: string
): string => `local-event:${encodedSourceId}:${encodeURIComponent(path)}`;

/**
 * Runtime index for exactly one configured local source. Full scans build an
 * off-side snapshot and publish only when their source epoch and request tokens
 * are still current.
 */
export class LocalEventIndex {
    private source: LocalEventSource | null;
    private records = new Map<string, LocalEventRecord>();
    private paths = new Map<string, string>();
    private currentEpoch = 0;
    private currentRevision = 0;
    private requestSequence = 0;
    private latestSnapshotRequest = 0;
    private latestMutationRequest = 0;
    private pathRequestTokens = new Map<string, number>();

    constructor(source: LocalEventSource | null) {
        this.source = source ? { ...source } : null;
    }

    get recordsById(): ReadonlyMap<string, LocalEventRecord> {
        return new Map(
            [...this.records].map(([id, record]) => [id, cloneRecord(record)])
        );
    }

    getRecord(id: string): LocalEventRecord | null {
        const record = this.records.get(id);
        return record ? cloneRecord(record) : null;
    }

    getRecords(): LocalEventRecord[] {
        return [...this.records.values()].map(cloneRecord);
    }

    /** Cache-only seam. Stored records and every nested array are frozen. */
    getImmutableRecordsForCache(): readonly Readonly<LocalEventRecord>[] {
        return [...this.records.values()];
    }

    /** Cache-only seam. Stored records and every nested array are frozen. */
    getImmutableRecordForCache(id: string): Readonly<LocalEventRecord> | null {
        return this.records.get(id) || null;
    }

    getIdForPath(path: string): string | null {
        return this.paths.get(path) || null;
    }

    getPathForId(id: string): string | null {
        return this.records.get(id)?.path || null;
    }

    get idByPath(): ReadonlyMap<string, string> {
        return new Map(this.paths);
    }

    get epoch(): number {
        return this.currentEpoch;
    }

    get revision(): number {
        return this.currentRevision;
    }

    get snapshot(): LocalEventIndexSnapshot {
        return {
            epoch: this.currentEpoch,
            revision: this.currentRevision,
            source: this.source ? { ...this.source } : null,
            recordsById: this.recordsById,
            idByPath: this.idByPath,
        };
    }

    reset(source: LocalEventSource | null): void {
        this.currentEpoch += 1;
        this.requestSequence += 1;
        this.latestSnapshotRequest = this.requestSequence;
        this.latestMutationRequest = this.requestSequence;
        this.pathRequestTokens.clear();
        this.source = source ? { ...source } : null;
        this.records.clear();
        this.paths.clear();
        this.currentRevision += 1;
        this.assertInvariants();
    }

    async populate(
        adapter: LocalEventReadAdapter
    ): Promise<LocalEventIndexApplyResult> {
        const source = this.source ? { ...this.source } : null;
        const epoch = this.currentEpoch;
        const request = ++this.requestSequence;
        this.latestSnapshotRequest = request;

        let parsed: Array<{ path: string; event: OFCEvent | null }> = [];
        try {
            const files = source ? await adapter.listFiles() : [];
            const ownedFiles = files
                .filter(({ path }) =>
                    source
                        ? isDirectChildMarkdownPath(source.directory, path)
                        : false
                )
                .sort((left, right) => left.path.localeCompare(right.path));
            for (let index = 1; index < ownedFiles.length; index += 1) {
                if (ownedFiles[index - 1].path === ownedFiles[index].path) {
                    throw new Error(
                        "Duplicate path returned by local event scan."
                    );
                }
            }

            if (source) {
                parsed = await Promise.all(
                    ownedFiles.map(async (file) => ({
                        path: file.path,
                        event: await adapter.readEvent(file.path, file),
                    }))
                );
            }
        } catch (error) {
            if (this.snapshotRequestIsCurrent(epoch, request)) {
                throw error;
            }
            return "stale";
        }

        if (!this.snapshotRequestIsCurrent(epoch, request)) {
            return "stale";
        }

        const records = new Map<string, LocalEventRecord>();
        const paths = new Map<string, string>();
        if (source) {
            const encodedSourceId = encodeURIComponent(source.sourceId);
            for (const { path, event } of parsed) {
                if (!event) {
                    continue;
                }
                const id = localEventRecordIdForEncodedSource(
                    encodedSourceId,
                    path
                );
                if (records.has(id)) {
                    throw new Error(`Duplicate local event ID: ${id}`);
                }
                records.set(id, storedRecord(source, path, id, event));
                paths.set(path, id);
            }
        }

        this.records = records;
        this.paths = paths;
        this.currentRevision += 1;
        this.assertSizes();
        return "applied";
    }

    async refresh(
        path: string,
        adapter: LocalEventReadAdapter,
        file?: LocalEventFile
    ): Promise<LocalEventIndexApplyResult> {
        const source = this.source ? { ...this.source } : null;
        if (!source || !isDirectChildMarkdownPath(source.directory, path)) {
            return "applied";
        }
        const epoch = this.currentEpoch;
        const request = ++this.requestSequence;
        this.latestMutationRequest = request;
        this.pathRequestTokens.set(path, request);

        let event: OFCEvent | null;
        try {
            event = await adapter.readEvent(path, file);
        } catch (error) {
            if (this.requestIsCurrent(epoch, path, request)) {
                throw error;
            }
            return "stale";
        }
        if (!this.requestIsCurrent(epoch, path, request)) {
            return "stale";
        }

        this.removePath(path);
        if (event) {
            const id = localEventRecordId(source.sourceId, path);
            this.records.set(id, storedRecord(source, path, id, event));
            this.paths.set(path, id);
        }
        this.currentRevision += 1;
        this.assertIncrementalRecord(path);
        return "applied";
    }

    async rename(
        oldPath: string,
        newPath: string,
        adapter: LocalEventReadAdapter,
        file?: LocalEventFile
    ): Promise<LocalEventIndexApplyResult> {
        this.deletePath(oldPath);
        return this.refresh(newPath, adapter, file);
    }

    /** Invalidate any pending read for an owned path without changing records. */
    invalidatePath(path: string): boolean {
        if (!this.owns(path)) {
            return false;
        }
        const request = ++this.requestSequence;
        this.latestMutationRequest = request;
        this.pathRequestTokens.set(path, request);
        return true;
    }

    /** Publish a value already known to have been persisted successfully. */
    commit(path: string, event: OFCEvent | null): boolean {
        if (!this.invalidatePath(path) || !this.source) {
            return false;
        }
        this.removePath(path);
        if (event) {
            const id = localEventRecordId(this.source.sourceId, path);
            this.records.set(id, storedRecord(this.source, path, id, event));
            this.paths.set(path, id);
        }
        this.currentRevision += 1;
        this.assertIncrementalRecord(path);
        return true;
    }

    /**
     * Publish an already-persisted rename as one index revision. The old path is
     * removed even when the destination falls outside the configured source.
     */
    commitRename(
        oldPath: string,
        newPath: string,
        event: OFCEvent | null
    ): boolean {
        const oldOwned = this.owns(oldPath);
        const newOwned = this.owns(newPath);
        if (!oldOwned && !newOwned) {
            return false;
        }
        const request = ++this.requestSequence;
        this.latestMutationRequest = request;
        if (oldOwned) {
            this.pathRequestTokens.set(oldPath, request);
            this.removePath(oldPath);
        }
        if (newOwned) {
            this.pathRequestTokens.set(newPath, request);
            this.removePath(newPath);
            if (event && this.source) {
                const id = localEventRecordId(this.source.sourceId, newPath);
                this.records.set(
                    id,
                    storedRecord(this.source, newPath, id, event)
                );
                this.paths.set(newPath, id);
            }
        }
        this.currentRevision += 1;
        this.assertIncrementalRecord(newPath);
        return true;
    }

    deletePath(path: string): boolean {
        if (!this.owns(path)) {
            return false;
        }
        const request = ++this.requestSequence;
        this.latestMutationRequest = request;
        this.pathRequestTokens.set(path, request);
        const removed = this.removePath(path);
        if (removed) {
            this.currentRevision += 1;
            this.assertSizes();
        }
        return removed;
    }

    assertInvariants(): void {
        if (this.records.size !== this.paths.size) {
            throw new Error("Local event record/path index sizes differ.");
        }
        if (!this.source && this.records.size > 0) {
            throw new Error("Local event records exist without a source.");
        }
        for (const [id, record] of this.records) {
            if (
                id !== record.id ||
                !this.source ||
                record.sourceId !== this.source.sourceId ||
                !isDirectChildMarkdownPath(
                    this.source.directory,
                    record.path
                ) ||
                id !== localEventRecordId(record.sourceId, record.path) ||
                this.paths.get(record.path) !== id
            ) {
                throw new Error(`Invalid local event record invariant: ${id}`);
            }
        }
        for (const [path, id] of this.paths) {
            if (this.records.get(id)?.path !== path) {
                throw new Error(`Invalid local path index invariant: ${path}`);
            }
        }
    }

    private requestIsCurrent(
        epoch: number,
        path: string,
        request: number
    ): boolean {
        return (
            epoch === this.currentEpoch &&
            this.pathRequestTokens.get(path) === request &&
            this.latestSnapshotRequest <= request
        );
    }

    private snapshotRequestIsCurrent(epoch: number, request: number): boolean {
        return (
            epoch === this.currentEpoch &&
            request === this.latestSnapshotRequest &&
            this.latestMutationRequest <= request
        );
    }

    private owns(path: string): boolean {
        return !!(
            this.source &&
            isDirectChildMarkdownPath(this.source.directory, path)
        );
    }

    private assertIncrementalRecord(path: string): void {
        this.assertSizes();
        const id = this.paths.get(path);
        if (!id) return;
        const record = this.records.get(id);
        if (
            !record ||
            id !== record.id ||
            !this.source ||
            record.sourceId !== this.source.sourceId ||
            !isDirectChildMarkdownPath(this.source.directory, record.path) ||
            id !== localEventRecordId(record.sourceId, record.path) ||
            record.path !== path
        ) {
            throw new Error(`Invalid local event record invariant: ${id}`);
        }
    }

    private assertSizes(): void {
        if (this.records.size !== this.paths.size) {
            throw new Error("Local event record/path index sizes differ.");
        }
    }

    private removePath(path: string): boolean {
        const id = this.paths.get(path);
        if (!id) {
            return false;
        }
        this.paths.delete(path);
        this.records.delete(id);
        return true;
    }
}
