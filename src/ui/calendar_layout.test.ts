import { readFileSync } from "fs";
import { join } from "path";

const stylesheet = readFileSync(join(__dirname, "overrides.css"), "utf8");

describe("calendar layout styles", () => {
    it("centers the calendar and caps its width in large panes", () => {
        const rule = stylesheet.match(/\.ofc-calendar-root\s*\{([^}]*)\}/)?.[1];

        expect(rule).toContain("width: 100%");
        expect(rule).toContain("max-width: 96rem");
        expect(rule).toContain("margin-inline: auto");
    });
});
