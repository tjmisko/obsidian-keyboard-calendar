import { OFCEvent } from "../types";
import { eventHasGhostTag } from "../settings/tag_settings";

export interface CalendarEventContextAction {
    title: string;
    icon: string;
    disabled: boolean;
    separatorBefore?: boolean;
    run: () => void | Promise<void>;
}

export const canOmitEventOccurrence = (
    event: OFCEvent,
    isLocalFullNote: boolean,
    occurrenceDate: string | null
): boolean =>
    isLocalFullNote && event.type !== "single" && occurrenceDate !== null;

export const canAttendEventOccurrence = (
    event: OFCEvent,
    isLocalFullNote: boolean,
    occurrenceDate: string | null,
    ghostEventTags: readonly string[]
): boolean =>
    isLocalFullNote &&
    occurrenceDate !== null &&
    eventHasGhostTag(event.categories, ghostEventTags) &&
    !event.attendingDates?.includes(occurrenceDate);

/** Builds the complete event context menu without coupling it to Obsidian UI. */
export function getCalendarEventContextActions({
    event,
    isLocalFullNote,
    occurrenceDate,
    ghostEventTags,
    omit,
    attend,
    deleteEvent,
}: {
    event: OFCEvent;
    isLocalFullNote: boolean;
    occurrenceDate: string | null;
    ghostEventTags: readonly string[];
    omit: (date: string) => Promise<void>;
    attend: (date: string) => Promise<void>;
    deleteEvent: () => void;
}): CalendarEventContextAction[] {
    const actions: CalendarEventContextAction[] = [];
    const isGhostedOccurrence =
        eventHasGhostTag(event.categories, ghostEventTags) &&
        !(occurrenceDate && event.attendingDates?.includes(occurrenceDate));

    if (isLocalFullNote && isGhostedOccurrence) {
        actions.push({
            title: "Attend this occurrence",
            icon: "calendar-check",
            disabled: !occurrenceDate,
            run: occurrenceDate
                ? () => attend(occurrenceDate)
                : async () => undefined,
        });
    }

    if (isLocalFullNote && event.type !== "single") {
        actions.push({
            title: "Omit this occurrence",
            icon: "calendar-x",
            disabled: !occurrenceDate,
            run: occurrenceDate
                ? () => omit(occurrenceDate)
                : async () => undefined,
        });
    }

    actions.push({
        title: "Delete event",
        icon: "trash",
        disabled: false,
        separatorBefore: actions.length > 0,
        run: deleteEvent,
    });
    return actions;
}
