import { readFileSync } from "fs";
import { join } from "path";

const stylesheet = readFileSync(join(__dirname, "overrides.css"), "utf8");
const manifest = JSON.parse(
    readFileSync(join(__dirname, "../../manifest.json"), "utf8")
) as { isDesktopOnly?: boolean };

describe("calendar surface styles", () => {
    it("allows Obsidian to load the plugin on mobile", () => {
        expect(manifest.isDesktopOnly).toBe(false);
    });

    it("keeps the primary surface full-width after moving Day to the sidebar", () => {
        expect(stylesheet).not.toContain("max-width: 96rem");
    });

    it("uses the calendar container to wrap narrow toolbars", () => {
        expect(stylesheet).toContain("container-type: inline-size");
        expect(stylesheet).toContain("@container (max-width: 40rem)");
        expect(stylesheet).toContain("flex: 1 0 100%");
    });

    it("contains horizontal touch scrolling inside the calendar", () => {
        expect(stylesheet).toContain("overscroll-behavior-inline: contain");
        expect(stylesheet).toContain("-webkit-overflow-scrolling: touch");
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
