import { parseEvent } from "../types";
import { getCalendarEventContextActions } from "./event_context";

const single = parseEvent({
    title: "Single",
    type: "single",
    date: "2026-08-22",
    startTime: "09:00",
    endTime: "10:00",
});
const weekly = parseEvent({
    title: "Weekly",
    type: "recurring",
    daysOfWeek: ["S"],
    startTime: "09:00",
    endTime: "10:00",
});
const monthly = parseEvent({
    title: "Monthly",
    type: "rrule",
    startDate: "1970-01-01",
    rrule: "FREQ=MONTHLY;BYDAY=1SA",
    skipDates: [],
    startTime: "09:00",
    endTime: "10:00",
});

describe("lean calendar event context actions", () => {
    it("offers only omission for a recurring local full-note occurrence", async () => {
        const omit = jest.fn(async () => undefined);
        const actions = getCalendarEventContextActions({
            event: weekly,
            isLocalFullNote: true,
            occurrenceDate: "2026-08-22",
            omit,
        });

        expect(actions.map(({ title }) => title)).toEqual([
            "Omit this occurrence",
        ]);
        expect(actions.map(({ title }) => title)).not.toContain("Delete");
        await actions[0].run();
        expect(omit).toHaveBeenCalledWith("2026-08-22");
    });

    it("offers no calendar actions for single or non-local events", () => {
        const omit = jest.fn(async () => undefined);
        expect(
            getCalendarEventContextActions({
                event: single,
                isLocalFullNote: true,
                occurrenceDate: "2026-08-22",
                omit,
            })
        ).toEqual([]);
        expect(
            getCalendarEventContextActions({
                event: weekly,
                isLocalFullNote: false,
                occurrenceDate: "2026-08-22",
                omit,
            })
        ).toEqual([]);
    });

    it("keeps YAML-editable nth-weekday recurrence omission available", () => {
        const actions = getCalendarEventContextActions({
            event: monthly,
            isLocalFullNote: true,
            occurrenceDate: "2026-08-01",
            omit: jest.fn(async () => undefined),
        });
        expect(actions.map(({ title }) => title)).toEqual([
            "Omit this occurrence",
        ]);
    });

    it("disables omission when FullCalendar supplies no occurrence date", async () => {
        const omit = jest.fn(async () => undefined);
        const actions = getCalendarEventContextActions({
            event: weekly,
            isLocalFullNote: true,
            occurrenceDate: null,
            omit,
        });
        expect(actions).toHaveLength(1);
        expect(actions[0].disabled).toBe(true);
        await actions[0].run();
        expect(omit).not.toHaveBeenCalled();
    });
});
