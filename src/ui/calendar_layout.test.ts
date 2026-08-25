import { readFileSync } from "fs";
import { join } from "path";

const stylesheet = readFileSync(join(__dirname, "overrides.css"), "utf8");

describe("calendar surface styles", () => {
    it("keeps the primary surface full-width after moving Day to the sidebar", () => {
        expect(stylesheet).not.toContain("max-width: 96rem");
    });

    it("allows the day-sidebar toolbar to wrap in a narrow dock", () => {
        const rule = stylesheet.match(
            /\.fc\.ofc-day-calendar-root \.fc-toolbar\.fc-header-toolbar\s*\{([^}]*)\}/
        )?.[1];

        expect(rule).toContain("flex-wrap: wrap");
    });

    it("contains no retired list-view selectors", () => {
        expect(stylesheet).not.toContain("fc-list");
    });
});
