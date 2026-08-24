import type { Calendar } from "@fullcalendar/core";

export const CALENDAR_CELL_MINUTES = 15;

export type CalendarCellDirection = "up" | "down" | "left" | "right";

export interface CalendarCell {
    start: Date;
    end: Date;
}

export interface CalendarEventDraft {
    start: Date;
    end: Date;
}

export interface CalendarCellNavigatorOptions {
    now?: () => Date;
    createEvent?: (start: Date, end: Date) => Promise<void>;
}

export type CalendarScrollAlignment = "start" | "center" | "end";

const FALLBACK_PAGE_CELL_COUNT = 16;

const minutesSinceStartOfDay = (date: Date): number =>
    date.getHours() * 60 + date.getMinutes();

const isWithinRange = (date: Date, start: Date, end: Date): boolean =>
    date.getTime() >= start.getTime() && date.getTime() < end.getTime();

const copyCell = (cell: CalendarCell): CalendarCell => ({
    start: new Date(cell.start),
    end: new Date(cell.end),
});

const copyDraft = (draft: CalendarEventDraft): CalendarEventDraft => ({
    start: new Date(draft.start),
    end: new Date(draft.end),
});

const formatDateAttribute = (date: Date): string =>
    [
        date.getFullYear(),
        (date.getMonth() + 1).toString().padStart(2, "0"),
        date.getDate().toString().padStart(2, "0"),
    ].join("-");

const formatTimeAttribute = (date: Date): string =>
    `${date.getHours().toString().padStart(2, "0")}:${date
        .getMinutes()
        .toString()
        .padStart(2, "0")}:00`;

const formatCellLabel = (cell: CalendarCell): string => {
    const date = cell.start.toLocaleDateString(undefined, {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
    });
    const start = cell.start.toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
    });
    const end = cell.end.toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
    });
    return `Selected calendar cell, ${date}, ${start} to ${end}`;
};

export const createCalendarCell = (date: Date): CalendarCell => {
    const start = new Date(date);
    start.setSeconds(0, 0);
    start.setMinutes(
        Math.floor(start.getMinutes() / CALENDAR_CELL_MINUTES) *
            CALENDAR_CELL_MINUTES
    );
    const end = new Date(start);
    end.setMinutes(end.getMinutes() + CALENDAR_CELL_MINUTES);
    return { start, end };
};

export const getInitialCalendarCell = (
    activeStart: Date,
    activeEnd: Date,
    now: Date
): CalendarCell => {
    if (isWithinRange(now, activeStart, activeEnd)) {
        return createCalendarCell(now);
    }

    const firstVisibleDate = new Date(activeStart);
    firstVisibleDate.setHours(now.getHours(), now.getMinutes(), 0, 0);
    return createCalendarCell(firstVisibleDate);
};

export const moveCalendarCell = (
    cell: CalendarCell,
    direction: CalendarCellDirection
): CalendarCell => {
    const next = new Date(cell.start);

    if (direction === "left" || direction === "right") {
        next.setDate(next.getDate() + (direction === "left" ? -1 : 1));
        return createCalendarCell(next);
    }

    const offset =
        direction === "up" ? -CALENDAR_CELL_MINUTES : CALENDAR_CELL_MINUTES;
    const nextMinute = Math.max(
        0,
        Math.min(
            24 * 60 - CALENDAR_CELL_MINUTES,
            minutesSinceStartOfDay(next) + offset
        )
    );
    next.setHours(Math.floor(nextMinute / 60), nextMinute % 60, 0, 0);
    return createCalendarCell(next);
};

export const moveCalendarCellBy = (
    cell: CalendarCell,
    cellOffset: number
): CalendarCell => {
    const next = new Date(cell.start);
    const nextMinute = Math.max(
        0,
        Math.min(
            24 * 60 - CALENDAR_CELL_MINUTES,
            minutesSinceStartOfDay(next) + cellOffset * CALENDAR_CELL_MINUTES
        )
    );
    next.setHours(Math.floor(nextMinute / 60), nextMinute % 60, 0, 0);
    return createCalendarCell(next);
};

export const getCalendarPageCellCount = (
    viewportHeight: number,
    cellHeight: number
): number => {
    if (viewportHeight <= 0 || cellHeight <= 0) {
        return FALLBACK_PAGE_CELL_COUNT;
    }
    return Math.max(1, Math.floor(viewportHeight / cellHeight) - 1);
};

