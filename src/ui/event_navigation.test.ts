import type { WorkspaceLeaf } from "obsidian";
import {
    CalendarEventNavigator,
    getDirectionalEventIndex,
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

        await expect(navigator.confirmGrabbedEvent()).resolves.toBe(true);
        expect(commitGrabbedEvent).toHaveBeenCalledWith({
            eventId: "event-id",
            start: new Date(2026, 7, 21, 9, 30),
            end: new Date(2026, 7, 21, 10, 30),
        });
        expect(navigator.isGrabbing()).toBe(false);
        expect(onGrabModeChange.mock.calls).toEqual([[true], [false]]);
    });

    it("restores the original position with Escape", () => {
        const start = new Date(2026, 7, 20, 9, 0);
        const end = new Date(2026, 7, 20, 10, 0);
        const focused = makeEventElement(
            start,
            end,
            { top: 0, left: 0, width: 50, height: 30 },
            "event-id"
        );
        const previewGrabbedEvent = jest.fn();
        const navigator = new CalendarEventNavigator(makeContainer([focused]), {
            previewGrabbedEvent,
        });
        navigator.activate(start);

        navigator.handleKey("m");
        navigator.handleKey("ArrowUp");
        expect(navigator.handleKey("Escape")).toBe(true);

        expect(previewGrabbedEvent).toHaveBeenLastCalledWith({
            eventId: "event-id",
            start,
            end,
        });
        expect(navigator.isGrabbing()).toBe(false);
        expect(focused.classList.contains("ofc-grabbed-calendar-event")).toBe(
            false
        );
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
