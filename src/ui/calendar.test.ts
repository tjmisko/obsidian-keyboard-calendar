import {
    formatDateLabel,
    formatTimeLabel,
    getAdjacentCalendarView,
    getRenderedEventTitle,
} from "./calendar";

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
