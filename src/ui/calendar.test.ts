jest.mock("@fullcalendar/core", () => ({
    ...jest.requireActual("@fullcalendar/core"),
    Calendar: jest.fn().mockImplementation(() => ({ render: jest.fn() })),
}));

import {
    Calendar,
    CalendarOptions,
    EventSourceInput,
} from "@fullcalendar/core";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import listPlugin from "@fullcalendar/list";
import rrulePlugin from "@fullcalendar/rrule";
import timeGridPlugin from "@fullcalendar/timegrid";
import {
    formatDateLabel,
    formatLongDateTitle,
    formatTimeLabel,
    getAdjacentCalendarView,
    getRenderedEventTitle,
    renderCalendar,
} from "./calendar";

describe("calendar renderer", () => {
    it("passes materialized events unchanged to the retained view plugins", () => {
        Object.defineProperty(global, "window", {
            configurable: true,
            value: { innerWidth: 1024 },
        });
        const eventSources: EventSourceInput[] = [
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

        const options = (Calendar as unknown as jest.Mock).mock.calls[0][1] as
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
    });
});

describe("calendar labels", () => {
    it("always formats time labels as HH:MM", () => {
        expect(formatTimeLabel(new Date(2026, 7, 21, 0, 0))).toBe("00:00");
        expect(formatTimeLabel(new Date(2026, 7, 21, 8, 5))).toBe("08:05");
        expect(formatTimeLabel(new Date(2026, 7, 21, 23, 45))).toBe("23:45");
    });

    it("always formats date labels as YYYY-MM-DD", () => {
        expect(formatDateLabel(new Date(2026, 0, 2))).toBe("2026-01-02");
        expect(formatDateLabel(new Date(1999, 11, 31))).toBe("1999-12-31");
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
