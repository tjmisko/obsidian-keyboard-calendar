import type {
    Calendar,
    EventApi,
    EventInput,
    EventSourceApi,
} from "@fullcalendar/core";

import type { CacheEntry } from "../core/EventCache";
import type { OFCEvent } from "../types";
import type { LocalMaterializedEventSource } from "./calendar";
import { CalendarCellNavigator } from "./cell_navigation";
import { applyCalendarCacheUpdate } from "./calendar_update";
import { toEventInput } from "./interop";

const timedEvent = (
    title: string,
    startTime = "21:00",
    endTime = "22:00"
): OFCEvent => ({
    type: "single",
    title,
    date: "2026-08-23",
    endDate: null,
    startTime,
    endTime,
});

const cacheEntry = (
    id: string,
    title: string,
    sourceId = "local"
): CacheEntry => ({
    id,
    sourceId,
    event: timedEvent(title),
});

const sourceSnapshot = (
    entries: CacheEntry[],
    id = "local"
): LocalMaterializedEventSource => ({
    id,
    events: entries.flatMap(
        ({ id: eventId, event }) => toEventInput(eventId, event) || []
    ),
    editable: true,
});

type StoredEvent = {
    id: string;
    remove: jest.Mock<void, []>;
};

const makeCalendarHarness = (
    initialSource: LocalMaterializedEventSource = sourceSnapshot([])
) => {
    const renderedEvents: StoredEvent[] = [];
    const sources = new Map<string, EventSourceApi>();

    const addRenderedEvent = (eventInput: EventInput): EventApi => {
        const id = String(eventInput.id || "");
        const stored: StoredEvent = {
            id,
            remove: jest.fn(() => {
                const index = renderedEvents.indexOf(stored);
                if (index >= 0) renderedEvents.splice(index, 1);
            }),
        };
        renderedEvents.push(stored);
        return stored as unknown as EventApi;
    };

    const installSource = (source: LocalMaterializedEventSource) => {
        const sourceApi = { id: source.id } as EventSourceApi;
        sources.set(source.id, sourceApi);
        source.events.forEach(addRenderedEvent);
        return sourceApi;
    };
    installSource(initialSource);

    const batchRendering = jest.fn((callback: () => void) => callback());
    const removeAllEventSources = jest.fn(() => {
        sources.clear();
        renderedEvents.splice(0, renderedEvents.length);
    });
    const addEventSource = jest.fn((source: LocalMaterializedEventSource) =>
        installSource(source)
    );
    const getEventSourceById = jest.fn((id: string) => sources.get(id) || null);
    const getEventById = jest.fn(
        (id: string) =>
            (renderedEvents.find((event) => event.id === id) as unknown as
                | EventApi
                | undefined) || null
    );
    const addEvent: jest.Mock<EventApi | null, [EventInput, EventSourceApi?]> =
        jest.fn((eventInput: EventInput) => addRenderedEvent(eventInput));
    const gotoDate = jest.fn();
    const calendar = {
        batchRendering,
        removeAllEventSources,
        addEventSource,
        getEventSourceById,
        getEventById,
        addEvent,
        gotoDate,
        view: {
            type: "timeGridWeek",
            activeStart: new Date(2026, 7, 17),
            activeEnd: new Date(2026, 7, 24),
        },
    } as unknown as Calendar;

    return {
        calendar,
        batchRendering,
        removeAllEventSources,
        addEventSource,
        getEventSourceById,
        getEventById,
        addEvent,
        addRenderedEvent,
        gotoDate,
        renderedIds: () => renderedEvents.map(({ id }) => id),
    };
};

const applyEvents = (
    harness: ReturnType<typeof makeCalendarHarness>,
    toRemove: string[],
    toAdd: CacheEntry[],
    currentSources: LocalMaterializedEventSource[],
    renderSelection = jest.fn(),
    warn = jest.fn()
) => {
    const getEventSources = jest.fn(() => currentSources);
    applyCalendarCacheUpdate({
        calendar: harness.calendar,
        update: { type: "events", toRemove, toAdd },
        getEventSources,
        renderSelection,
        warn,
    });
    return { getEventSources, renderSelection, warn };
};

const expectOneCompleteRebuild = (
    harness: ReturnType<typeof makeCalendarHarness>,
    sourceCount = 1
) => {
    expect(harness.batchRendering).toHaveBeenCalledTimes(1);
    expect(harness.removeAllEventSources).toHaveBeenCalledTimes(1);
    expect(harness.addEventSource).toHaveBeenCalledTimes(sourceCount);
};