export const getCalendarCellDirection = (
    key: string
): CalendarCellDirection | null => {
    switch (key.toLowerCase()) {
        case "arrowup":
        case "k":
            return "up";
        case "arrowdown":
        case "j":
            return "down";
        case "arrowleft":
        case "h":
            return "left";
        case "arrowright":
        case "l":
            return "right";
        default:
            return null;
    }
};

/**
 * Owns the selected cell for the calendar's cell-navigation mode.
 *
 * FullCalendar's built-in selection is intentionally not used here: invoking
 * it would also invoke the event-creation callback. The navigator instead
 * renders a non-interactive overlay in the matching day and time slot.
 */
export class CalendarCellNavigator {
    private selectedCell: CalendarCell | null = null;
    private eventDraft: CalendarEventDraft | null = null;
    private enabled = false;
    private pendingPrefix: "g" | "z" | null = null;
    private creatingEvent = false;
    private readonly now: () => Date;
    private readonly createEvent?: (start: Date, end: Date) => Promise<void>;

    constructor(
        private readonly containerEl: HTMLElement,
        private readonly calendar: Calendar,
        options: CalendarCellNavigatorOptions = {}
    ) {
        this.now = options.now || (() => new Date());
        this.createEvent = options.createEvent;
        this.activate();
    }

    activate(): void {
        this.enabled = true;
        this.containerEl.classList.add("ofc-cell-navigation-active");
        this.syncToView(true);
    }

    deactivate(): void {
        this.enabled = false;
        this.eventDraft = null;
        this.pendingPrefix = null;
        this.removeSelectionElement();
        this.containerEl.classList.remove("ofc-cell-navigation-active");
        this.containerEl.classList.remove("ofc-event-draft-active");
    }

    getSelectedCell(): CalendarCell | null {
        return this.selectedCell ? copyCell(this.selectedCell) : null;
    }

    getEventDraft(): CalendarEventDraft | null {
        return this.eventDraft ? copyDraft(this.eventDraft) : null;
    }

    isActive(): boolean {
        return this.enabled && this.calendar.view.type.startsWith("timeGrid");
    }

    syncToView(scrollIntoView = false): void {
        this.removeSelectionElement();
        if (!this.isActive()) {
            this.eventDraft = null;
            return;
        }

        const { activeStart, activeEnd } = this.calendar.view;
        if (
            !this.selectedCell ||
            !isWithinRange(this.selectedCell.start, activeStart, activeEnd)
        ) {
            this.selectedCell = getInitialCalendarCell(
                activeStart,
                activeEnd,
                this.now()
            );
            this.eventDraft = null;
            this.containerEl.classList.remove("ofc-event-draft-active");
        }
        this.renderSelection(scrollIntoView);
    }

    select(date: Date, scrollIntoView = true): void {
        if (!this.isActive()) {
            return;
        }
        this.selectedCell = createCalendarCell(date);
        if (
            !isWithinRange(
                this.selectedCell.start,
                this.calendar.view.activeStart,
                this.calendar.view.activeEnd
            )
        ) {
            this.calendar.gotoDate(this.selectedCell.start);
        }
        this.renderSelection(scrollIntoView);
    }

    move(direction: CalendarCellDirection): boolean {
        if (!this.isActive()) {
            return false;
        }
        if (!this.selectedCell) {
            this.syncToView();
        }
        if (!this.selectedCell) {
            return false;
        }

        this.select(moveCalendarCell(this.selectedCell, direction).start);
        return true;
    }

    movePage(direction: "up" | "down"): boolean {
        if (!this.isActive() || !this.selectedCell) {
            return false;
        }
        const slot = this.getSlotElement(this.selectedCell.start);
        const scroller = slot?.closest<HTMLElement>(".fc-scroller");
        const cellCount = getCalendarPageCellCount(
            scroller?.clientHeight || 0,
            slot?.getBoundingClientRect().height || 0
        );
        this.select(
            moveCalendarCellBy(
                this.selectedCell,
                direction === "up" ? -cellCount : cellCount
            ).start
        );
        return true;
    }

    moveToDayBoundary(boundary: "first" | "last"): boolean {
        if (!this.isActive() || !this.selectedCell) {
            return false;
        }
        const date = new Date(
            boundary === "first"
                ? this.calendar.view.activeStart
                : this.calendar.view.activeEnd
        );
        if (boundary === "last") {
            date.setDate(date.getDate() - 1);
        }
        date.setHours(
            this.selectedCell.start.getHours(),
            this.selectedCell.start.getMinutes(),
            0,
            0
        );
        this.select(date);
        return true;
    }

