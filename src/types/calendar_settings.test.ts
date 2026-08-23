import {
    CalendarInfo,
    resolveDefaultFullNoteCalendar,
} from "./calendar_settings";

const sources: CalendarInfo[] = [
    { type: "dailynote", heading: "Calendar", color: "red" },
    { type: "local", directory: "Events/Work", color: "blue" },
    { type: "local", directory: "Events/Home", color: "green" },
];

describe("default full-note calendar", () => {
    it("keeps a valid stable source ID", () => {
        expect(
            resolveDefaultFullNoteCalendar("local::Events/Home", sources)
        ).toBe("local::Events/Home");
    });

    it("migrates the old numeric source index", () => {
        expect(resolveDefaultFullNoteCalendar(1, sources)).toBe(
            "local::Events/Work"
        );
    });

    it("migrates an old directory value", () => {
        expect(resolveDefaultFullNoteCalendar("Events/Home", sources)).toBe(
            "local::Events/Home"
        );
    });

    it("falls back to the first full-note source", () => {
        expect(resolveDefaultFullNoteCalendar("missing", sources)).toBe(
            "local::Events/Work"
        );
        expect(resolveDefaultFullNoteCalendar(0, sources)).toBe(
            "local::Events/Work"
        );
    });

    it("returns null when no full-note source exists", () => {
        expect(
            resolveDefaultFullNoteCalendar("missing", [sources[0]])
        ).toBeNull();
    });
});
