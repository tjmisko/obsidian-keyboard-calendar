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

describe("calendar event context actions", () => {
    const makeCallbacks = () => ({
        omit: jest.fn(async () => undefined),
        attend: jest.fn(async () => undefined),
        deleteEvent: jest.fn(),
    });

    it("offers iconed omission and confirmed deletion for a recurring note", async () => {
        const callbacks = makeCallbacks();
        const actions = getCalendarEventContextActions({
            event: weekly,
            isLocalFullNote: true,
            occurrenceDate: "2026-08-22",
            ghostEventTags: ["ghost"],
            ...callbacks,
        });

        expect(actions.map(({ title, icon }) => ({ title, icon }))).toEqual([
            { title: "Omit this occurrence", icon: "calendar-x" },
            { title: "Delete event", icon: "trash" },
        ]);
        await actions[0].run();
        expect(callbacks.omit).toHaveBeenCalledWith("2026-08-22");
        expect(actions[1].separatorBefore).toBe(true);
        actions[1].run();
        expect(callbacks.deleteEvent).toHaveBeenCalledTimes(1);
    });

    it("restores delete for single and non-local events", () => {
        for (const [event, isLocalFullNote] of [
            [single, true],
            [weekly, false],
        ] as const) {
            const actions = getCalendarEventContextActions({
                event,
                isLocalFullNote,
                occurrenceDate: "2026-08-22",
                ghostEventTags: ["ghost"],
                ...makeCallbacks(),
            });
            expect(actions.map(({ title }) => title)).toEqual(["Delete event"]);
        }
    });

    it("keeps YAML-editable nth-weekday recurrence omission available", () => {
        const actions = getCalendarEventContextActions({
            event: monthly,
            isLocalFullNote: true,
            occurrenceDate: "2026-08-01",
            ghostEventTags: ["ghost"],
            ...makeCallbacks(),
        });
        expect(actions.map(({ title }) => title)).toEqual([
            "Omit this occurrence",
            "Delete event",
        ]);
    });

    it("disables omission when FullCalendar supplies no occurrence date", async () => {
        const callbacks = makeCallbacks();
        const actions = getCalendarEventContextActions({
            event: weekly,
            isLocalFullNote: true,
            occurrenceDate: null,
            ghostEventTags: ["ghost"],
            ...callbacks,
        });
        expect(actions).toHaveLength(2);
        expect(actions[0].disabled).toBe(true);
        await actions[0].run();
        expect(callbacks.omit).not.toHaveBeenCalled();
    });

    it("offers attendance for an unattended ghosted occurrence", async () => {
        const callbacks = makeCallbacks();
        const ghosted = parseEvent({
            ...weekly,
            categories: ["Dance", "GHOST"],
            attendingDates: ["2026-08-15"],
        });
        const actions = getCalendarEventContextActions({
            event: ghosted,
            isLocalFullNote: true,
            occurrenceDate: "2026-08-22",
            ghostEventTags: ["ghost"],
            ...callbacks,
        });

        expect(actions.map(({ title }) => title)).toEqual([
            "Attend this occurrence",
            "Omit this occurrence",
            "Delete event",
        ]);
        expect(actions[0].icon).toBe("calendar-check");
        await actions[0].run();
        expect(callbacks.attend).toHaveBeenCalledWith("2026-08-22");
    });

    it("does not offer attendance for an already attended occurrence", () => {
        const attended = parseEvent({
            ...weekly,
            categories: ["ghost"],
            attendingDates: ["2026-08-22"],
        });
        const actions = getCalendarEventContextActions({
            event: attended,
            isLocalFullNote: true,
            occurrenceDate: "2026-08-22",
            ghostEventTags: ["ghost"],
            ...makeCallbacks(),
        });

        expect(actions.map(({ title }) => title)).not.toContain(
            "Attend this occurrence"
        );
    });
});