    moveToTimeBoundary(boundary: "first" | "last"): boolean {
        if (!this.isActive() || !this.selectedCell) {
            return false;
        }
        const date = new Date(this.selectedCell.start);
        date.setHours(
            boundary === "first" ? 0 : 23,
            boundary === "first" ? 0 : 45,
            0,
            0
        );
        this.select(date);
        return true;
    }

    alignSelection(alignment: CalendarScrollAlignment): boolean {
        if (!this.isActive() || !this.selectedCell) {
            return false;
        }
        this.renderSelection();
        this.containerEl
            .querySelector<HTMLElement>(".ofc-selected-calendar-cell")
            ?.scrollIntoView({ block: alignment, inline: "nearest" });
        return true;
    }

    scrollHorizontally(direction: "left" | "right"): boolean {
        if (!this.isActive() || !this.selectedCell) {
            return false;
        }
        const frame = this.getDayFrame(this.selectedCell.start);
        const scroller = frame?.closest<HTMLElement>(".fc-scroller");
        if (!frame || !scroller) {
            return true;
        }
        scroller.scrollBy?.({
            left:
                (direction === "left" ? -1 : 1) *
                frame.getBoundingClientRect().width,
            behavior: "auto",
        });
        return true;
    }

    beginEventDraft(): boolean {
        if (!this.isActive() || !this.selectedCell || this.creatingEvent) {
            return false;
        }
        this.pendingPrefix = null;
        this.eventDraft = copyCell(this.selectedCell);
        this.containerEl.classList.add("ofc-event-draft-active");
        this.renderSelection(true);
        return true;
    }

    cancelEventDraft(): boolean {
        if (!this.eventDraft) {
            return false;
        }
        this.eventDraft = null;
        this.containerEl.classList.remove("ofc-event-draft-active");
        this.renderSelection(true);
        return true;
    }

    resizeEventDraft(direction: CalendarCellDirection): boolean {
        if (!this.eventDraft || !this.selectedCell) {
            return false;
        }

        if (direction === "left" || direction === "right") {
            const dayOffset = direction === "left" ? -1 : 1;
            this.eventDraft.start.setDate(
                this.eventDraft.start.getDate() + dayOffset
            );
            this.eventDraft.end.setDate(
                this.eventDraft.end.getDate() + dayOffset
            );
            this.selectedCell = createCalendarCell(this.eventDraft.start);
            if (
                !isWithinRange(
                    this.eventDraft.start,
                    this.calendar.view.activeStart,
                    this.calendar.view.activeEnd
                )
            ) {
                this.calendar.gotoDate(this.eventDraft.start);
            }
        } else {
            const minimumEnd = new Date(this.eventDraft.start);
            minimumEnd.setMinutes(
                minimumEnd.getMinutes() + CALENDAR_CELL_MINUTES
            );
            const endOfDay = new Date(this.eventDraft.start);
            endOfDay.setHours(24, 0, 0, 0);
            const candidateEnd = new Date(this.eventDraft.end);
            candidateEnd.setMinutes(
                candidateEnd.getMinutes() +
                    (direction === "up"
                        ? -CALENDAR_CELL_MINUTES
                        : CALENDAR_CELL_MINUTES)
            );
            this.eventDraft.end = new Date(
                Math.max(
                    minimumEnd.getTime(),
                    Math.min(endOfDay.getTime(), candidateEnd.getTime())
                )
            );
        }

        this.renderSelection(true);
        return true;
    }

    async confirmEventDraft(): Promise<boolean> {
        if (!this.eventDraft || this.creatingEvent) {
            return false;
        }
        const draft = copyDraft(this.eventDraft);
        this.creatingEvent = true;
        try {
            await this.createEvent?.(draft.start, draft.end);
            this.eventDraft = null;
            this.containerEl.classList.remove("ofc-event-draft-active");
            this.renderSelection();
        } catch (error) {
            console.error(error);
        } finally {
            this.creatingEvent = false;
        }
        return true;
    }

