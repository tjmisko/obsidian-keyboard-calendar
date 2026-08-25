import { readFileSync } from "fs";
import { join } from "path";

const stylesheet = readFileSync(join(__dirname, "overrides.css"), "utf8");

const ruleFor = (selector: string): string => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return (
        stylesheet.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] || ""
    );
};

describe("list-view styles", () => {
    it("uses deterministic grid tracks instead of intrinsic table-cell widths", () => {
        const eventRow = ruleFor(".fc.fc .fc-list-event");
        const titleCell = ruleFor(".fc.fc .fc-list-event-title");

        expect(eventRow).toContain("display: grid");
        expect(eventRow).toContain("minmax(0, 1fr)");
        expect(titleCell).toContain("width: auto !important");
        expect(titleCell).toContain("overflow-wrap: break-word");
        expect(titleCell).not.toContain("width: 100%");
    });

    it("keeps ghost filtering off FullCalendar table rows", () => {
        expect(stylesheet).toContain(
            ".fc .ofc-event-ghost:not(.fc-list-event) {"
        );
        expect(stylesheet).toContain(
            ".fc.fc .fc-list-event.ofc-event-ghost > td {"
        );
        expect(stylesheet).not.toContain(".fc .ofc-event-ghost {");
    });
});
