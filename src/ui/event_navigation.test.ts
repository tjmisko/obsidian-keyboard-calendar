import type { WorkspaceLeaf } from "obsidian";
import {
    CALENDAR_KEYDOWN_CAPTURE_OPTIONS,
    CalendarEventNavigator,
    getDirectionalEventIndex,
    isCalendarMoveRedoShortcut,
    moveCalendarEventGrab,
    navigateFromCalendarEvent,
} from "./event_navigation";

const makeEventElement = (
    start: Date,
    end: Date,
    rect: { top: number; left: number; width: number; height: number },
    id?: string
): HTMLElement => {
    const classes = new Set<string>();
    const attributes = new Map<string, string>();
    return {
        dataset: {
            ofcEventStart: start.toISOString(),
            ofcEventEnd: end.toISOString(),
            ...(id ? { ofcEventId: id } : {}),
        },
        classList: {
            add: (...values: string[]) =>
                values.forEach((value) => classes.add(value)),
            remove: (...values: string[]) =>
                values.forEach((value) => classes.delete(value)),
            contains: (value: string) => classes.has(value),
        },
        setAttribute: (name: string, value: string) =>
            attributes.set(name, value),
        removeAttribute: (name: string) => attributes.delete(name),
        getAttribute: (name: string) => attributes.get(name) || null,
        getBoundingClientRect: () => rect,
        focus: jest.fn(),
        blur: jest.fn(),
        scrollIntoView: jest.fn(),
        click: jest.fn(),
        tabIndex: -1,
    } as unknown as HTMLElement;
};

const makeContainer = (events: HTMLElement[]): HTMLElement =>
    ({
        classList: { add: jest.fn(), remove: jest.fn() },
        querySelectorAll: jest.fn(() => events),
    } as unknown as HTMLElement);

