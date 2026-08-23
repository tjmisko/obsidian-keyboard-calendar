import { createDuration } from "@fullcalendar/core";
import { parseEvent } from "../types/schema";
import {
    fromEventApi,
    omitRecurringOccurrence,
    selectionRequiresDayView,
    toEventInput,
} from "./interop";

describe("event selection routing", () => {
    it("opens day view for month selections and all-day slots", () => {
        expect(selectionRequiresDayView("dayGridMonth", false)).toBe(true);
        expect(selectionRequiresDayView("timeGridWeek", true)).toBe(true);
    });

    it("creates notes only from a timed grid selection", () => {
        expect(selectionRequiresDayView("timeGridWeek", false)).toBe(false);
    });
});

describe("task-free event metadata", () => {
    it("retains categories while omitting task-specific FullCalendar props", () => {
        const event = parseEvent({
            title: "Legacy completed event",
            type: "single",
            date: "2026-08-22",
            completed: false,
            categories: ["work", "planning"],
            allDay: false,
            startTime: "09:00",
            endTime: "10:00",
        });
        const rendered = toEventInput("event-id", event);

        expect(rendered?.extendedProps).toEqual({
            categories: ["work", "planning"],
        });
        expect(rendered?.extendedProps).not.toHaveProperty("isTask");
        expect(rendered?.extendedProps).not.toHaveProperty("taskCompleted");
    });

    it("carries categories back from FullCalendar and ignores old task props", () => {
        const event = fromEventApi({
            title: "Moved event",
            allDay: false,
            start: new Date(2026, 7, 23, 11, 0),
            end: new Date(2026, 7, 23, 12, 0),
            extendedProps: {
                categories: ["work", "planning"],
                isTask: true,
                taskCompleted: true,
            },
        } as any);

        expect(event).toMatchObject({
            categories: ["work", "planning"],
            type: "single",
            date: "2026-08-23",
        });
        expect(event).not.toHaveProperty("completed");
    });

    it.each([
        [
            "single",
            parseEvent({
                title: "Single",
                type: "single",
                date: "2026-08-22",
                categories: ["work"],
                allDay: true,
            }),
        ],
        [
            "weekly",
            parseEvent({
                title: "Weekly",
                type: "recurring",
                daysOfWeek: ["M"],
                categories: ["work"],
                allDay: true,
            }),
        ],
        [
            "RRULE",
            parseEvent({
                title: "Monthly",
                type: "rrule",
                startDate: "2026-08-01",
                rrule: "FREQ=MONTHLY;BYDAY=1SA",
                skipDates: [],
                categories: ["work"],
                allDay: true,
            }),
        ],
    ])("returns mutable category output for frozen %s input", (_, event) => {
        Object.freeze(event.categories);
        Object.freeze(event);

        const rendered = toEventInput("event-id", event);
        const categories = rendered?.extendedProps?.categories as string[];

        expect(Object.isFrozen(categories)).toBe(false);
        expect(() => {
            categories[0] = "changed";
        }).not.toThrow();
        expect(event.categories).toEqual(["work"]);
    });
});

