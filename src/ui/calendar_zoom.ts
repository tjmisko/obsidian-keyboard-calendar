import type { Calendar } from "@fullcalendar/core";

export type TimeGridZoomDirection = "in" | "out";
export type TimeGridLabelDensity = "quarter-hour" | "half-hour" | "hour";

export interface TimeGridZoomLevel {
    slotHeight: string;
    labelDensity: TimeGridLabelDensity;
}

export interface TimeGridZoomKeyResult {
    handled: boolean;
    changed: boolean;
}

export const TIME_GRID_ZOOM_LEVELS: readonly TimeGridZoomLevel[] = [
    { slotHeight: "0.4rem", labelDensity: "hour" },
    { slotHeight: "0.5rem", labelDensity: "hour" },
    { slotHeight: "0.65rem", labelDensity: "half-hour" },
    { slotHeight: "0.85rem", labelDensity: "quarter-hour" },
    { slotHeight: "1.05rem", labelDensity: "quarter-hour" },
    { slotHeight: "1.3rem", labelDensity: "quarter-hour" },
    { slotHeight: "1.6rem", labelDensity: "quarter-hour" },
];

export const DEFAULT_TIME_GRID_ZOOM_LEVEL = 3;

export const getTimeGridZoomDirection = (
    key: string
): TimeGridZoomDirection | null => {
    if (key === "+" || key === "=") {
        return "in";
    }
    return key === "-" ? "out" : null;
};

export const isTimeGridZoomView = (viewType: string): boolean =>
    viewType === "timeGridWeek" || viewType === "timeGridDay";

const clampZoomLevel = (level: number): number =>
    Math.max(0, Math.min(TIME_GRID_ZOOM_LEVELS.length - 1, level));

const getSlotLabelIntervalMinutes = (density: TimeGridLabelDensity): number =>
    density === "quarter-hour" ? 15 : density === "half-hour" ? 30 : 60;

/**
 * Changing FullCalendar's label interval rebuilds its slat metadata. This is
 * required after CSS changes a row's height because updateSize() alone keeps
 * the old vertical coordinate cache when the calendar width is unchanged.
 */
export const refreshTimeGridLayout = (
    calendar: Pick<Calendar, "setOption" | "updateSize">,
    level: TimeGridZoomLevel
): void => {
    calendar.setOption("slotLabelInterval", {
        minutes: getSlotLabelIntervalMinutes(level.labelDensity),
    });
    calendar.updateSize();
};

/** Keeps one zoom level that both the week and day time-grid views use. */
export class TimeGridZoom {
    private levelIndex: number;

    constructor(levelIndex = DEFAULT_TIME_GRID_ZOOM_LEVEL) {
        this.levelIndex = clampZoomLevel(levelIndex);
    }

    get level(): TimeGridZoomLevel {
        return TIME_GRID_ZOOM_LEVELS[this.levelIndex];
    }

    applyTo(containerEl: HTMLElement): void {
        containerEl.style.setProperty(
            "--ofc-timegrid-slot-height",
            this.level.slotHeight
        );
        containerEl.dataset.ofcTimeLabelDensity = this.level.labelDensity;
    }

    handleKey(
        key: string,
        viewType: string,
        containerEl: HTMLElement
    ): TimeGridZoomKeyResult {
        const direction = getTimeGridZoomDirection(key);
        if (!direction || !isTimeGridZoomView(viewType)) {
            return { handled: false, changed: false };
        }

        const nextLevel = clampZoomLevel(
            this.levelIndex + (direction === "in" ? 1 : -1)
        );
        const changed = nextLevel !== this.levelIndex;
        if (changed) {
            this.levelIndex = nextLevel;
            this.applyTo(containerEl);
        }
        return { handled: true, changed };
    }
}