describe("calendar cache updates", () => {
    it("adds an event through its resolved source without rebuilding", () => {
        const harness = makeCalendarHarness();
        const added = cacheEntry("late-event", "Late event");
        const snapshot = sourceSnapshot([added]);

        const { getEventSources, renderSelection, warn } = applyEvents(
            harness,
            [],
            [added],
            [snapshot]
        );

        expect(harness.getEventSourceById).toHaveBeenCalledWith("local");
        expect(harness.addEvent).toHaveBeenCalledWith(
            expect.objectContaining({ id: "late-event" }),
            expect.objectContaining({ id: "local" })
        );
        expect(harness.renderedIds()).toEqual(["late-event"]);
        expect(harness.removeAllEventSources).not.toHaveBeenCalled();
        expect(getEventSources).not.toHaveBeenCalled();
        expect(renderSelection).toHaveBeenCalledTimes(1);
        expect(warn).not.toHaveBeenCalled();
    });

    it("rebuilds once when conversion returns no event", () => {
        const harness = makeCalendarHarness();
        const invalid = {
            ...cacheEntry("invalid", "Invalid event"),
            event: timedEvent("Invalid event", "not-a-time"),
        };
        const logError = jest
            .spyOn(console, "error")
            .mockImplementation(() => undefined);

        const { warn } = applyEvents(
            harness,
            [],
            [invalid],
            [sourceSnapshot([])]
        );

        logError.mockRestore();
        expectOneCompleteRebuild(harness);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn).toHaveBeenCalledWith(
            "Keyboard Calendar update fallback: event conversion returned null; event=invalid; source=local"
        );
    });

    it("rebuilds once when the event source is missing", () => {
        const harness = makeCalendarHarness();
        const added = cacheEntry("missing-source", "Recovered event", "gone");
        const recovered = { ...added, sourceId: "local" };

        const { warn } = applyEvents(
            harness,
            [],
            [added],
            [sourceSnapshot([recovered])]
        );

        expectOneCompleteRebuild(harness);
        expect(harness.renderedIds()).toEqual(["missing-source"]);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn).toHaveBeenCalledWith(
            "Keyboard Calendar update fallback: event source was not found; event=missing-source; source=gone"
        );
    });

    it("rebuilds once when addEvent returns null", () => {
        const harness = makeCalendarHarness();
        const added = cacheEntry("null-result", "Recovered event");
        harness.addEvent.mockReturnValueOnce(null);

        const { warn } = applyEvents(
            harness,
            [],
            [added],
            [sourceSnapshot([added])]
        );

        expectOneCompleteRebuild(harness);
        expect(harness.renderedIds()).toEqual(["null-result"]);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn).toHaveBeenCalledWith(
            "Keyboard Calendar update fallback: addEvent returned null; event=null-result; source=local"
        );
    });

    it("rebuilds once when the inserted event cannot be found by ID", () => {
        const harness = makeCalendarHarness();
        const added = cacheEntry("unverified", "Recovered event");
        harness.addEvent.mockReturnValueOnce({
            id: "unverified",
        } as EventApi);

        const { warn } = applyEvents(
            harness,
            [],
            [added],
            [sourceSnapshot([added])]
        );

        expectOneCompleteRebuild(harness);
        expect(harness.renderedIds()).toEqual(["unverified"]);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn).toHaveBeenCalledWith(
            "Keyboard Calendar update fallback: event ID was missing after addEvent; event=unverified; source=local"
        );
    });

    it("replaces partial mixed updates with exactly the cache snapshot", () => {
        const old = cacheEntry("old", "Old event");
        const stable = cacheEntry("stable", "Stable event");
        const first = cacheEntry("first", "First event");
        const second = cacheEntry("second", "Second event");
        const harness = makeCalendarHarness(sourceSnapshot([old, stable]));
        harness.addEvent
            .mockImplementationOnce((input: EventInput) =>
                harness.addRenderedEvent(input)
            )
            .mockReturnValueOnce(null);

        const { warn } = applyEvents(
            harness,
            ["old"],
            [first, second],
            [sourceSnapshot([stable, first, second])]
        );

        expectOneCompleteRebuild(harness);
        expect(harness.renderedIds()).toEqual(["stable", "first", "second"]);
        expect(new Set(harness.renderedIds()).size).toBe(3);
        expect(warn).toHaveBeenCalledTimes(1);
    });

    it("rebuilds every source for a cache resync and then restores selection", () => {
        const harness = makeCalendarHarness();
        const local = cacheEntry("local-event", "Local event");
        const order: string[] = [];
        harness.removeAllEventSources.mockImplementation(() => {
            order.push("remove");
        });
        harness.addEventSource.mockImplementation((source) => {
            order.push(`add:${source.id}`);
            return { id: source.id } as EventSourceApi;
        });
        const renderSelection = jest.fn(() => order.push("selection"));
        const warn = jest.fn();

        applyCalendarCacheUpdate({
            calendar: harness.calendar,
            update: { type: "resync" },
            getEventSources: () => [sourceSnapshot([local])],
            renderSelection,
            warn,
        });

        expectOneCompleteRebuild(harness);
        expect(order).toEqual(["remove", "add:local", "selection"]);
        expect(renderSelection).toHaveBeenCalledTimes(1);
        expect(harness.addEvent).not.toHaveBeenCalled();
        expect(warn).not.toHaveBeenCalled();
    });

    it("keeps a confirmed 21:00-22:00 keyboard event after the note round trip without reloading", async () => {
        const harness = makeCalendarHarness();
        const container = {
            classList: { add: jest.fn(), remove: jest.fn() },
            querySelector: jest.fn(() => null),
            querySelectorAll: jest.fn(() => []),
        } as unknown as HTMLElement;
        const added = cacheEntry("keyboard-event", "Untitled event");
        let openedNote = false;
        const navigator = new CalendarCellNavigator(
            container,
            harness.calendar,
            {
                now: () => new Date(2026, 7, 23, 21, 0),
                createEvent: async (start, end) => {
                    expect([start.getHours(), start.getMinutes()]).toEqual([
                        21, 0,
                    ]);
                    expect([end.getHours(), end.getMinutes()]).toEqual([22, 0]);
                    applyEvents(
                        harness,
                        [],
                        [added],
                        [sourceSnapshot([added])]
                    );
                    openedNote = true;
                },
            }
        );

        navigator.handleKey("Enter");
        navigator.handleKey("ArrowDown");
        navigator.handleKey("ArrowDown");
        navigator.handleKey("ArrowDown");
        await navigator.confirmEventDraft();
        expect(openedNote).toBe(true);

        // Returning to the preserved calendar leaf uses the same Calendar.
        expect(harness.getEventById("keyboard-event")).not.toBeNull();
        expect(harness.renderedIds()).toEqual(["keyboard-event"]);
        expect(harness.removeAllEventSources).not.toHaveBeenCalled();
    });
});