describe("calendar event focus", () => {
    it("captures calendar keydown before focused FullCalendar events", () => {
        expect(CALENDAR_KEYDOWN_CAPTURE_OPTIONS).toEqual({ capture: true });
        expect(Object.isFrozen(CALENDAR_KEYDOWN_CAPTURE_OPTIONS)).toBe(true);
    });

    it("chooses the nearest spatial event in each direction", () => {
        const rects = [
            { top: 0, left: 0, width: 50, height: 30 },
            { top: 100, left: 0, width: 50, height: 30 },
            { top: 10, left: 100, width: 50, height: 30 },
            { top: 60, left: 100, width: 50, height: 30 },
        ];

        expect(getDirectionalEventIndex(rects, 0, "down")).toBe(1);
        expect(getDirectionalEventIndex(rects, 0, "right")).toBe(2);
        expect(getDirectionalEventIndex(rects, 0, "up")).toBe(0);
    });

    it("focuses the event nearest a supplied cursor time", () => {
        const morning = makeEventElement(
            new Date(2026, 7, 20, 9, 0),
            new Date(2026, 7, 20, 10, 0),
            { top: 0, left: 0, width: 50, height: 30 }
        );
        const noon = makeEventElement(
            new Date(2026, 7, 20, 12, 0),
            new Date(2026, 7, 20, 13, 0),
            { top: 100, left: 0, width: 50, height: 30 }
        );
        const navigator = new CalendarEventNavigator(
            makeContainer([morning, noon])
        );

        navigator.activate(new Date(2026, 7, 20, 11, 45));

        expect(navigator.getFocusedEvent()).toBe(noon);
        expect(noon.classList.contains("ofc-focused-calendar-event")).toBe(
            true
        );
        expect(noon.getAttribute("aria-current")).toBe("true");
        expect(noon.tabIndex).toBe(0);
    });

    it("applies counts to normal-mode event movement and opens with Enter", () => {
        const events = [0, 100, 200].map((top, index) =>
            makeEventElement(
                new Date(2026, 7, 20, 9 + index, 0),
                new Date(2026, 7, 20, 10 + index, 0),
                { top, left: 0, width: 50, height: 30 }
            )
        );
        const navigator = new CalendarEventNavigator(makeContainer(events));
        navigator.activate(new Date(2026, 7, 20, 9, 0));

        navigator.handleKey("2");
        navigator.handleKey("j");
        navigator.handleKey("Enter");

        expect(navigator.getFocusedEvent()).toBe(events[2]);
        expect(events[2].click).toHaveBeenCalledTimes(1);
    });

    it("moves vertically in start-time order and traverses ties in DOM order", () => {
        const tenFirst = makeEventElement(
            new Date(2026, 7, 20, 10, 0),
            new Date(2026, 7, 20, 10, 30),
            { top: 100, left: 0, width: 50, height: 30 }
        );
        const nine = makeEventElement(
            new Date(2026, 7, 20, 9, 0),
            new Date(2026, 7, 20, 9, 30),
            { top: 0, left: 100, width: 50, height: 30 }
        );
        const tenSecond = makeEventElement(
            new Date(2026, 7, 20, 10, 0),
            new Date(2026, 7, 20, 11, 0),
            { top: 100, left: 100, width: 50, height: 60 }
        );
        const eleven = makeEventElement(
            new Date(2026, 7, 20, 11, 0),
            new Date(2026, 7, 20, 11, 30),
            { top: 200, left: 0, width: 50, height: 30 }
        );
        const navigator = new CalendarEventNavigator(
            makeContainer([tenFirst, nine, tenSecond, eleven])
        );
        navigator.activate(new Date(2026, 7, 20, 10, 0));

        navigator.handleKey("j");
        expect(navigator.getFocusedEvent()).toBe(tenSecond);
        navigator.handleKey("ArrowDown");
        expect(navigator.getFocusedEvent()).toBe(eleven);
        navigator.handleKey("k");
        expect(navigator.getFocusedEvent()).toBe(tenSecond);
        navigator.handleKey("ArrowUp");
        expect(navigator.getFocusedEvent()).toBe(tenFirst);
        navigator.handleKey("k");
        expect(navigator.getFocusedEvent()).toBe(nine);
    });

    it("activates an exact event ID and scrolls it into the viewport", () => {
        const nearest = makeEventElement(
            new Date(2026, 7, 20, 10, 0),
            new Date(2026, 7, 20, 10, 30),
            { top: 0, left: 0, width: 50, height: 30 },
            "nearest"
        );
        const created = makeEventElement(
            new Date(2026, 7, 20, 12, 0),
            new Date(2026, 7, 20, 12, 30),
            { top: 500, left: 0, width: 50, height: 30 },
            "created"
        );
        const navigator = new CalendarEventNavigator(
            makeContainer([nearest, created])
        );

        navigator.activate(new Date(2026, 7, 20, 10, 0), "created");

        expect(navigator.getFocusedEvent()).toBe(created);
        expect(created.focus).toHaveBeenCalledWith({ preventScroll: true });
        expect(created.scrollIntoView).toHaveBeenCalledWith({
            block: "nearest",
            inline: "nearest",
        });
    });

    it("releases DOM focus when normal mode is deactivated", () => {
        const focused = makeEventElement(
            new Date(2026, 7, 20, 9, 0),
            new Date(2026, 7, 20, 10, 0),
            { top: 0, left: 0, width: 50, height: 30 }
        );
        const navigator = new CalendarEventNavigator(makeContainer([focused]));
        navigator.activate(new Date(2026, 7, 20, 9, 0));

        navigator.deactivate();

        expect(focused.blur).toHaveBeenCalledTimes(1);
        expect(focused.tabIndex).toBe(-1);
        expect(navigator.getFocusedEvent()).toBeNull();
    });

    it("leaves non-grab normal-mode keys available to the view router", () => {
        const focused = makeEventElement(
            new Date(2026, 7, 20, 9, 0),
            new Date(2026, 7, 20, 10, 0),
            { top: 0, left: 0, width: 50, height: 30 },
            "event-id"
        );
        const navigator = new CalendarEventNavigator(makeContainer([focused]));
        navigator.activate(new Date(2026, 7, 20, 9, 0));

        expect(navigator.handleKey("i")).toBe(false);
        expect(navigator.handleKey("t")).toBe(false);
        expect(navigator.handleKey("Tab")).toBe(false);
        expect(navigator.handleKey("g")).toBe(false);
        expect(navigator.isGrabbing()).toBe(false);
    });
});

