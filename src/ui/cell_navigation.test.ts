import type { Calendar } from "@fullcalendar/core";
import {
    CALENDAR_CELL_MINUTES,
    CalendarCellNavigator,
    createCalendarCell,
    getCalendarCellDirection,
    getCalendarPageCellCount,
    getInitialCalendarCell,
    moveCalendarCell,
    moveCalendarCellBy,
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

    it("applies a count to vertical cells and horizontal days", () => {
        const cell = createCalendarCell(new Date(2026, 7, 23, 9, 30));

        expectTime(
            moveCalendarCell(cell, "down", 3).start,
            2026,
            7,
            23,
            10,
            15
        );
        expectTime(moveCalendarCell(cell, "left", 2).start, 2026, 7, 21, 9, 30);
    });

    it("moves by a page-sized cell count and clamps to the day", () => {
        const cell = createCalendarCell(new Date(2026, 7, 23, 9, 30));

        expectTime(moveCalendarCellBy(cell, 8).start, 2026, 7, 23, 11, 30);
        expectTime(moveCalendarCellBy(cell, -100).start, 2026, 7, 23, 0, 0);
        expectTime(moveCalendarCellBy(cell, 100).start, 2026, 7, 23, 23, 45);
        expect(getCalendarPageCellCount(300, 15)).toBe(19);
        expect(getCalendarPageCellCount(0, 0)).toBe(16);
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
        const navigator = new CalendarCellNavigator(container, calendar, {
            now: () => new Date(2026, 7, 23, 10, 7),
        });

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
            { now: () => new Date(2026, 7, 23, 10, 7) }
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
            { now: () => new Date(2026, 7, 23, 10, 7) }
        );
        const selected = navigator.getSelectedCell();

        navigator.deactivate();

        expect(navigator.isActive()).toBe(false);
        expect(navigator.move("down")).toBe(false);
        expect(navigator.getSelectedCell()).toEqual(selected);
    });

    it("supports page, row-boundary, and Vim time-boundary movement", () => {
        const navigator = new CalendarCellNavigator(
            makeContainer(),
            makeCalendar(
                "timeGridWeek",
                new Date(2026, 7, 17),
                new Date(2026, 7, 24)
            ),
            { now: () => new Date(2026, 7, 20, 10, 7) }
        );

        expect(navigator.handleKey("Home")).toBe(true);
        expectTime(navigator.getSelectedCell()!.start, 2026, 7, 17, 10, 0);
        expect(navigator.handleKey("End")).toBe(true);
        expectTime(navigator.getSelectedCell()!.start, 2026, 7, 23, 10, 0);

        expect(navigator.handleKey("g")).toBe(true);
        expect(navigator.handleKey("g")).toBe(true);
        expectTime(navigator.getSelectedCell()!.start, 2026, 7, 23, 0, 0);
        expect(navigator.handleKey("G")).toBe(true);
        expectTime(navigator.getSelectedCell()!.start, 2026, 7, 23, 23, 45);

        navigator.select(new Date(2026, 7, 23, 10, 0), false);
        expect(navigator.handleKey("PageDown")).toBe(true);
        expectTime(navigator.getSelectedCell()!.start, 2026, 7, 23, 14, 0);
        expect(navigator.handleKey("PageUp")).toBe(true);
        expectTime(navigator.getSelectedCell()!.start, 2026, 7, 23, 10, 0);
    });

    it("supports Vim counts and counted G as an absolute hour", () => {
        const navigator = new CalendarCellNavigator(
            makeContainer(),
            makeCalendar(
                "timeGridWeek",
                new Date(2026, 7, 17),
                new Date(2026, 7, 24)
            ),
            { now: () => new Date(2026, 7, 20, 10, 7) }
        );

        navigator.handleKey("3");
        navigator.handleKey("j");
        expectTime(navigator.getSelectedCell()!.start, 2026, 7, 20, 10, 45);

        navigator.handleKey("2");
        navigator.handleKey("h");
        expectTime(navigator.getSelectedCell()!.start, 2026, 7, 18, 10, 45);

        navigator.handleKey("2");
        navigator.handleKey("l");
        expectTime(navigator.getSelectedCell()!.start, 2026, 7, 20, 10, 45);

        navigator.handleKey("1");
        navigator.handleKey("8");
        navigator.handleKey("G");
        expectTime(navigator.getSelectedCell()!.start, 2026, 7, 20, 18, 0);
    });

    it("starts each insert-mode activation from the current time", () => {
        const navigator = new CalendarCellNavigator(
            makeContainer(),
            makeCalendar(
                "timeGridWeek",
                new Date(2026, 7, 17),
                new Date(2026, 7, 24)
            ),
            { now: () => new Date(2026, 7, 20, 10, 7) }
        );

        navigator.select(new Date(2026, 7, 22, 19, 30), false);
        navigator.deactivate();
        navigator.activateAtCurrentTime();

        expectTime(navigator.getSelectedCell()!.start, 2026, 7, 20, 10, 0);
    });

    it("supports Vim scroll-position prefixes", () => {
        const navigator = new CalendarCellNavigator(
            makeContainer(),
            makeCalendar(
                "timeGridWeek",
                new Date(2026, 7, 17),
                new Date(2026, 7, 24)
            ),
            { now: () => new Date(2026, 7, 20, 10, 7) }
        );
        const align = jest
            .spyOn(navigator, "alignSelection")
            .mockReturnValue(true);
        const horizontal = jest
            .spyOn(navigator, "scrollHorizontally")
            .mockReturnValue(true);

        navigator.handleKey("z");
        navigator.handleKey("z");
        navigator.handleKey("z");
        navigator.handleKey("t");
        navigator.handleKey("z");
        navigator.handleKey("b");
        navigator.handleKey("z");
        navigator.handleKey("l");
        navigator.handleKey("Enter");
        navigator.handleKey("z");
        navigator.handleKey("t");

        expect(align).toHaveBeenNthCalledWith(1, "center");
        expect(align).toHaveBeenNthCalledWith(2, "start");
        expect(align).toHaveBeenNthCalledWith(3, "end");
        expect(align).toHaveBeenNthCalledWith(4, "start");
        expect(horizontal).toHaveBeenCalledWith("right");
        expect(navigator.getEventDraft()).not.toBeNull();
    });

    it("creates, resizes, moves, and confirms a keyboard event draft", async () => {
        const createEvent = jest.fn(async () => undefined);
        const calendar = makeCalendar(
            "timeGridWeek",
            new Date(2026, 7, 17),
            new Date(2026, 7, 24)
        );
        const navigator = new CalendarCellNavigator(makeContainer(), calendar, {
            now: () => new Date(2026, 7, 23, 10, 7),
            createEvent,
        });

        expect(navigator.handleKey("Enter")).toBe(true);
        expectTime(navigator.getEventDraft()!.start, 2026, 7, 23, 10, 0);
        expectTime(navigator.getEventDraft()!.end, 2026, 7, 23, 10, 15);

        navigator.handleKey("ArrowDown");
        navigator.handleKey("j");
        navigator.handleKey("ArrowUp");
        navigator.handleKey("ArrowRight");
        expectTime(navigator.getEventDraft()!.start, 2026, 7, 24, 10, 0);
        expectTime(navigator.getEventDraft()!.end, 2026, 7, 24, 10, 30);
        expect(calendar.gotoDate).toHaveBeenCalledWith(
            new Date(2026, 7, 24, 10, 0)
        );

        await expect(navigator.confirmEventDraft()).resolves.toBe(true);
        expect(createEvent).toHaveBeenCalledWith(
            new Date(2026, 7, 24, 10, 0),
            new Date(2026, 7, 24, 10, 30)
        );
        expect(navigator.getEventDraft()).toBeNull();
    });

    it("applies counts while resizing and moving an event draft", () => {
        const navigator = new CalendarCellNavigator(
            makeContainer(),
            makeCalendar(
                "timeGridWeek",
                new Date(2026, 7, 17),
                new Date(2026, 7, 24)
            ),
            { now: () => new Date(2026, 7, 20, 10, 7) }
        );

        navigator.handleKey("Enter");
        navigator.handleKey("3");
        navigator.handleKey("j");
        navigator.handleKey("2");
        navigator.handleKey("l");

        expectTime(navigator.getEventDraft()!.start, 2026, 7, 22, 10, 0);
        expectTime(navigator.getEventDraft()!.end, 2026, 7, 22, 11, 0);
    });

    it("cancels a keyboard event draft with Escape", () => {
        const navigator = new CalendarCellNavigator(
            makeContainer(),
            makeCalendar(
                "timeGridWeek",
                new Date(2026, 7, 17),
                new Date(2026, 7, 24)
            ),
            { now: () => new Date(2026, 7, 20, 10, 7) }
        );

        navigator.handleKey("Enter");
        expect(navigator.handleKey("Escape")).toBe(true);
        expect(navigator.getEventDraft()).toBeNull();
    });
});
