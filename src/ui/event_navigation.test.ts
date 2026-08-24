import type { WorkspaceLeaf } from "obsidian";
import {
    CalendarEventNavigator,
    getDirectionalEventIndex,
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
