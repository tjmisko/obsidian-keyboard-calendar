import { TFile, TFolder } from "obsidian";
import { EventPathLocation } from "../core/EventStore";
import { ObsidianInterface } from "../ObsidianAdapter";
import { OFCEvent, EventLocation } from "../types";
import { EditableCalendar, EditableEventResponse } from "./EditableCalendar";
import {
    parseRetendFile,
    parseRetendSlots,
    serializeRetendFile,
    emptyRetendFile,
    writeEventToSlots,
    clearSlots,
    timeToSlotIndex,
    dateFromFilename,
    isEmptySlot,
    RetendEvent,
} from "./parsing/retend";

function retendEventToOFCEvent(event: RetendEvent, filePath: string): OFCEvent {
    return {
        title: event.title,
        type: "single",
        allDay: false,
        startTime: event.startTime,
        endTime: event.endTime,
        date: event.date,
        endDate: null,
        category: event.category,
        id: `retend::${event.date}::${event.startTime}`,
    };
}

export default class RetendCalendar extends EditableCalendar {
    app: ObsidianInterface;
    private _directory: string;

    constructor(app: ObsidianInterface, color: string, directory: string) {
        super(color);
        this.app = app;
        this._directory = directory;
    }

    get directory(): string {
        return this._directory;
    }

    get type(): "retend" {
        return "retend";
    }

    get identifier(): string {
        return this.directory;
    }

    get name(): string {
        return `Retend (${this.directory})`;
    }

    containsPath(path: string): boolean {
        return path.startsWith(this.directory) && path.endsWith(".retend");
    }

    async getEventsInFile(file: TFile): Promise<EditableEventResponse[]> {
        if (!file.path.endsWith(".retend")) {
            return [];
        }
        const contents = await this.app.read(file);
        const events = parseRetendFile(contents);
        return events.map((event) => [
            retendEventToOFCEvent(event, file.path),
            { file, lineNumber: event.startLine },
        ]);
    }

    async getEvents(): Promise<EditableEventResponse[]> {
        const folder = this.app.getAbstractFileByPath(this.directory);
        if (!folder || !(folder instanceof TFolder)) {
            return [];
        }

        const results: EditableEventResponse[] = [];
        for (const child of folder.children) {
            if (child instanceof TFile && child.path.endsWith(".retend")) {
                const events = await this.getEventsInFile(child);
                results.push(...events);
            }
        }
        return results;
    }

    async createEvent(event: OFCEvent): Promise<EventLocation> {
        if (event.type !== "single" || event.allDay) {
            throw new Error(
                "Retend calendar only supports timed single events."
            );
        }

        const date = event.date;
        const filePath = `${this.directory}/${date}.retend`;
        let file = this.app.getFileByPath(filePath);

        if (!file) {
            file = await this.app.create(filePath, emptyRetendFile(date));
        }

        const startIdx = timeToSlotIndex(event.startTime);
        const endIdx = event.endTime
            ? timeToSlotIndex(event.endTime) - 1
            : startIdx;

        const category = event.category || "";
        const title = event.title;

        await this.app.rewrite(file, (contents) => {
            const slots = parseRetendSlots(contents);
            const modified = writeEventToSlots(
                slots,
                startIdx,
                Math.max(startIdx, endIdx),
                category,
                title
            );
            return serializeRetendFile(modified);
        });

        return { file, lineNumber: startIdx };
    }

    async deleteEvent(location: EventPathLocation): Promise<void> {
        const { path, lineNumber } = location;
        const file = this.app.getFileByPath(path);
        if (!file) {
            throw new Error(`File ${path} not found.`);
        }
        if (lineNumber === undefined) {
            throw new Error(
                "Retend events require a line number for deletion."
            );
        }

        await this.app.rewrite(file, (contents) => {
            const slots = parseRetendSlots(contents);
            const startSlot = slots[lineNumber];
            if (!startSlot || isEmptySlot(startSlot)) {
                return contents;
            }

            const { category, title } = startSlot;
            // Walk forward to find the end of this merged block
            let endIdx = lineNumber;
            while (
                endIdx + 1 < slots.length &&
                slots[endIdx + 1].category === category &&
                slots[endIdx + 1].title === title
            ) {
                endIdx++;
            }

            const cleared = clearSlots(slots, lineNumber, endIdx);
            return serializeRetendFile(cleared);
        });
    }

    async modifyEvent(
        location: EventPathLocation,
        newEvent: OFCEvent,
        updateCacheWithLocation: (loc: EventLocation) => void
    ): Promise<void> {
        if (newEvent.type !== "single" || newEvent.allDay) {
            throw new Error(
                "Retend calendar only supports timed single events."
            );
        }

        const { path, lineNumber } = location;
        const oldFile = this.app.getFileByPath(path);
        if (!oldFile) {
            throw new Error(`File ${path} not found.`);
        }

        const oldDate = dateFromFilename(oldFile.name);
        const newDate = newEvent.date;

        if (oldDate && oldDate !== newDate) {
            // Date changed: delete from old file, create in new file
            await this.deleteEvent(location);
            const newLocation = await this.createEvent(newEvent);
            updateCacheWithLocation(newLocation);
            return;
        }

        // Same date: clear old block, write new block
        const newStartIdx = timeToSlotIndex(newEvent.startTime);
        const newEndIdx = newEvent.endTime
            ? timeToSlotIndex(newEvent.endTime) - 1
            : newStartIdx;

        const newLocation: EventLocation = {
            file: { path },
            lineNumber: newStartIdx,
        };
        updateCacheWithLocation(newLocation);

        await this.app.rewrite(oldFile, (contents) => {
            let slots = parseRetendSlots(contents);

            // Clear old block
            if (lineNumber !== undefined) {
                const startSlot = slots[lineNumber];
                if (startSlot && !isEmptySlot(startSlot)) {
                    const { category, title } = startSlot;
                    let endIdx = lineNumber;
                    while (
                        endIdx + 1 < slots.length &&
                        slots[endIdx + 1].category === category &&
                        slots[endIdx + 1].title === title
                    ) {
                        endIdx++;
                    }
                    slots = clearSlots(slots, lineNumber, endIdx);
                }
            }

            // Write new block
            slots = writeEventToSlots(
                slots,
                newStartIdx,
                Math.max(newStartIdx, newEndIdx),
                newEvent.category || "",
                newEvent.title
            );

            return serializeRetendFile(slots);
        });
    }
}
