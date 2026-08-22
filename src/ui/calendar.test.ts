import { formatDateLabel, formatTimeLabel } from "./calendar";

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
});
