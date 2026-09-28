/** Where a day peek opens when the day has no timed events. */
export const DEFAULT_DAY_PEEK_SCROLL_MINUTES = 8 * 60;
/** Lead-in above the day's first event, so it does not sit on the edge. */
const DAY_PEEK_LEAD_MINUTES = 30;
const SNAP_MINUTES = 15;

export interface DayPeekEventSpan {
    start: Date | null;
    end: Date | null;
    allDay: boolean;
}

const pad = (value: number): string => value.toString().padStart(2, "0");

export const formatScrollTime = (minutes: number): string =>
    `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}:00`;

/**
 * FullCalendar scroll time for a day peek: just above the day's first timed
 * event, snapped to a quarter hour, or the morning when the day is empty. An
 * event that began the previous day counts from midnight.
 */
export const getDayPeekScrollTime = (
    events: readonly DayPeekEventSpan[],
    day: Date
): string => {
    const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate());
    const dayEnd = new Date(
        day.getFullYear(),
        day.getMonth(),
        day.getDate() + 1
    );
    let earliest: number | null = null;
    for (const { start, end, allDay } of events) {
        if (allDay || !start || Number.isNaN(start.getTime())) {
            continue;
        }
        const effectiveEnd = end && end > start ? end : start;
        const overlapsDay =
            start < dayEnd &&
            (effectiveEnd > dayStart || start.getTime() === dayStart.getTime());
        if (!overlapsDay) {
            continue;
        }
        const minutes =
            start <= dayStart ? 0 : start.getHours() * 60 + start.getMinutes();
        earliest = earliest === null ? minutes : Math.min(earliest, minutes);
    }
    if (earliest === null) {
        return formatScrollTime(DEFAULT_DAY_PEEK_SCROLL_MINUTES);
    }
    const leadIn = Math.max(0, earliest - DAY_PEEK_LEAD_MINUTES);
    return formatScrollTime(Math.floor(leadIn / SNAP_MINUTES) * SNAP_MINUTES);
};
