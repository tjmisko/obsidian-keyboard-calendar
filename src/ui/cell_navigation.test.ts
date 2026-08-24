import type { Calendar } from "@fullcalendar/core";
import {
    CALENDAR_CELL_MINUTES,
    CalendarCellNavigator,
    createCalendarCell,
    getCalendarCellDirection,
    getInitialCalendarCell,
    moveCalendarCell,
} from "./cell_navigation";

const expectTime = (
    date: Date,
    year: number,
    month: number,
    day: number,
    hour: number,
    minute: number
) => {
    expect([
        date.getFullYear(),
        date.getMonth(),
        date.getDate(),
        date.getHours(),
        date.getMinutes(),
    ]).toEqual([year, month, day, hour, minute]);
};

const makeContainer = (): HTMLElement =>
    ({
        classList: { add: jest.fn(), remove: jest.fn() },
        querySelector: jest.fn(() => null),
        querySelectorAll: jest.fn(() => []),
    } as unknown as HTMLElement);

const makeCalendar = (
    type: string,
    activeStart: Date,
    activeEnd: Date
): Calendar =>
    ({
        view: { type, activeStart, activeEnd },
        gotoDate: jest.fn(),
    } as unknown as Calendar);

describe("calendar cell model", () => {
    it("uses quarter-hour cells and floors times into the containing cell", () => {
        const cell = createCalendarCell(new Date(2026, 7, 23, 9, 38, 42));

        expect(CALENDAR_CELL_MINUTES).toBe(15);
        expectTime(cell.start, 2026, 7, 23, 9, 30);
        expectTime(cell.end, 2026, 7, 23, 9, 45);
    });

    it("initializes at the current quarter-hour when today is visible", () => {
        const cell = getInitialCalendarCell(
            new Date(2026, 7, 17),
            new Date(2026, 7, 24),
            new Date(2026, 7, 20, 14, 52)
        );

        expectTime(cell.start, 2026, 7, 20, 14, 45);
    });

    it("uses the first visible date and current time when today is elsewhere", () => {
        const cell = getInitialCalendarCell(
            new Date(2026, 7, 3),
            new Date(2026, 7, 10),
            new Date(2026, 7, 20, 14, 52)
        );

        expectTime(cell.start, 2026, 7, 3, 14, 45);
    });

    it("moves vertically by one cell without wrapping into another day", () => {
        const middle = createCalendarCell(new Date(2026, 7, 23, 9, 30));
        expectTime(moveCalendarCell(middle, "up").start, 2026, 7, 23, 9, 15);
        expectTime(moveCalendarCell(middle, "down").start, 2026, 7, 23, 9, 45);

        const first = createCalendarCell(new Date(2026, 7, 23, 0, 0));
        const last = createCalendarCell(new Date(2026, 7, 23, 23, 45));
        expectTime(moveCalendarCell(first, "up").start, 2026, 7, 23, 0, 0);
        expectTime(moveCalendarCell(last, "down").start, 2026, 7, 23, 23, 45);
    });

    it("moves horizontally by one local calendar day at the same time", () => {
        const cell = createCalendarCell(new Date(2026, 7, 23, 9, 30));

        expectTime(moveCalendarCell(cell, "left").start, 2026, 7, 22, 9, 30);
        expectTime(moveCalendarCell(cell, "right").start, 2026, 7, 24, 9, 30);
    });

    it.each([
        ["ArrowUp", "up"],
        ["k", "up"],
        ["ArrowDown", "down"],
        ["j", "down"],
        ["ArrowLeft", "left"],
        ["h", "left"],
        ["ArrowRight", "right"],
        ["l", "right"],
    ])("maps %s to %s", (key, direction) => {
        expect(getCalendarCellDirection(key)).toBe(direction);
    });

    it("does not map unrelated keys into cell movement", () => {
        expect(getCalendarCellDirection("Enter")).toBeNull();
    });
});

describe("cell navigator", () => {
    it("owns one selected cell and navigates across the visible range", () => {
        const container = makeContainer();
        const calendar = makeCalendar(
            "timeGridWeek",
            new Date(2026, 7, 17),
            new Date(2026, 7, 24)
        );
        const navigator = new CalendarCellNavigator(
            container,
            calendar,
            () => new Date(2026, 7, 23, 10, 7)
        );

        expectTime(navigator.getSelectedCell()!.start, 2026, 7, 23, 10, 0);
        expect(navigator.move("right")).toBe(true);
        expectTime(navigator.getSelectedCell()!.start, 2026, 7, 24, 10, 0);
        expect(calendar.gotoDate).toHaveBeenCalledWith(
            new Date(2026, 7, 24, 10, 0)
        );
    });

    it("is dormant outside time-grid views", () => {
        const navigator = new CalendarCellNavigator(
            makeContainer(),
            makeCalendar(
                "dayGridMonth",
                new Date(2026, 7, 1),
                new Date(2026, 8, 1)
            ),
            () => new Date(2026, 7, 23, 10, 7)
        );

        expect(navigator.getSelectedCell()).toBeNull();
        expect(navigator.move("down")).toBe(false);
    });

    it("can be deactivated without losing its cell for a future mode switch", () => {
        const navigator = new CalendarCellNavigator(
            makeContainer(),
            makeCalendar(
                "timeGridWeek",
                new Date(2026, 7, 17),
                new Date(2026, 7, 24)
            ),
            () => new Date(2026, 7, 23, 10, 7)
        );
        const selected = navigator.getSelectedCell();

        navigator.deactivate();

        expect(navigator.isActive()).toBe(false);
        expect(navigator.move("down")).toBe(false);
        expect(navigator.getSelectedCell()).toEqual(selected);
    });
});
