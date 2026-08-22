import { parseEvent } from "../types/schema";
import { selectionRequiresDayView, toEventInput } from "./interop";

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
});
