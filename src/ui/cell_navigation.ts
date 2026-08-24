import type { Calendar } from "@fullcalendar/core";

export const CALENDAR_CELL_MINUTES = 15;

export type CalendarCellDirection = "up" | "down" | "left" | "right";

export interface CalendarCell {
    start: Date;
    end: Date;
}

const minutesSinceStartOfDay = (date: Date): number =>
    date.getHours() * 60 + date.getMinutes();

const isWithinRange = (date: Date, start: Date, end: Date): boolean =>
    date.getTime() >= start.getTime() && date.getTime() < end.getTime();

const copyCell = (cell: CalendarCell): CalendarCell => ({
    start: new Date(cell.start),
    end: new Date(cell.end),
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
    private enabled = false;
    private readonly now: () => Date;

    constructor(
        private readonly containerEl: HTMLElement,
        private readonly calendar: Calendar,
        now: () => Date = () => new Date()
    ) {
        this.now = now;
        this.activate();
    }

    activate(): void {
        this.enabled = true;
        this.containerEl.classList.add("ofc-cell-navigation-active");
        this.syncToView(true);
    }

    deactivate(): void {
        this.enabled = false;
        this.removeSelectionElement();
        this.containerEl.classList.remove("ofc-cell-navigation-active");
    }

    getSelectedCell(): CalendarCell | null {
        return this.selectedCell ? copyCell(this.selectedCell) : null;
    }

    isActive(): boolean {
        return this.enabled && this.calendar.view.type.startsWith("timeGrid");
    }

    syncToView(scrollIntoView = false): void {
        this.removeSelectionElement();
        if (!this.isActive()) {
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

    renderSelection(scrollIntoView = false): void {
        this.removeSelectionElement();
        if (!this.isActive() || !this.selectedCell) {
            return;
        }

        const date = formatDateAttribute(this.selectedCell.start);
        const time = formatTimeAttribute(this.selectedCell.start);
        const frame = this.containerEl.querySelector<HTMLElement>(
            `.fc-timegrid-col[data-date="${date}"] .fc-timegrid-col-frame`
        );
        const slot = this.containerEl.querySelector<HTMLElement>(
            `.fc-timegrid-slot-lane[data-time="${time}"]`
        );
        if (!frame || !slot) {
            return;
        }

        const frameRect = frame.getBoundingClientRect();
        const slotRect = slot.getBoundingClientRect();
        const selection = frame.ownerDocument.createElement("div");
        selection.className = "ofc-selected-calendar-cell";
        selection.style.top = `${slotRect.top - frameRect.top}px`;
        selection.style.height = `${slotRect.height}px`;
        selection.setAttribute("role", "gridcell");
        selection.setAttribute("aria-selected", "true");
        selection.setAttribute(
            "aria-label",
            formatCellLabel(this.selectedCell)
        );
        selection.dataset.date = date;
        selection.dataset.time = time;
        frame.appendChild(selection);

        if (scrollIntoView) {
            selection.scrollIntoView?.({ block: "nearest", inline: "nearest" });
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
}
