jest.mock("@fullcalendar/core", () => ({
    ...jest.requireActual("@fullcalendar/core"),
    Calendar: jest.fn().mockImplementation(() => ({ render: jest.fn() })),
}));

import { Calendar, CalendarOptions } from "@fullcalendar/core";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import listPlugin from "@fullcalendar/list";
import rrulePlugin from "@fullcalendar/rrule";
import timeGridPlugin from "@fullcalendar/timegrid";
import {
    formatCompactDateLabel,
    formatDateLabel,
    formatLongDateTitle,
    formatTimeLabel,
    formatTimeGridSlotLabel,
    getAdjacentCalendarView,
    getRenderedEventTitle,
    LocalMaterializedEventSource,
    renderCalendar,
} from "./calendar";

describe("calendar renderer", () => {
    it("passes materialized events unchanged to the retained view plugins", () => {
        Object.defineProperty(global, "window", {
            configurable: true,
            value: { innerWidth: 1024 },
        });
        const eventSources: LocalMaterializedEventSource[] = [
            {
                id: "local",
                events: [
                    { id: "single", title: "Single", start: "2026-08-22" },
                    {
                        id: "weekly",
                        title: "Weekly",
                        daysOfWeek: [1],
                        startTime: "09:00",
                    },
                ],
            },
        ];

        renderCalendar({} as HTMLElement, eventSources);

        const calls = (Calendar as unknown as jest.Mock).mock.calls;
        const options = calls[calls.length - 1][1] as
            | CalendarOptions
            | undefined;
        expect(options?.eventSources).toBe(eventSources);
        expect(options?.plugins).toEqual([
            dayGridPlugin,
            timeGridPlugin,
            listPlugin,
            interactionPlugin,
            rrulePlugin,
        ]);
        expect(options?.headerToolbar).toMatchObject({
            right: "dayGridMonth,timeGridWeek,timeGridDay,listWeek",
        });
        expect(options?.slotDuration).toBe("00:15:00");
        expect(options?.snapDuration).toBe("00:15:00");
        expect(options?.slotLabelInterval).toBe("00:15:00");
        expect(
            (options?.slotLabelClassNames as any)?.({
                date: new Date(2026, 7, 23, 9, 0),
            })
        ).toEqual(["ofc-time-label-major"]);
        expect(
            (options?.slotLaneClassNames as any)?.({
                date: new Date(2026, 7, 23, 9, 15),
            })
        ).toEqual(["ofc-time-slot-minor"]);
    });

    it("uses the same desktop toolbar and initial view without reading viewport width", () => {
        Object.defineProperty(global, "window", {
            configurable: true,
            value: Object.defineProperty({}, "innerWidth", {
                get: () => {
                    throw new Error("viewport width must not be read");
                },
            }),
        });

        renderCalendar({} as HTMLElement, [], { initialView: "dayGridMonth" });

        const calls = (Calendar as unknown as jest.Mock).mock.calls;
        const options = calls[calls.length - 1][1] as CalendarOptions;
        expect(options.initialView).toBe("dayGridMonth");
        expect(options.headerToolbar).toEqual({
            left: "prev,next today",
            center: "title",
            right: "dayGridMonth,timeGridWeek,timeGridDay,listWeek",
        });
        expect(options.footerToolbar).toBe(false);
        expect(options.views).not.toHaveProperty("timeGrid3Days");
        expect(options.views?.timeGridDay).toMatchObject({
            duration: { days: 1 },
            buttonText: "day",
        });
    });

    it("retains daily-note links and click navigation on time-grid headers", () => {
        Object.defineProperty(global, "window", {
            configurable: true,
            value: { innerWidth: 1024 },
        });
        const openDailyNote = jest.fn(async () => undefined);
        const dailyNotePath = jest.fn(() => "Daily/2026-08-22.md");
        renderCalendar({} as HTMLElement, [], {
            dailyNotePath,
            openDailyNote,
        });
        const calls = (Calendar as unknown as jest.Mock).mock.calls;
        const options = calls[calls.length - 1][1] as
            | CalendarOptions
            | undefined;
        const classes: string[] = [];
        const attributes: Record<string, string> = {};
        let click: ((event: any) => void) | undefined;
        const link = {
            addClass: (...values: string[]) => classes.push(...values),
            setAttribute: (name: string, value: string) => {
                attributes[name] = value;
            },
            addEventListener: (
                type: string,
                callback: (event: any) => void
            ) => {
                if (type === "click") click = callback;
            },
        };
        const date = new Date(2026, 7, 22, 12, 0, 0);
        options?.dayHeaderDidMount?.({
            date,
            el: { querySelector: () => link },
            view: { type: "timeGridWeek" },
        } as any);

        expect(dailyNotePath).toHaveBeenCalledWith(date);
        expect(classes).toEqual(["ofc-daily-note-link", "internal-link"]);
        expect(attributes.href).toBe("Daily/2026-08-22.md");
        expect(attributes["data-href"]).toBe("Daily/2026-08-22.md");
        expect(attributes["aria-label"]).toContain("2026-08-22");

        const event = {
            preventDefault: jest.fn(),
            stopPropagation: jest.fn(),
        };
        click?.(event);
        expect(event.preventDefault).toHaveBeenCalled();
        expect(event.stopPropagation).toHaveBeenCalled();
        expect(openDailyNote).toHaveBeenCalledWith(date);
    });

    it("delegates drag and resize while reverting only rejected edits", async () => {
        Object.defineProperty(global, "window", {
            configurable: true,
            value: { innerWidth: 1024 },
        });
        const modifyEvent = jest
            .fn()
            .mockResolvedValueOnce(true)
            .mockResolvedValueOnce(false);
        renderCalendar({} as HTMLElement, [], { modifyEvent });
        const calls = (Calendar as unknown as jest.Mock).mock.calls;
        const options = calls[calls.length - 1][1] as any;
        const acceptedRevert = jest.fn();
        const rejectedRevert = jest.fn();
        const event = { id: "event" };
        const oldEvent = { id: "old-event" };

        await options.eventDrop({ event, oldEvent, revert: acceptedRevert });
        await options.eventResize({ event, oldEvent, revert: rejectedRevert });

        expect(modifyEvent).toHaveBeenNthCalledWith(1, event, oldEvent);
        expect(modifyEvent).toHaveBeenNthCalledWith(2, event, oldEvent);
        expect(acceptedRevert).not.toHaveBeenCalled();
        expect(rejectedRevert).toHaveBeenCalledTimes(1);
    });

    it("does not render task checkboxes or completion classes", () => {
        Object.defineProperty(global, "window", {
            configurable: true,
            value: { innerWidth: 1024 },
        });
        const createElement = jest.fn();
        Object.defineProperty(global, "document", {
            configurable: true,
            value: { createElement },
        });
        renderCalendar({} as HTMLElement, []);
        const calls = (Calendar as unknown as jest.Mock).mock.calls;
        const options = calls[calls.length - 1][1] as any;
        const addClass = jest.fn();
        options.eventDidMount({
            event: {
                extendedProps: { isTask: true, taskCompleted: true },
            },
            el: {
                style: { setProperty: jest.fn() },
                addClass,
                addEventListener: jest.fn(),
            },
            backgroundColor: "",
            textColor: "black",
        });

        expect(createElement).not.toHaveBeenCalled();
        expect(addClass).not.toHaveBeenCalledWith("ofc-task-completed");
        delete (global as any).document;
    });

    it("marks events matching a configured ghost tag", () => {
        renderCalendar({} as HTMLElement, [], {
            ghostEventTags: () => ["jen"],
        });
        const calls = (Calendar as unknown as jest.Mock).mock.calls;
        const options = calls[calls.length - 1][1] as any;
        const addClass = jest.fn();

        options.eventDidMount({
            event: { extendedProps: { categories: ["dance", "JEN"] } },
            el: {
                style: { setProperty: jest.fn() },
                addClass,
                addEventListener: jest.fn(),
            },
            backgroundColor: "",
            textColor: "black",
        });

        expect(addClass).toHaveBeenCalledWith("ofc-event-ghost");
    });

    it("annotates foreground events for normal-mode focus", () => {
        const eventsSet = jest.fn();
        renderCalendar({} as HTMLElement, [], { eventsSet });
        const calls = (Calendar as unknown as jest.Mock).mock.calls;
        const options = calls[calls.length - 1][1] as any;
        const start = new Date(2026, 7, 23, 18, 0);
        const end = new Date(2026, 7, 23, 18, 15);
        const element = {
            dataset: {},
            style: { setProperty: jest.fn() },
            addClass: jest.fn(),
            addEventListener: jest.fn(),
            tabIndex: 0,
        };

        options.eventDidMount({
            event: {
                start,
                end,
                display: "auto",
                extendedProps: { categories: [] },
            },
            el: element,
            backgroundColor: "",
            textColor: "black",
        });

        expect(element.dataset).toEqual({
            ofcEventStart: start.toISOString(),
            ofcEventEnd: end.toISOString(),
        });
        expect(element.tabIndex).toBe(-1);
        expect(options.eventsSet).toBe(eventsSet);
    });
});

