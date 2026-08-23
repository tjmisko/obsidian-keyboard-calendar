import { OFCEvent } from "../types";

export interface CalendarEventContextAction {
    title: "Omit this occurrence";
    disabled: boolean;
    run: () => Promise<void>;
}

/**
 * The complete lean context-menu surface. Only recurring, local full-note
 * events expose an action; opening stays on ordinary click and deletion has no
 * calendar route.
 */
export function getCalendarEventContextActions({
    event,
    isLocalFullNote,
    occurrenceDate,
    omit,
}: {
    event: OFCEvent;
    isLocalFullNote: boolean;
    occurrenceDate: string | null;
    omit: (date: string) => Promise<void>;
}): CalendarEventContextAction[] {
    if (!isLocalFullNote || event.type === "single") {
        return [];
    }
    return [
        {
            title: "Omit this occurrence",
            disabled: !occurrenceDate,
            run: occurrenceDate
                ? () => omit(occurrenceDate)
                : async () => undefined,
        },
    ];
}
