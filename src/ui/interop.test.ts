import { createDuration } from "@fullcalendar/core";
import { parseEvent } from "../types/schema";
import {
    attendEventOccurrence,
    fromEventApi,
    getSingleEventStartDate,
    moveSingleTimedEvent,
    omitRecurringOccurrence,
    selectionRequiresDayView,
    toEventInput,
} from "./interop";

describe("event selection routing", () => {
    it("opens day view for month selections", () => {
        expect(selectionRequiresDayView("dayGridMonth")).toBe(true);
    });

    it("creates notes only from a timed grid selection", () => {
        expect(selectionRequiresDayView("timeGridWeek")).toBe(false);
    });
});

describe("single-event navigation date", () => {
    it("uses the current local date and start time", () => {
        const event = parseEvent({
            title: "Created event",
            type: "single",
            date: "2026-08-22",
            startTime: "09:30",
            endTime: "10:00",
        });

        const start = getSingleEventStartDate(event);

        expect(start).not.toBeNull();
        expect([
            start!.getFullYear(),
            start!.getMonth(),
            start!.getDate(),
            start!.getHours(),
            start!.getMinutes(),
        ]).toEqual([2026, 7, 22, 9, 30]);
    });
});

describe("grabbed single-event persistence", () => {
    it("updates both date endpoints while retaining note metadata", () => {
        const event = parseEvent({
            title: "Planning",
            type: "single",
            date: "2026-08-22",
            categories: ["work"],
            startTime: "23:30",
            endTime: "23:45",
        });

        const moved = moveSingleTimedEvent(
            event,
            new Date(2026, 7, 24, 23, 45),
            new Date(2026, 7, 25, 0, 0)
        );

        expect(moved).toMatchObject({
            title: "Planning",
            categories: ["work"],
            type: "single",
            date: "2026-08-24",
            endDate: "2026-08-25",
            startTime: "23:45",
            endTime: "00:00",
        });
    });

    it("does not collapse recurring events into timed singles", () => {
        const recurring = parseEvent({
            title: "Weekly",
            type: "recurring",
            daysOfWeek: ["M"],
            startTime: "09:00",
            endTime: "10:00",
        });
        const start = new Date(2026, 7, 24, 9, 0);
        const end = new Date(2026, 7, 24, 10, 0);

        expect(moveSingleTimedEvent(recurring, start, end)).toBeNull();
    });

    it("rejects an all-day event from the FullCalendar boundary", () => {
        expect(() =>
            fromEventApi({
                title: "Unsupported",
                allDay: true,
                start: new Date(2026, 7, 24),
                end: new Date(2026, 7, 25),
                extendedProps: {},
            } as any)
        ).toThrow("All-day events are not supported.");
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

    it("round-trips mutable attending-date metadata", () => {
        const event = parseEvent({
            title: "Weekly review",
            type: "recurring",
            daysOfWeek: ["M"],
            attendingDates: ["2026-08-17", "2026-08-24"],
            startTime: "09:00",
            endTime: "10:00",
        });
        Object.freeze(event.attendingDates);
        Object.freeze(event);

        const rendered = toEventInput("event-id", event)!;
        const renderedDates = rendered.extendedProps
            ?.attendingDates as string[];
        expect(Object.isFrozen(renderedDates)).toBe(false);
        renderedDates.push("2026-08-31");
        expect(event.attendingDates).toEqual(["2026-08-17", "2026-08-24"]);

        const moved = fromEventApi({
            title: "Weekly review",
            allDay: false,
            start: new Date(2026, 7, 17, 11, 0),
            end: new Date(2026, 7, 17, 12, 0),
            extendedProps: rendered.extendedProps,
        } as any);
        expect(moved.attendingDates).toEqual([
            "2026-08-17",
            "2026-08-24",
            "2026-08-31",
        ]);
        expect(moved.attendingDates).not.toBe(renderedDates);
    });

    it.each([
        [
            "single",
            parseEvent({
                title: "Single",
                type: "single",
                date: "2026-08-22",
                categories: ["work"],
                startTime: "09:00",
                endTime: "10:00",
            }),
        ],
        [
            "weekly",
            parseEvent({
                title: "Weekly",
                type: "recurring",
                daysOfWeek: ["M"],
                categories: ["work"],
                startTime: "09:00",
                endTime: "10:00",
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
                startTime: "09:00",
                endTime: "10:00",
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
    it("marks both recurrence formats for renderer-only decoration", () => {
        const weekly = parseEvent({
            title: "Weekly",
            type: "recurring",
            daysOfWeek: ["M"],
            startTime: "09:00",
            endTime: "10:00",
        });
        const monthly = parseEvent({
            title: "Monthly",
            type: "rrule",
            startDate: "2026-08-01",
            rrule: "FREQ=MONTHLY;BYDAY=1SA",
            skipDates: [],
            startTime: "09:00",
            endTime: "10:00",
        });

        expect(toEventInput("weekly", weekly)?.extendedProps).toMatchObject({
            ofcRecurring: true,
        });
        expect(toEventInput("monthly", monthly)?.extendedProps).toMatchObject({
            ofcRecurring: true,
        });
    });

    it("returns mutable recurrence metadata arrays for frozen input", () => {
        const event = parseEvent({
            title: "Weekly review",
            type: "recurring",
            daysOfWeek: ["M"],
            skipDates: ["2026-08-24"],
            categories: ["work"],
            startTime: "09:00",
            endTime: "10:00",
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
            startTime: "09:00",
            endTime: "10:00",
        });

        const once = omitRecurringOccurrence(event, "2026-08-17");
        const twice = omitRecurringOccurrence(once, "2026-08-17");
        expect(twice).toMatchObject({
            skipDates: ["2026-08-17", "2026-08-24"],
        });
    });

    it("adds, sorts, and de-duplicates attended occurrence dates", () => {
        const event = parseEvent({
            title: "Weekly review",
            type: "recurring",
            daysOfWeek: ["M"],
            attendingDates: ["2026-08-24"],
            startTime: "09:00",
            endTime: "10:00",
        });

        const once = attendEventOccurrence(event, "2026-08-17");
        const twice = attendEventOccurrence(once, "2026-08-17");
        expect(twice).toMatchObject({
            attendingDates: ["2026-08-17", "2026-08-24"],
        });
    });
});