describe("calendar event grab mode", () => {
    it("moves by quarter-hours and local calendar days without mutating its input", () => {
        const original = {
            eventId: "event-id",
            start: new Date(2026, 7, 20, 9, 0),
            end: new Date(2026, 7, 20, 10, 30),
        };

        const later = moveCalendarEventGrab(original, "down", 2);
        const nextDay = moveCalendarEventGrab(later, "right");

        expect(later.start).toEqual(new Date(2026, 7, 20, 9, 30));
        expect(later.end).toEqual(new Date(2026, 7, 20, 11, 0));
        expect(nextDay.start).toEqual(new Date(2026, 7, 21, 9, 30));
        expect(nextDay.end).toEqual(new Date(2026, 7, 21, 11, 0));
        expect(original.start).toEqual(new Date(2026, 7, 20, 9, 0));
        expect(original.end).toEqual(new Date(2026, 7, 20, 10, 30));
    });

    it("enters with m, previews counted movement, and commits with Enter", async () => {
        const focused = makeEventElement(
            new Date(2026, 7, 20, 9, 0),
            new Date(2026, 7, 20, 10, 0),
            { top: 0, left: 0, width: 50, height: 30 },
            "event-id"
        );
        const previewGrabbedEvent = jest.fn();
        const commitGrabbedEvent = jest.fn(async () => true);
        const onGrabModeChange = jest.fn();
        const navigator = new CalendarEventNavigator(makeContainer([focused]), {
            canGrabEvent: () => true,
            previewGrabbedEvent,
            commitGrabbedEvent,
            onGrabModeChange,
        });
        navigator.activate(new Date(2026, 7, 20, 9, 0));

        expect(navigator.handleKey("m")).toBe(true);
        expect(navigator.isGrabbing()).toBe(true);
        expect(focused.classList.contains("ofc-grabbed-calendar-event")).toBe(
            true
        );
        expect(focused.getAttribute("aria-grabbed")).toBe("true");

        navigator.handleKey("2");
        navigator.handleKey("ArrowDown");
        navigator.handleKey("l");
        expect(navigator.getGrabbedEvent()).toEqual({
            eventId: "event-id",
            start: new Date(2026, 7, 21, 9, 30),
            end: new Date(2026, 7, 21, 10, 30),
        });
        expect(previewGrabbedEvent).toHaveBeenCalledTimes(2);

        const confirmation = jest.spyOn(navigator, "confirmGrabbedEvent");
        expect(navigator.handleKey("Enter")).toBe(true);
        await expect(confirmation.mock.results[0].value).resolves.toBe(true);
        expect(commitGrabbedEvent).toHaveBeenCalledWith({
            eventId: "event-id",
            start: new Date(2026, 7, 21, 9, 30),
            end: new Date(2026, 7, 21, 10, 30),
        });
        expect(focused.click).not.toHaveBeenCalled();
        expect(navigator.isGrabbing()).toBe(false);
        expect(onGrabModeChange.mock.calls).toEqual([[true], [false]]);
    });

    it("persists the moved position with Escape and makes it undoable", async () => {
        const start = new Date(2026, 7, 20, 9, 0);
        const end = new Date(2026, 7, 20, 10, 0);
        const focused = makeEventElement(
            start,
            end,
            { top: 0, left: 0, width: 50, height: 30 },
            "event-id"
        );
        const previewGrabbedEvent = jest.fn();
        const commitGrabbedEvent = jest.fn(async () => true);
        const navigator = new CalendarEventNavigator(makeContainer([focused]), {
            previewGrabbedEvent,
            commitGrabbedEvent,
        });
        navigator.activate(start);

        navigator.handleKey("m");
        navigator.handleKey("ArrowUp");
        const confirmation = jest.spyOn(navigator, "confirmGrabbedEvent");
        expect(navigator.handleKey("Escape")).toBe(true);
        await expect(confirmation.mock.results[0].value).resolves.toBe(true);

        const moved = {
            eventId: "event-id",
            start: new Date(2026, 7, 20, 8, 45),
            end: new Date(2026, 7, 20, 9, 45),
        };
        expect(commitGrabbedEvent).toHaveBeenLastCalledWith(moved);
        expect(previewGrabbedEvent).toHaveBeenLastCalledWith(moved);
        expect(navigator.isGrabbing()).toBe(false);
        expect(navigator.canUndoMove()).toBe(true);
        expect(focused.classList.contains("ofc-grabbed-calendar-event")).toBe(
            false
        );

        await expect(navigator.undoMove()).resolves.toBe(true);
        expect(commitGrabbedEvent).toHaveBeenLastCalledWith({
            eventId: "event-id",
            start,
            end,
        });
        expect(navigator.canRedoMove()).toBe(true);
    });

    it("undoes and redoes one completed grab as one move", async () => {
        const start = new Date(2026, 7, 20, 9, 0);
        const end = new Date(2026, 7, 20, 10, 0);
        const focused = makeEventElement(
            start,
            end,
            { top: 0, left: 0, width: 50, height: 30 },
            "event-id"
        );
        const previewGrabbedEvent = jest.fn();
        const commitGrabbedEvent = jest.fn(async () => true);
        const navigator = new CalendarEventNavigator(makeContainer([focused]), {
            previewGrabbedEvent,
            commitGrabbedEvent,
        });
        navigator.activate(start);
        navigator.handleKey("m");
        navigator.handleKey("2");
        navigator.handleKey("j");
        navigator.handleKey("l");
        await navigator.confirmGrabbedEvent();

        const moved = {
            eventId: "event-id",
            start: new Date(2026, 7, 21, 9, 30),
            end: new Date(2026, 7, 21, 10, 30),
        };
        expect(navigator.canUndoMove()).toBe(true);
        expect(navigator.canRedoMove()).toBe(false);

        await expect(navigator.undoMove()).resolves.toBe(true);
        expect(previewGrabbedEvent).toHaveBeenLastCalledWith({
            eventId: "event-id",
            start,
            end,
        });
        expect(commitGrabbedEvent).toHaveBeenLastCalledWith({
            eventId: "event-id",
            start,
            end,
        });
        expect(navigator.canUndoMove()).toBe(false);
        expect(navigator.canRedoMove()).toBe(true);

        await expect(navigator.redoMove()).resolves.toBe(true);
        expect(previewGrabbedEvent).toHaveBeenLastCalledWith(moved);
        expect(commitGrabbedEvent).toHaveBeenLastCalledWith(moved);
        expect(navigator.canUndoMove()).toBe(true);
        expect(navigator.canRedoMove()).toBe(false);

        navigator.forgetEvent("event-id");
        expect(navigator.canUndoMove()).toBe(false);
        expect(navigator.canRedoMove()).toBe(false);
    });

    it("routes u and U to move history with counts", () => {
        const focused = makeEventElement(
            new Date(2026, 7, 20, 9, 0),
            new Date(2026, 7, 20, 10, 0),
            { top: 0, left: 0, width: 50, height: 30 },
            "event-id"
        );
        const navigator = new CalendarEventNavigator(makeContainer([focused]));
        const undoMove = jest
            .spyOn(navigator, "undoMove")
            .mockResolvedValue(true);
        const redoMove = jest
            .spyOn(navigator, "redoMove")
            .mockResolvedValue(true);
        navigator.activate(new Date(2026, 7, 20, 9, 0));

        navigator.handleKey("2");
        expect(navigator.handleKey("u")).toBe(true);
        navigator.handleKey("3");
        expect(navigator.handleKey("U")).toBe(true);

        expect(undoMove).toHaveBeenCalledWith(2);
        expect(redoMove).toHaveBeenCalledWith(3);
    });

    it("aligns the focused block with zz, zt, and zb in normal and grab modes", () => {
        const focused = makeEventElement(
            new Date(2026, 7, 20, 9, 0),
            new Date(2026, 7, 20, 10, 0),
            { top: 0, left: 0, width: 50, height: 30 },
            "event-id"
        );
        const navigator = new CalendarEventNavigator(makeContainer([focused]));
        navigator.activate(new Date(2026, 7, 20, 9, 0));
        (focused.scrollIntoView as jest.Mock).mockClear();

        navigator.handleKey("z");
        navigator.handleKey("z");
        navigator.handleKey("z");
        navigator.handleKey("t");
        navigator.handleKey("m");
        navigator.handleKey("z");
        navigator.handleKey("b");

        expect(focused.scrollIntoView).toHaveBeenNthCalledWith(1, {
            block: "center",
            inline: "nearest",
        });
        expect(focused.scrollIntoView).toHaveBeenNthCalledWith(2, {
            block: "start",
            inline: "nearest",
        });
        expect(focused.scrollIntoView).toHaveBeenNthCalledWith(3, {
            block: "end",
            inline: "nearest",
        });
        expect(navigator.isGrabbing()).toBe(true);
    });

    it("requests confirmed deletion with Delete or x only in normal mode", () => {
        const focused = makeEventElement(
            new Date(2026, 7, 20, 9, 0),
            new Date(2026, 7, 20, 10, 0),
            { top: 0, left: 0, width: 50, height: 30 },
            "event-id"
        );
        const requestDeleteEvent = jest.fn();
        const navigator = new CalendarEventNavigator(makeContainer([focused]), {
            requestDeleteEvent,
        });
        navigator.activate(new Date(2026, 7, 20, 9, 0));

        expect(navigator.handleKey("Delete")).toBe(true);
        expect(navigator.handleKey("x")).toBe(true);
        expect(navigator.handleKey("Delete", true)).toBe(true);
        expect(requestDeleteEvent.mock.calls).toEqual([
            ["event-id"],
            ["event-id"],
        ]);

        navigator.handleKey("m");
        expect(navigator.handleKey("x")).toBe(true);
        expect(requestDeleteEvent).toHaveBeenCalledTimes(2);
        expect(navigator.isGrabbing()).toBe(true);
    });

    it("keeps failed undo history and restores the moved preview", async () => {
        const start = new Date(2026, 7, 20, 9, 0);
        const focused = makeEventElement(
            start,
            new Date(2026, 7, 20, 10, 0),
            { top: 0, left: 0, width: 50, height: 30 },
            "event-id"
        );
        const previewGrabbedEvent = jest.fn();
        const commitGrabbedEvent = jest
            .fn<Promise<boolean>, []>()
            .mockResolvedValueOnce(true)
            .mockResolvedValueOnce(false);
        const navigator = new CalendarEventNavigator(makeContainer([focused]), {
            previewGrabbedEvent,
            commitGrabbedEvent,
        });
        navigator.activate(start);
        navigator.handleKey("m");
        navigator.handleKey("ArrowDown");
        await navigator.confirmGrabbedEvent();
        const moved = {
            eventId: "event-id",
            start: new Date(2026, 7, 20, 9, 15),
            end: new Date(2026, 7, 20, 10, 15),
        };

        await expect(navigator.undoMove()).resolves.toBe(false);

        expect(previewGrabbedEvent).toHaveBeenLastCalledWith(moved);
        expect(navigator.canUndoMove()).toBe(true);
        expect(navigator.canRedoMove()).toBe(false);
    });

    it("does not record a grab that exits without moving", async () => {
        const start = new Date(2026, 7, 20, 9, 0);
        const focused = makeEventElement(
            start,
            new Date(2026, 7, 20, 10, 0),
            { top: 0, left: 0, width: 50, height: 30 },
            "event-id"
        );
        const commitGrabbedEvent = jest.fn(async () => true);
        const navigator = new CalendarEventNavigator(makeContainer([focused]), {
            commitGrabbedEvent,
        });
        navigator.activate(start);
        navigator.handleKey("m");

        await expect(navigator.confirmGrabbedEvent()).resolves.toBe(true);

        expect(commitGrabbedEvent).not.toHaveBeenCalled();
        expect(navigator.canUndoMove()).toBe(false);
    });

    it("reattaches grab focus when FullCalendar replaces the event element", () => {
        const original = makeEventElement(
            new Date(2026, 7, 20, 9, 0),
            new Date(2026, 7, 20, 10, 0),
            { top: 0, left: 0, width: 50, height: 30 },
            "event-id"
        );
        let renderedEvents = [original];
        const container = {
            classList: { add: jest.fn(), remove: jest.fn() },
            querySelectorAll: jest.fn(() => renderedEvents),
        } as unknown as HTMLElement;
        const navigator = new CalendarEventNavigator(container);
        navigator.activate(new Date(2026, 7, 20, 9, 0));
        navigator.handleKey("m");
        navigator.handleKey("ArrowDown");

        const replacement = makeEventElement(
            new Date(2026, 7, 20, 9, 15),
            new Date(2026, 7, 20, 10, 15),
            { top: 25, left: 0, width: 50, height: 30 },
            "event-id"
        );
        renderedEvents = [replacement];

        expect(navigator.syncToView()).toBe(true);
        expect(navigator.getFocusedEvent()).toBe(replacement);
        expect(
            replacement.classList.contains("ofc-grabbed-calendar-event")
        ).toBe(true);
        expect(navigator.getFocusedDate()).toEqual(
            new Date(2026, 7, 20, 9, 15)
        );
    });

    it("keeps insert, today, and view-cycle keys from escaping grab mode", () => {
        const focused = makeEventElement(
            new Date(2026, 7, 20, 9, 0),
            new Date(2026, 7, 20, 10, 0),
            { top: 0, left: 0, width: 50, height: 30 },
            "event-id"
        );
        const navigator = new CalendarEventNavigator(makeContainer([focused]));
        navigator.activate(new Date(2026, 7, 20, 9, 0));
        navigator.handleKey("m");

        expect(navigator.handleKey("i")).toBe(true);
        expect(navigator.handleKey("t")).toBe(true);
        expect(navigator.handleKey("Tab")).toBe(true);
        expect(navigator.handleKey("g")).toBe(true);
        expect(navigator.isGrabbing()).toBe(true);
        expect(focused.click).not.toHaveBeenCalled();
    });

    it("consumes m without entering grab mode for an unsupported event", () => {
        const focused = makeEventElement(
            new Date(2026, 7, 20, 9, 0),
            new Date(2026, 7, 20, 10, 0),
            { top: 0, left: 0, width: 50, height: 30 },
            "recurring-id"
        );
        const onGrabUnavailable = jest.fn();
        const navigator = new CalendarEventNavigator(makeContainer([focused]), {
            canGrabEvent: () => false,
            onGrabUnavailable,
        });
        navigator.activate(new Date(2026, 7, 20, 9, 0));

        expect(navigator.handleKey("m")).toBe(true);
        expect(navigator.isGrabbing()).toBe(false);
        expect(onGrabUnavailable).toHaveBeenCalledTimes(1);
    });
});