describe("recurring event rendering", () => {
    it("returns mutable recurrence metadata arrays for frozen input", () => {
        const event = parseEvent({
            title: "Weekly review",
            type: "recurring",
            daysOfWeek: ["M"],
            skipDates: ["2026-08-24"],
            categories: ["work"],
            allDay: true,
        });
        if (event.type !== "recurring") {
            throw new Error("Expected recurring test event.");
        }
        Object.freeze(event.daysOfWeek);
        Object.freeze(event.skipDates);
        Object.freeze(event.categories);
        Object.freeze(event);

        const rendered = toEventInput("event-id", event);
        const recurrence = rendered?.extendedProps?.ofcRecurrence as {
            daysOfWeek: string[];
            skipDates: string[];
        };

        expect(Object.isFrozen(recurrence.daysOfWeek)).toBe(false);
        expect(Object.isFrozen(recurrence.skipDates)).toBe(false);
        expect(() => {
            recurrence.daysOfWeek[0] = "T";
            recurrence.skipDates[0] = "2026-08-31";
        }).not.toThrow();
        expect(event.daysOfWeek).toEqual(["M"]);
        expect(event.skipDates).toEqual(["2026-08-24"]);
    });

    it.each([
        [
            "weekly",
            parseEvent({
                title: "Weekly overnight",
                type: "recurring",
                daysOfWeek: ["M"],
                allDay: false,
                startTime: "23:00",
                endTime: "01:00",
            }),
        ],
        [
            "RRULE",
            parseEvent({
                title: "Monthly overnight",
                type: "rrule",
                startDate: "1970-01-01",
                rrule: "FREQ=MONTHLY;BYDAY=1SA",
                skipDates: [],
                allDay: false,
                startTime: "23:00",
                endTime: "01:00",
            }),
        ],
    ])("calculates a positive overnight duration for %s events", (_, event) => {
        const duration = toEventInput("event-id", event)?.duration;

        expect(duration).toEqual({
            days: 0,
            hours: 2,
            minutes: 0,
            seconds: 0,
            milliseconds: 0,
        });
        expect(createDuration(duration!)).toMatchObject({
            days: 0,
            milliseconds: 2 * 60 * 60 * 1000,
        });
    });

    it("provides an RRule duration that FullCalendar can parse", () => {
        const event = parseEvent({
            title: "Down to Dance",
            type: "rrule",
            startDate: "1970-01-01",
            rrule: "FREQ=MONTHLY;BYDAY=4SU",
            skipDates: [],
            allDay: false,
            startTime: "15:00",
            endTime: "18:00",
        });
        const duration = toEventInput("event-id", event)?.duration;

        expect(createDuration(duration!)).toMatchObject({
            days: 0,
            milliseconds: 3 * 60 * 60 * 1000,
        });
    });

    it("treats equal recurrence endpoints as a full day", () => {
        const event = parseEvent({
            title: "Full day by endpoints",
            type: "recurring",
            daysOfWeek: ["M"],
            allDay: false,
            startTime: "09:00",
            endTime: "09:00",
        });

        expect(toEventInput("event-id", event)?.duration).toEqual({
            days: 1,
            hours: 0,
            minutes: 0,
            seconds: 0,
            milliseconds: 0,
        });
    });

    it("characterizes the nth-weekday collapse hazard and disables editing", () => {
        const event = parseEvent({
            title: "First Saturday",
            type: "rrule",
            startDate: "2026-08-01",
            rrule: "FREQ=MONTHLY;BYDAY=1SA",
            skipDates: [],
            allDay: false,
            startTime: "09:00",
            endTime: "10:00",
        });
        const rendered = toEventInput("event-id", event);

        // Characterization: without explicit recurrence metadata, the current
        // reverse converter interprets an rrule occurrence as a single event.
        expect(
            fromEventApi({
                title: "First Saturday",
                allDay: false,
                start: new Date(2026, 7, 1, 9, 0),
                end: new Date(2026, 7, 1, 10, 0),
                extendedProps: { categories: [] },
            } as any).type
        ).toBe("single");

        expect(rendered).toMatchObject({
            editable: false,
            startEditable: false,
            durationEditable: false,
        });
    });

    it("leaves supported weekly recurrences source-editable", () => {
        const event = parseEvent({
            title: "Weekly review",
            type: "recurring",
            daysOfWeek: ["M"],
            allDay: false,
            startTime: "09:00",
            endTime: "10:00",
        });
        expect(toEventInput("event-id", event)?.editable).toBeUndefined();
    });

    it("renders weekly omit dates as actual recurrence exclusions", () => {
        const event = parseEvent({
            title: "Weekly review",
            type: "recurring",
            daysOfWeek: ["M"],
            startRecur: "2026-08-03",
            endRecur: "2026-09-01",
            skipDates: ["2026-08-17"],
            allDay: false,
            startTime: "09:00",
            endTime: "10:00",
        });

        const rendered = toEventInput("event-id", event);
        expect(rendered?.daysOfWeek).toBeUndefined();
        expect(rendered?.rrule).toContain("FREQ=WEEKLY;BYDAY=MO");
        expect(rendered?.exdate).toEqual([
            expect.stringMatching(/^2026-08-17T/),
        ]);
        expect(rendered?.exrule).toMatchObject({
            freq: "daily",
            dtstart: expect.stringMatching(/^2026-09-01T/),
        });
    });

    it("adds, sorts, and de-duplicates omitted occurrence dates", () => {
        const event = parseEvent({
            title: "Weekly review",
            type: "recurring",
            daysOfWeek: ["M"],
            skipDates: ["2026-08-24"],
            allDay: false,
            startTime: "09:00",
            endTime: "10:00",
        });

        const once = omitRecurringOccurrence(event, "2026-08-17");
        const twice = omitRecurringOccurrence(once, "2026-08-17");
        expect(twice).toMatchObject({
            skipDates: ["2026-08-17", "2026-08-24"],
        });
    });
});
