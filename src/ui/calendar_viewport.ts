/**
 * The calendar's viewport — which period it shows, how far it is zoomed, and
 * where it is scrolled — captured into Obsidian's ephemeral view state so
 * Back/Forward return the reader to exactly the place they left.
 */

export const CALENDAR_VIEWPORT_STATE_KEY = "ofcViewport";

export type CalendarViewportViewType =
    | "timeGridWeek"
    | "timeGridDay"
    | "dayGridMonth";

export interface CalendarViewportState {
    viewType: CalendarViewportViewType;
    /** Local calendar date, YYYY-MM-DD. */
    date: string;
    zoomLevel: number | null;
    scrollTop: number;
    scrollLeft: number;
}

const VIEWPORT_VIEW_TYPES: readonly string[] = [
    "timeGridWeek",
    "timeGridDay",
    "dayGridMonth",
];

const LOCAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

const padDatePart = (value: number): string =>
    value.toString().padStart(2, "0");

export const formatViewportDate = (date: Date): string =>
    `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(
        date.getDate()
    )}`;

/** Parse YYYY-MM-DD as a local date, rejecting impossible days like 02-31. */
export const parseViewportDate = (value: unknown): Date | null => {
    if (typeof value !== "string") {
        return null;
    }
    const match = LOCAL_DATE_PATTERN.exec(value);
    if (!match) {
        return null;
    }
    const [year, month, day] = match.slice(1).map(Number);
    const date = new Date(year, month - 1, day);
    return date.getFullYear() === year &&
        date.getMonth() === month - 1 &&
        date.getDate() === day
        ? date
        : null;
};

const readScrollOffset = (value: unknown): number =>
    typeof value === "number" && Number.isFinite(value) && value > 0
        ? Math.round(value)
        : 0;

const readZoomLevel = (value: unknown): number | null =>
    typeof value === "number" && Number.isInteger(value) && value >= 0
        ? value
        : null;

/**
 * Validate ephemeral state from Obsidian's history. It round-trips through
 * other code and persisted history, so anything malformed is dropped rather
 * than trusted.
 */
export const parseCalendarViewportState = (
    raw: unknown
): CalendarViewportState | null => {
    if (!isRecord(raw)) {
        return null;
    }
    const { viewType, date } = raw;
    if (
        typeof viewType !== "string" ||
        !VIEWPORT_VIEW_TYPES.includes(viewType) ||
        !parseViewportDate(date)
    ) {
        return null;
    }
    return {
        viewType: viewType as CalendarViewportViewType,
        date: date as string,
        zoomLevel: readZoomLevel(raw.zoomLevel),
        scrollTop: readScrollOffset(raw.scrollTop),
        scrollLeft: readScrollOffset(raw.scrollLeft),
    };
};

export const readCalendarViewportFromEphemeralState = (
    ephemeralState: unknown
): CalendarViewportState | null =>
    isRecord(ephemeralState)
        ? parseCalendarViewportState(
              ephemeralState[CALENDAR_VIEWPORT_STATE_KEY]
          )
        : null;

/** Read the persisted per-leaf zoom level from Obsidian's view state. */
export const readZoomLevelFromViewState = (state: unknown): number | null =>
    isRecord(state) ? readZoomLevel(state.zoomLevel) : null;

/**
 * FullCalendar's scrollable body: the time slots in week and day views, the
 * weeks in month view. The liquid section is the one that fills the height.
 */
export const findCalendarBodyScroller = (
    calendarEl: ParentNode
): HTMLElement | null =>
    calendarEl.querySelector<HTMLElement>(
        ".fc-scrollgrid-section-liquid .fc-scroller"
    ) ||
    calendarEl.querySelector<HTMLElement>(
        ".fc-scrollgrid-section-body .fc-scroller"
    );

/** The narrow-pane horizontal scroller around the whole week grid. */
export const findCalendarHorizontalScroller = (
    calendarEl: ParentNode
): HTMLElement | null =>
    calendarEl.querySelector<HTMLElement>(".fc-view-harness");