describe("calendar labels", () => {
    it("always formats time labels as HH:MM", () => {
        expect(formatTimeLabel(new Date(2026, 7, 21, 0, 0))).toBe("00:00");
        expect(formatTimeLabel(new Date(2026, 7, 21, 8, 5))).toBe("08:05");
        expect(formatTimeLabel(new Date(2026, 7, 21, 23, 45))).toBe("23:45");
    });

    it("distinguishes major hour labels from compact quarter-hour labels", () => {
        expect(formatTimeGridSlotLabel(new Date(2026, 7, 21, 8, 0))).toBe(
            "08:00"
        );
        expect(formatTimeGridSlotLabel(new Date(2026, 7, 21, 8, 15))).toBe(
            ":15"
        );
        expect(formatTimeGridSlotLabel(new Date(2026, 7, 21, 8, 45))).toBe(
            ":45"
        );
    });

    it("always formats date labels as YYYY-MM-DD", () => {
        expect(formatDateLabel(new Date(2026, 0, 2))).toBe("2026-01-02");
        expect(formatDateLabel(new Date(1999, 11, 31))).toBe("1999-12-31");
    });

    it("formats compact date labels without the year", () => {
        expect(formatCompactDateLabel(new Date(2026, 7, 23))).toBe("Aug 23");
        expect(formatCompactDateLabel(new Date(2026, 10, 4))).toBe("Nov 4");
    });

    it("formats day-view titles as a long-form date", () => {
        expect(formatLongDateTitle(new Date(2026, 7, 22))).toBe(
            "Saturday, 22 August 2026"
        );
    });

    it("removes a matching date prefix from only the rendered event title", () => {
        const date = new Date(2026, 7, 21);

        expect(getRenderedEventTitle("2026-08-21 - Project review", date)).toBe(
            "Project review"
        );
        expect(getRenderedEventTitle("2026-08-20 - Project review", date)).toBe(
            "2026-08-20 - Project review"
        );
        expect(getRenderedEventTitle("Project review", date)).toBe(
            "Project review"
        );
    });

    it("cycles calendar views in both directions", () => {
        expect(getAdjacentCalendarView("dayGridMonth")).toBe("timeGridWeek");
        expect(getAdjacentCalendarView("listWeek")).toBe("dayGridMonth");
        expect(getAdjacentCalendarView("dayGridMonth", true)).toBe("listWeek");
    });
});
