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

/**
 * The scrollTop that keeps the time under an anchor (the pinch midpoint, or
 * the viewport center for keys) fixed while the grid's height changes. The
 * grid scales linearly, so the anchor's fraction of the height is preserved.
 */
export const getZoomAnchoredScrollTop = ({
    scrollTop,
    anchorOffset,
    previousScrollHeight,
    nextScrollHeight,
}: {
    scrollTop: number;
    /** Anchor distance from the scroller's top edge, in pixels. */
    anchorOffset: number;
    previousScrollHeight: number;
    nextScrollHeight: number;
}): number | null => {
    if (
        ![
            scrollTop,
            anchorOffset,
            previousScrollHeight,
            nextScrollHeight,
        ].every(Number.isFinite) ||
        previousScrollHeight <= 0 ||
        nextScrollHeight <= 0
    ) {
        return null;
    }
    const anchorFraction = (scrollTop + anchorOffset) / previousScrollHeight;
    return Math.max(
        0,
        Math.round(anchorFraction * nextScrollHeight - anchorOffset)
    );
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

    get index(): number {
        return this.levelIndex;
    }

    applyTo(containerEl: HTMLElement): void {
        containerEl.style.setProperty(
            "--ofc-timegrid-slot-height",
            this.level.slotHeight
        );
        containerEl.dataset.ofcTimeLabelDensity = this.level.labelDensity;
    }

    /** Jump to a level, clamped to the scale. Returns whether it changed. */
    setIndex(levelIndex: number, containerEl: HTMLElement | null): boolean {
        if (!Number.isFinite(levelIndex)) {
            return false;
        }
        const nextLevel = clampZoomLevel(Math.round(levelIndex));
        if (nextLevel === this.levelIndex) {
            return false;
        }
        this.levelIndex = nextLevel;
        if (containerEl) {
            this.applyTo(containerEl);
        }
        return true;
    }

    step(direction: TimeGridZoomDirection, containerEl: HTMLElement): boolean {
        return this.setIndex(
            this.levelIndex + (direction === "in" ? 1 : -1),
            containerEl
        );
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
        return { handled: true, changed: this.step(direction, containerEl) };
    }
}
