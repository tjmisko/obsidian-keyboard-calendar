import { TFile } from "obsidian";
import { EventPathLocation } from "src/core/EventStore";
import { EventLocation, OFCEvent } from "src/types";
import { Calendar } from "./Calendar";

export type EditableEventResponse = [OFCEvent, EventLocation];

export interface PersistedEventWrite {
    location: EventLocation;
    event: OFCEvent;
}

/**
 * Abstract class representing the interface for an Calendar whose source-of-truth
 * is the Obsidian Vault.
 *
 * EditableCalendar instances handle all file I/O, typically through an ObsidianInterface.
 * The EventCache will call methods on an EditableCalendar to make updates to the Vault from user action, as well
 * as to parse events from files when the files are updated outside of Full Calendar.
 */
export abstract class EditableCalendar extends Calendar {
    constructor(color: string) {
        super(color);
    }

    /**
     * Directory where events for this calendar are stored.
     */
    abstract get directory(): string;

    /**
     * Returns true if this calendar sources events from the given path.
     */
    containsPath(path: string): boolean {
        const directory = this.directory.replace(/\/$/, "");
        if (!directory) {
            return true;
        }
        return path === directory || path.startsWith(`${directory}/`);
    }

    /**
     * Get all events in a given file.
     * @param file File to parse
     */
    abstract getEventsInFile(file: TFile): Promise<EditableEventResponse[]>;

    /**
     * Create an event in this calendar.
     * @param event Event to create.
     */
    abstract createEvent(event: OFCEvent): Promise<PersistedEventWrite>;

    /**
     * Modify an event on disk.
     *
     * @param location Location of event
     * @param newEvent New event details
     * @returns The final location and exact persisted event semantics after all
     * file operations succeed.
     */
    abstract modifyEvent(
        location: EventPathLocation,
        newEvent: OFCEvent
    ): Promise<PersistedEventWrite>;
}
