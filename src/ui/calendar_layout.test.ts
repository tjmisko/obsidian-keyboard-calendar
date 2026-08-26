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
        expect(stylesheet).toContain(
            ".fc.ofc-calendar-root:not(.ofc-day-calendar-root)"
        );
        expect(stylesheet).toContain("flex: 1 0 100%");
    });

    it("contains horizontal touch scrolling inside the calendar", () => {
        expect(stylesheet).toContain("overscroll-behavior-inline: contain");
        expect(stylesheet).toContain("-webkit-overflow-scrolling: touch");
    });

    it("keeps the day-sidebar toolbar on one compact row", () => {
        const rule = stylesheet.match(
            /\.fc\.ofc-day-calendar-root \.fc-toolbar\.fc-header-toolbar\s*\{([^}]*)\}/
        )?.[1];

        expect(rule).toContain("flex-wrap: nowrap");
        expect(rule).toContain("row-gap: 0");
    });

    it("removes the toolbar card and hides the inactive mode chip", () => {
        const toolbarRule = stylesheet.match(
            /\.fc \.fc-toolbar\.fc-header-toolbar\s*\{([^}]*)\}/
        )?.[1];
        const normalModeRule = stylesheet.match(
            /\.fc \.ofc-mode-chip\[data-mode="normal"\]\s*\{([^}]*)\}/
        )?.[1];

        expect(toolbarRule).toContain("background: transparent");
        expect(toolbarRule).toContain("border: 0");
        expect(normalModeRule).toContain("display: none");
    });

    it("contains no retired list-view selectors", () => {
        expect(stylesheet).not.toContain("fc-list");
    });
});