    handleKey(key: string, repeat = false): boolean {
        if (!this.isActive()) {
            return false;
        }

        if (this.eventDraft) {
            if (key === "Escape") {
                return this.cancelEventDraft();
            }
            if (key === "Enter") {
                if (!repeat) {
                    void this.confirmEventDraft();
                }
                return true;
            }
            const draftDirection = getCalendarCellDirection(key);
            return draftDirection
                ? this.resizeEventDraft(draftDirection)
                : false;
        }

        if (this.pendingPrefix) {
            if (repeat) {
                return true;
            }
            const prefix = this.pendingPrefix;
            this.pendingPrefix = null;
            if (prefix === "g" && key === "g") {
                return this.moveToTimeBoundary("first");
            }
            if (prefix === "z") {
                switch (key.toLowerCase()) {
                    case "z":
                        return this.alignSelection("center");
                    case "t":
                        return this.alignSelection("start");
                    case "b":
                        return this.alignSelection("end");
                    case "h":
                        return this.scrollHorizontally("left");
                    case "l":
                        return this.scrollHorizontally("right");
                }
            }
            return true;
        }

        if (key === "g" || key.toLowerCase() === "z") {
            if (!repeat) {
                this.pendingPrefix = key === "g" ? "g" : "z";
            }
            return true;
        }
        if (key === "G") {
            return this.moveToTimeBoundary("last");
        }
        if (key === "Home") {
            return this.moveToDayBoundary("first");
        }
        if (key === "End") {
            return this.moveToDayBoundary("last");
        }
        if (key === "PageUp" || key === "PageDown") {
            return this.movePage(key === "PageUp" ? "up" : "down");
        }
        if (key === "Enter") {
            return repeat ? true : this.beginEventDraft();
        }
        if (key === "Escape") {
            return false;
        }
        const direction = getCalendarCellDirection(key);
        return direction ? this.move(direction) : false;
    }

    renderSelection(scrollIntoView = false): void {
        this.removeSelectionElement();
        if (!this.isActive() || !this.selectedCell) {
            return;
        }

        const renderedRange = this.eventDraft || this.selectedCell;
        const date = formatDateAttribute(renderedRange.start);
        const time = formatTimeAttribute(renderedRange.start);
        const frame = this.getDayFrame(renderedRange.start);
        const slot = this.getSlotElement(renderedRange.start);
        if (!frame || !slot) {
            return;
        }

        const frameRect = frame.getBoundingClientRect();
        const slotRect = slot.getBoundingClientRect();
        const selection = frame.ownerDocument.createElement("div");
        selection.className = this.eventDraft
            ? "ofc-selected-calendar-cell ofc-calendar-event-draft"
            : "ofc-selected-calendar-cell";
        selection.style.top = `${slotRect.top - frameRect.top}px`;
        selection.style.height = `${
            slotRect.height *
            Math.max(
                1,
                Math.round(
                    (renderedRange.end.getTime() -
                        renderedRange.start.getTime()) /
                        (CALENDAR_CELL_MINUTES * 60 * 1000)
                )
            )
        }px`;
        selection.setAttribute("role", "gridcell");
        selection.setAttribute("aria-selected", "true");
        selection.setAttribute(
            "aria-label",
            this.eventDraft
                ? `New event, ${formatCellLabel(renderedRange).replace(
                      "Selected calendar cell, ",
                      ""
                  )}. Press Enter to create or Escape to cancel.`
                : formatCellLabel(this.selectedCell)
        );
        selection.dataset.date = date;
        selection.dataset.time = time;
        selection.dataset.end = renderedRange.end.toISOString();
        frame.appendChild(selection);

        if (scrollIntoView) {
            const scrollTarget = this.eventDraft
                ? this.getSlotElement(
                      new Date(
                          this.eventDraft.end.getTime() -
                              CALENDAR_CELL_MINUTES * 60 * 1000
                      )
                  )
                : selection;
            scrollTarget?.scrollIntoView?.({
                block: "nearest",
                inline: "nearest",
            });
        }
    }

    destroy(): void {
        this.deactivate();
        this.selectedCell = null;
    }

    private removeSelectionElement(): void {
        this.containerEl
            .querySelectorAll(".ofc-selected-calendar-cell")
            .forEach((element) => element.remove());
    }

    private getDayFrame(date: Date): HTMLElement | null {
        return this.containerEl.querySelector<HTMLElement>(
            `.fc-timegrid-col[data-date="${formatDateAttribute(
                date
            )}"] .fc-timegrid-col-frame`
        );
    }

    private getSlotElement(date: Date): HTMLElement | null {
        return this.containerEl.querySelector<HTMLElement>(
            `.fc-timegrid-slot-lane[data-time="${formatTimeAttribute(date)}"]`
        );
    }
}
