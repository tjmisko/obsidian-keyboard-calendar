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

describe("recurring event rendering", () => {
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
        expect(toEventInput("event-id", event)?.duration).toBe("PT2H");
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

        expect(toEventInput("event-id", event)?.duration).toBe("PT24H");
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
