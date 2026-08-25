import { parseEvent } from "../types";
import {
    copiedEventBasename,
    createCalendarEventClipboard,
    pasteCalendarEvent,
} from "./event_clipboard";

describe("calendar event clipboard", () => {
    it("appends the copied-event suffix to the source note basename", () => {
        expect(copiedEventBasename("events/Planning.md")).toBe(
            "Planning (copied event)"
        );
        expect(copiedEventBasename("Root.MD")).toBe("Root (copied event)");
    });

    it("pastes a rendered occurrence at the target while preserving duration and tags", () => {
        const event = parseEvent({
            title: "Weekly planning",
            type: "recurring",
            daysOfWeek: ["M"],
            categories: ["work", "planning"],
            attendingDates: ["2026-08-24"],
            startTime: "09:00",
            endTime: "10:30",
        });
        const clipboard = createCalendarEventClipboard(
            event,
            "events/Weekly planning.md",
            new Date(2026, 7, 24, 9, 0),
            new Date(2026, 7, 24, 10, 30)
        );

        const pasted = pasteCalendarEvent(
            clipboard,
            new Date(2026, 7, 26, 14, 15)
        );

        expect(pasted).toEqual({
            title: "Weekly planning (copied event)",
            type: "single",
            date: "2026-08-26",
            endDate: null,
            categories: ["work", "planning"],
            startTime: "14:15",
            endTime: "15:45",
        });
        expect(event.type).toBe("recurring");
        expect(event.attendingDates).toEqual(["2026-08-24"]);
    });

    it("clamps zero-length rendered events to one calendar cell", () => {
        const event = parseEvent({
            title: "Instant",
            type: "single",
            date: "2026-08-24",
            startTime: "09:00",
            endTime: "09:15",
        });
        const start = new Date(2026, 7, 24, 9, 0);
        const clipboard = createCalendarEventClipboard(
            event,
            "events/Instant.md",
            start,
            start
        );

        expect(
            pasteCalendarEvent(clipboard, new Date(2026, 7, 25, 10, 0))
        ).toMatchObject({ startTime: "10:00", endTime: "10:15" });
    });
});
