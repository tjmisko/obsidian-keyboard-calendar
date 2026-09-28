import { formatScrollTime, getDayPeekScrollTime } from "./day_peek";

const day = new Date(2026, 8, 28);
const span = (start: Date | null, end: Date | null, allDay = false) => ({
    start,
    end,
    allDay,
});

describe("day peek scroll time", () => {
    it("should open on the morning when the day has no events", () => {
        expect(getDayPeekScrollTime([], day)).toBe("08:00:00");
    });

    it("should open half an hour above the first event, snapped to a quarter hour", () => {
        expect(
            getDayPeekScrollTime(
                [
                    span(
                        new Date(2026, 8, 28, 12, 0),
                        new Date(2026, 8, 28, 13, 0)
                    ),
                    span(
                        new Date(2026, 8, 28, 9, 50),
                        new Date(2026, 8, 28, 10, 30)
                    ),
                ],
                day
            )
        ).toBe("09:15:00");
    });

    it("should ignore all-day events and events on other days", () => {
        expect(
            getDayPeekScrollTime(
                [
                    span(new Date(2026, 8, 28), new Date(2026, 8, 29), true),
                    span(
                        new Date(2026, 8, 27, 6, 0),
                        new Date(2026, 8, 27, 7, 0)
                    ),
                    span(
                        new Date(2026, 8, 29, 6, 0),
                        new Date(2026, 8, 29, 7, 0)
                    ),
                ],
                day
            )
        ).toBe("08:00:00");
    });

    it("should open at midnight for an event running over from the previous night", () => {
        expect(
            getDayPeekScrollTime(
                [
                    span(
                        new Date(2026, 8, 27, 23, 0),
                        new Date(2026, 8, 28, 1, 0)
                    ),
                ],
                day
            )
        ).toBe("00:00:00");
    });

    it("should not count an event that ends exactly at midnight", () => {
        expect(
            getDayPeekScrollTime(
                [
                    span(
                        new Date(2026, 8, 27, 22, 0),
                        new Date(2026, 8, 28, 0, 0)
                    ),
                ],
                day
            )
        ).toBe("08:00:00");
    });

    it("should clamp an early event's lead-in to midnight", () => {
        expect(
            getDayPeekScrollTime(
                [span(new Date(2026, 8, 28, 0, 10), null)],
                day
            )
        ).toBe("00:00:00");
    });

    it("should skip events without a valid start", () => {
        expect(
            getDayPeekScrollTime(
                [span(null, null), span(new Date(NaN), null)],
                day
            )
        ).toBe("08:00:00");
    });

    it("should format minutes as a FullCalendar duration", () => {
        expect(formatScrollTime(0)).toBe("00:00:00");
        expect(formatScrollTime(23 * 60 + 45)).toBe("23:45:00");
    });
});