describe("calendar move redo shortcut", () => {
    const makeShortcut = (
        overrides: Partial<
            Pick<
                KeyboardEvent,
                "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey"
            >
        > = {}
    ) => ({
        key: "r",
        ctrlKey: true,
        metaKey: false,
        altKey: false,
        shiftKey: false,
        ...overrides,
    });

    it("accepts Ctrl+r without claiming other modifier combinations", () => {
        expect(isCalendarMoveRedoShortcut(makeShortcut())).toBe(true);
        expect(
            isCalendarMoveRedoShortcut(makeShortcut({ shiftKey: true }))
        ).toBe(false);
        expect(
            isCalendarMoveRedoShortcut(makeShortcut({ ctrlKey: false }))
        ).toBe(false);
        expect(
            isCalendarMoveRedoShortcut(makeShortcut({ metaKey: true }))
        ).toBe(false);
        expect(isCalendarMoveRedoShortcut(makeShortcut({ key: "u" }))).toBe(
            false
        );
    });
});

describe("calendar event navigation seam", () => {
    it("passes the originating calendar leaf to normal event navigation", async () => {
        const originatingLeaf = {} as WorkspaceLeaf;
        const openModified = jest.fn(async () => true);
        const openInOriginatingLeaf = jest.fn(async () => true);

        await expect(
            navigateFromCalendarEvent({
                eventId: "event-id",
                originatingLeaf,
                modified: false,
                openModified,
                openInOriginatingLeaf,
            })
        ).resolves.toBe(true);
        expect(openInOriginatingLeaf).toHaveBeenCalledWith(
            "event-id",
            originatingLeaf
        );
        expect(openModified).not.toHaveBeenCalled();
    });

    it("keeps modifier-click on its separate navigation path", async () => {
        const openModified = jest.fn(async () => true);
        const openInOriginatingLeaf = jest.fn(async () => false);
        await expect(
            navigateFromCalendarEvent({
                eventId: "event-id",
                originatingLeaf: {} as WorkspaceLeaf,
                modified: true,
                openModified,
                openInOriginatingLeaf,
            })
        ).resolves.toBe(true);
        expect(openModified).toHaveBeenCalledWith("event-id");
        expect(openInOriginatingLeaf).not.toHaveBeenCalled();
    });

    it("does not invent an editor fallback when a non-local event is rejected", async () => {
        const openModified = jest.fn(async () => false);
        const openInOriginatingLeaf = jest.fn(async () => false);

        await expect(
            navigateFromCalendarEvent({
                eventId: "non-local-event",
                originatingLeaf: {} as WorkspaceLeaf,
                modified: true,
                openModified,
                openInOriginatingLeaf,
            })
        ).resolves.toBe(false);
        expect(openInOriginatingLeaf).not.toHaveBeenCalled();
    });
});
