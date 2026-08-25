import { OFCEvent, parseEvent } from "../types";
import { CALENDAR_CELL_MINUTES } from "./cell_navigation";
import { dateEndpointsToFrontmatter } from "./interop";

export interface CalendarEventClipboard {
    event: OFCEvent;
    durationMs: number;
    copiedBasename: string;
}

const cloneEvent = (event: OFCEvent): OFCEvent =>
    parseEvent(JSON.parse(JSON.stringify(event)));

export const copiedEventBasename = (path: string): string => {
    const filename = path.slice(path.lastIndexOf("/") + 1);
    const basename = filename.replace(/\.md$/i, "");
    return `${basename || "Untitled event"} (copied event)`;
};

export function createCalendarEventClipboard(
    event: OFCEvent,
    path: string,
    start: Date,
    end: Date
): CalendarEventClipboard {
    return {
        event: cloneEvent(event),
        durationMs: Math.max(
            CALENDAR_CELL_MINUTES * 60 * 1000,
            end.getTime() - start.getTime()
        ),
        copiedBasename: copiedEventBasename(path),
    };
}

/** Materializes a yanked rendered occurrence as a new single timed event. */
export function pasteCalendarEvent(
    clipboard: CalendarEventClipboard,
    start: Date
): OFCEvent {
    const end = new Date(start.getTime() + clipboard.durationMs);
    return parseEvent({
        title: clipboard.copiedBasename,
        type: "single",
        ...(clipboard.event.categories
            ? { categories: [...clipboard.event.categories] }
            : {}),
        ...dateEndpointsToFrontmatter(start, end),
    });
}
