import {
    createEventDraft,
    DEFAULT_EVENT_TITLE,
    eventBasenameFromTitle,
    resolveEventDraft,
} from "./event_draft";

describe("event draft", () => {
    it("should seed the dialog from a selected time range", () => {
        expect(
            createEventDraft(
                new Date(2026, 8, 28, 9, 15),
                new Date(2026, 8, 28, 10, 0)
            )
        ).toEqual({
            title: "",
            date: "2026-09-28",
            startTime: "09:15",
            endTime: "10:00",
        });
    });

    it("should resolve a same-day draft into single-event frontmatter", () => {
        const resolved = resolveEventDraft({
            title: "Lunch with Cian",
            date: "2026-09-28",
            startTime: "12:00",
            endTime: "13:00",
        });

        expect(resolved).toEqual({
            ok: true,
            event: {
                type: "single",
                date: "2026-09-28",
                endDate: undefined,
                startTime: "12:00",
                endTime: "13:00",
            },
            basename: "Lunch with Cian",
            start: new Date(2026, 8, 28, 12, 0),
            end: new Date(2026, 8, 28, 13, 0),
        });
    });

    it("should roll the end onto the next day when it is before the start", () => {
        const resolved = resolveEventDraft({
            title: "Night sail",
            date: "2026-09-30",
            startTime: "22:30",
            endTime: "01:00",
        });

        expect(resolved).toMatchObject({
            ok: true,
            event: {
                date: "2026-09-30",
                endDate: "2026-10-01",
                startTime: "22:30",
                endTime: "01:00",
            },
        });
    });

    it("should roll across a year boundary", () => {
        expect(
            resolveEventDraft({
                title: "",
                date: "2026-12-31",
                startTime: "23:00",
                endTime: "00:30",
            })
        ).toMatchObject({
            ok: true,
            event: { date: "2026-12-31", endDate: "2027-01-01" },
        });
    });

    it("should accept seconds that some native time pickers report", () => {
        expect(
            resolveEventDraft({
                title: "",
                date: "2026-09-28",
                startTime: "09:00:00",
                endTime: "09:30:00.000",
            })
        ).toMatchObject({
            ok: true,
            event: { startTime: "09:00", endTime: "09:30" },
        });
    });

    it("should reject a zero-length event", () => {
        expect(
            resolveEventDraft({
                title: "",
                date: "2026-09-28",
                startTime: "09:00",
                endTime: "09:00",
            })
        ).toEqual({ ok: false, error: "End time must differ from the start." });
    });

    it("should reject cleared, impossible, or malformed dates and times", () => {
        const base = {
            title: "x",
            date: "2026-09-28",
            startTime: "09:00",
            endTime: "10:00",
        };
        for (const date of ["", "2026-02-30", "28/09/2026"]) {
            expect(resolveEventDraft({ ...base, date })).toMatchObject({
                ok: false,
                error: "Choose a date.",
            });
        }
        for (const startTime of ["", "24:00", "9:00", "09:60"]) {
            expect(resolveEventDraft({ ...base, startTime })).toMatchObject({
                ok: false,
                error: "Choose a start and end time.",
            });
        }
    });

    it("should fall back to the default title for a blank title", () => {
        expect(eventBasenameFromTitle("   ")).toBe(DEFAULT_EVENT_TITLE);
        expect(eventBasenameFromTitle("")).toBe(DEFAULT_EVENT_TITLE);
    });

    it("should strip characters Obsidian forbids in file names and links", () => {
        expect(eventBasenameFromTitle("Lunch w/ Cian: [plans]?")).toBe(
            "Lunch w Cian plans"
        );
        expect(eventBasenameFromTitle('a\\b*c"d<e>f|g#h^i')).toBe(
            "a b c d e f g h i"
        );
        expect(eventBasenameFromTitle("line\nbreak\ttab")).toBe(
            "line break tab"
        );
    });

    it("should not create hidden files from a leading dot", () => {
        expect(eventBasenameFromTitle("...env review")).toBe("env review");
        expect(eventBasenameFromTitle(" . ")).toBe(DEFAULT_EVENT_TITLE);
    });

    it("should fall back when a title is only forbidden characters", () => {
        expect(eventBasenameFromTitle("///")).toBe(DEFAULT_EVENT_TITLE);
    });

    it("should cap very long titles", () => {
        expect(eventBasenameFromTitle("a".repeat(500))).toHaveLength(120);
    });

    it("should keep non-Latin titles intact", () => {
        expect(eventBasenameFromTitle("Déjeuner — 東京 🍜")).toBe(
            "Déjeuner — 東京 🍜"
        );
    });
});
