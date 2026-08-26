jest.mock("@fullcalendar/core", () => ({
    ...jest.requireActual("@fullcalendar/core"),
    Calendar: jest.fn().mockImplementation(() => ({ render: jest.fn() })),
}));

import { Calendar, CalendarOptions } from "@fullcalendar/core";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
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
    scrollCalendarDateIntoView,
    TOUCH_LONG_PRESS_DELAY_MS,
} from "./calendar";

describe("calendar renderer", () => {
    it("emits privacy-safe construction and render checkpoints", () => {
        const diagnostic = jest.fn();
        renderCalendar(
            {} as HTMLElement,
            [
                {
                    id: "private-source-id",
                    events: [
                        {
                            id: "private-event-id",
                            title: "Private event title",
                            start: "2026-08-26T09:00:00",
                        },
                    ],
                },
            ],
            { diagnostic, isMobile: true }
        );

        expect(diagnostic.mock.calls.map(([event]) => event)).toEqual([
            "construct.start",
            "construct.complete",
            "render.complete",
        ]);
        expect(diagnostic.mock.calls[0][1]).toMatchObject({
            isMobile: true,
            sourceCount: 1,
            inputEventCount: 1,
        });
        const serialized = JSON.stringify(diagnostic.mock.calls);
        expect(serialized).not.toContain("Private event title");
        expect(serialized).not.toContain("private-source-id");
        expect(serialized).not.toContain("private-event-id");
    });

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
            interactionPlugin,
            rrulePlugin,
        ]);
        expect(options?.headerToolbar).toMatchObject({
            right: "dayGridMonth,timeGridWeek",
        });
        expect(options?.slotDuration).toBe("00:15:00");
        expect(options?.snapDuration).toBe("00:15:00");
        expect(options?.slotLabelInterval).toBe("00:15:00");
        // FullCalendar 5 routes dayMinWidth through its unbundled premium
        // ScrollGrid implementation and throws before rendering without it.
        expect(options?.views?.timeGridWeek?.dayMinWidth).toBeUndefined();
        expect(options?.longPressDelay).toBe(TOUCH_LONG_PRESS_DELAY_MS);
        expect(options?.selectLongPressDelay).toBe(TOUCH_LONG_PRESS_DELAY_MS);
        expect(options?.eventLongPressDelay).toBe(TOUCH_LONG_PRESS_DELAY_MS);
        expect(
            (options?.slotLabelClassNames as any)?.({
                date: new Date(2026, 7, 23, 9, 0),
            })
        ).toEqual(["ofc-time-label-major"]);
        expect(
            (options?.slotLabelClassNames as any)?.({
                date: new Date(2026, 7, 23, 9, 15),
            })
        ).toEqual(["ofc-time-label-minor", "ofc-time-label-quarter"]);
        expect(
            (options?.slotLabelClassNames as any)?.({
                date: new Date(2026, 7, 23, 9, 30),
            })
        ).toEqual(["ofc-time-label-minor", "ofc-time-label-half"]);
        expect(
            (options?.slotLaneClassNames as any)?.({
                date: new Date(2026, 7, 23, 9, 15),
            })
        ).toEqual(["ofc-time-slot-minor"]);
    });

    it("limits the primary toolbar to month and week without reading viewport width", () => {
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
            right: "dayGridMonth,timeGridWeek",
        });
        expect(options.footerToolbar).toBe(false);
        expect(options.views).not.toHaveProperty("timeGrid3Days");
        expect(options.views).not.toHaveProperty("timeGridDay");
        expect(options.views).not.toHaveProperty("listWeek");
    });

    it("places primary controls in the usable mobile footer", () => {
        renderCalendar({} as HTMLElement, [], {
            initialView: "timeGridWeek",
            isMobile: true,
        });

        const calls = (Calendar as unknown as jest.Mock).mock.calls;
        const options = calls[calls.length - 1][1] as CalendarOptions;
        expect(options.headerToolbar).toBe(false);
        expect(options.footerToolbar).toEqual({
            left: "prev,next today",
            center: "title",
            right: "dayGridMonth,timeGridWeek",
        });
        expect(options.initialView).toBe("timeGridWeek");
    });

    it("renders the sidebar as one fixed day with compact navigation", () => {
        renderCalendar({} as HTMLElement, [], {
            initialView: "dayGridMonth",
            variant: "day-sidebar",
            isMobile: true,
        });

        const calls = (Calendar as unknown as jest.Mock).mock.calls;
        const options = calls[calls.length - 1][1] as CalendarOptions;
        expect(options.plugins).toEqual([
            timeGridPlugin,
            interactionPlugin,
            rrulePlugin,
        ]);
        expect(options.initialView).toBe("timeGridDay");
        expect(options.headerToolbar).toEqual({
            left: "prev,next",
            center: "title",
            right: "today",
        });
        expect(options.footerToolbar).toBe(false);
        expect(options.views?.timeGridDay).toMatchObject({
            duration: { days: 1 },
        });
        expect(options.views).not.toHaveProperty("timeGridWeek");
        expect(
            (options.views?.timeGridDay?.titleFormat as any)?.({
                start: { year: 2026, month: 7, day: 23 },
            })
        ).toBe("2026-08-23");
    });

    it("shows only the weekday inside the fixed Day grid", () => {
        const renderHeader = (variant?: "day-sidebar") => {
            const spans: Array<{
                cls: string;
                text: string;
                setAttribute: jest.Mock;
            }> = [];
            const header = {
                addClass: jest.fn(),
                createSpan: jest.fn(
                    ({ cls, text }: { cls: string; text: string }) => {
                        const span = {
                            cls,
                            text,
                            setAttribute: jest.fn(),
                        };
                        spans.push(span);
                        return span;
                    }
                ),
            };
            Object.defineProperty(global, "document", {
                configurable: true,
                value: { createElement: () => header },
            });
            renderCalendar({} as HTMLElement, [], { variant });
            const calls = (Calendar as unknown as jest.Mock).mock.calls;
            const options = calls[calls.length - 1][1] as CalendarOptions;
            (options.dayHeaderContent as any)({
                date: new Date(2026, 7, 25),
                text: "Tuesday",
                view: { type: variant ? "timeGridDay" : "timeGridWeek" },
            });
            return spans;
        };

        const daySpans = renderHeader("day-sidebar");
        const weekSpans = renderHeader();
        delete (global as any).document;

        expect(daySpans.map(({ cls }) => cls)).toEqual([
            "ofc-day-header-weekday",
        ]);
        expect(daySpans[0].text).toBe("Tuesday");
        expect(daySpans[0].setAttribute).not.toHaveBeenCalledWith(
            "aria-hidden",
            "true"
        );
        expect(weekSpans.map(({ cls }) => cls)).toEqual([
            "ofc-day-header-weekday",
            "ofc-day-header-date ofc-day-header-date-full",
            "ofc-day-header-date ofc-day-header-date-compact",
        ]);
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

    it("marks recurring instances for their visual badge", () => {
        renderCalendar({} as HTMLElement, []);
        const calls = (Calendar as unknown as jest.Mock).mock.calls;
        const options = calls[calls.length - 1][1] as any;
        const addClass = jest.fn();

        options.eventDidMount({
            event: {
                display: "auto",
                extendedProps: { categories: [], ofcRecurring: true },
            },
            el: {
                dataset: {},
                style: { setProperty: jest.fn() },
                addClass,
                addEventListener: jest.fn(),
            },
            backgroundColor: "",
            textColor: "black",
        });

        expect(addClass).toHaveBeenCalledWith("ofc-event-recurring");
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
                id: "event-id",
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
            ofcEventId: "event-id",
            ofcEventStart: start.toISOString(),
            ofcEventEnd: end.toISOString(),
        });
        expect(element.tabIndex).toBe(-1);
        expect(options.eventsSet).toBe(eventsSet);
    });

    it("can render directly on a return-navigation date", () => {
        const initialDate = new Date(2026, 7, 23, 18, 0);

        renderCalendar({} as HTMLElement, [], { initialDate });

        const calls = (Calendar as unknown as jest.Mock).mock.calls;
        const options = calls[calls.length - 1][1] as CalendarOptions;
        expect(options.initialDate).toBe(initialDate);
    });

    it("does not ghost explicitly attended occurrences", () => {
        renderCalendar({} as HTMLElement, [], {
            ghostEventTags: () => ["ghost"],
        });
        const calls = (Calendar as unknown as jest.Mock).mock.calls;
        const options = calls[calls.length - 1][1] as any;
        const attendedAddClass = jest.fn();
        const unattendedAddClass = jest.fn();
        const element = (addClass: jest.Mock) => ({
            dataset: {},
            style: { setProperty: jest.fn() },
            addClass,
            addEventListener: jest.fn(),
            tabIndex: 0,
        });

        options.eventDidMount({
            event: {
                start: new Date(2026, 7, 24, 9, 0),
                display: "auto",
                extendedProps: {
                    categories: ["ghost"],
                    attendingDates: ["2026-08-17", "2026-08-24"],
                },
            },
            el: element(attendedAddClass),
            backgroundColor: "",
            textColor: "black",
        });
        options.eventDidMount({
            event: {
                start: new Date(2026, 7, 31, 9, 0),
                display: "auto",
                extendedProps: {
                    categories: ["ghost"],
                    attendingDates: ["2026-08-17", "2026-08-24"],
                },
            },
            el: element(unattendedAddClass),
            backgroundColor: "",
            textColor: "black",
        });

        expect(attendedAddClass).not.toHaveBeenCalledWith("ofc-event-ghost");
        expect(unattendedAddClass).toHaveBeenCalledWith("ofc-event-ghost");
    });
});

describe("calendar labels", () => {
    it("centers a rendered week date through its header", () => {
        const scrollIntoView = jest.fn();
        const querySelector = jest.fn(() => ({ scrollIntoView }));
        const date = new Date(2026, 7, 25);

        expect(
            scrollCalendarDateIntoView(
                { querySelector } as unknown as HTMLElement,
                date
            )
        ).toBe(true);
        expect(querySelector).toHaveBeenCalledWith(
            '.fc-col-header-cell[data-date="2026-08-25"]'
        );
        expect(scrollIntoView).toHaveBeenCalledWith({
            behavior: "auto",
            block: "nearest",
            inline: "center",
        });
    });

    it("leaves an unrendered date alone", () => {
        expect(
            scrollCalendarDateIntoView(
                {
                    querySelector: () => null,
                } as unknown as HTMLElement,
                new Date(2026, 7, 25)
            )
        ).toBe(false);
    });

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
        expect(getAdjacentCalendarView("timeGridWeek")).toBe("dayGridMonth");
        expect(getAdjacentCalendarView("dayGridMonth", true)).toBe(
            "timeGridWeek"
        );
    });
});
