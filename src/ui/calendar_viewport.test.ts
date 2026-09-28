import {
    CALENDAR_VIEWPORT_STATE_KEY,
    findCalendarBodyScroller,
    formatViewportDate,
    parseCalendarViewportState,
    parseViewportDate,
    readCalendarViewportFromEphemeralState,
    readZoomLevelFromViewState,
} from "./calendar_viewport";

describe("calendar viewport state", () => {
    it("should round-trip a captured week viewport", () => {
        const state = {
            viewType: "timeGridWeek",
            date: "2026-09-28",
            zoomLevel: 4,
            scrollTop: 612,
            scrollLeft: 88,
        };

        expect(parseCalendarViewportState(state)).toEqual(state);
    });

    it("should format and parse local dates without a timezone shift", () => {
        const date = new Date(2026, 0, 5, 23, 59);
        const formatted = formatViewportDate(date);

        expect(formatted).toBe("2026-01-05");
        expect(parseViewportDate(formatted)).toEqual(new Date(2026, 0, 5));
    });

    it("should reject impossible or malformed dates", () => {
        expect(parseViewportDate("2026-02-31")).toBeNull();
        expect(parseViewportDate("2026-13-01")).toBeNull();
        expect(parseViewportDate("2026-9-28")).toBeNull();
        expect(parseViewportDate("2026-09-28T10:00")).toBeNull();
        expect(parseViewportDate(20260928)).toBeNull();
        expect(parseViewportDate(undefined)).toBeNull();
    });

    it("should drop state for unknown views or missing dates", () => {
        expect(
            parseCalendarViewportState({
                viewType: "listWeek",
                date: "2026-09-28",
            })
        ).toBeNull();
        expect(
            parseCalendarViewportState({ viewType: "timeGridWeek" })
        ).toBeNull();
        expect(parseCalendarViewportState(null)).toBeNull();
        expect(parseCalendarViewportState("timeGridWeek")).toBeNull();
        expect(parseCalendarViewportState([])).toBeNull();
    });

    it("should zero out negative, infinite, NaN, or non-numeric scroll offsets", () => {
        expect(
            parseCalendarViewportState({
                viewType: "dayGridMonth",
                date: "2026-09-01",
                scrollTop: -40,
                scrollLeft: "120",
            })
        ).toMatchObject({ scrollTop: 0, scrollLeft: 0 });
        expect(
            parseCalendarViewportState({
                viewType: "dayGridMonth",
                date: "2026-09-01",
                scrollTop: NaN,
                scrollLeft: Infinity,
            })
        ).toMatchObject({ scrollTop: 0, scrollLeft: 0 });
    });

    it("should round fractional scroll offsets from high-density displays", () => {
        expect(
            parseCalendarViewportState({
                viewType: "timeGridWeek",
                date: "2026-09-28",
                scrollTop: 300.6,
            })
        ).toMatchObject({ scrollTop: 301 });
    });

    it("should ignore a zoom level that is not a non-negative integer", () => {
        for (const zoomLevel of [-1, 2.5, "3", null, NaN]) {
            expect(
                parseCalendarViewportState({
                    viewType: "timeGridWeek",
                    date: "2026-09-28",
                    zoomLevel,
                })?.zoomLevel
            ).toBeNull();
        }
    });

    it("should read the viewport out of Obsidian's ephemeral state bag", () => {
        expect(
            readCalendarViewportFromEphemeralState({
                focus: true,
                [CALENDAR_VIEWPORT_STATE_KEY]: {
                    viewType: "timeGridWeek",
                    date: "2026-09-28",
                },
            })
        ).toMatchObject({ viewType: "timeGridWeek", date: "2026-09-28" });
        expect(readCalendarViewportFromEphemeralState({})).toBeNull();
        expect(readCalendarViewportFromEphemeralState(undefined)).toBeNull();
    });

    it("should read a persisted per-leaf zoom level", () => {
        expect(readZoomLevelFromViewState({ zoomLevel: 5 })).toBe(5);
        expect(readZoomLevelFromViewState({ zoomLevel: "5" })).toBeNull();
        expect(readZoomLevelFromViewState(null)).toBeNull();
    });

    it("should prefer FullCalendar's liquid body scroller", () => {
        const liquid = { id: "liquid" };
        const body = { id: "body" };
        const querySelector = jest.fn((selector: string) =>
            selector.includes("liquid") ? liquid : body
        );

        expect(
            findCalendarBodyScroller({
                querySelector,
            } as unknown as ParentNode)
        ).toBe(liquid);
    });
});
