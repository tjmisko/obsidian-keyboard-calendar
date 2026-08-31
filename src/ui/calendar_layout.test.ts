import { readFileSync } from "fs";
import { join } from "path";

const stylesheet = readFileSync(join(__dirname, "overrides.css"), "utf8");
const calendarViewSource = readFileSync(join(__dirname, "view.ts"), "utf8");
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

    it("uses a definite flex host instead of a collapsible percentage height", () => {
        const hostRule = stylesheet.match(
            /\.ofc-calendar-view-content\s*\{([^}]*)\}/
        )?.[1];
        const rootRule = stylesheet.match(
            /\.ofc-calendar-view-content > \.ofc-calendar-root\s*\{([^}]*)\}/
        )?.[1];

        expect(calendarViewSource).toContain('"ofc-calendar-view-content"');
        expect(hostRule).toContain("display: flex");
        expect(hostRule).toContain("flex-direction: column");
        expect(hostRule).toContain("min-height: 0");
        expect(rootRule).toContain("flex: 1 1 0");
        expect(rootRule).toContain("height: auto");
    });

    it("puts phone chrome clearance on the host while removing outer padding", () => {
        const phoneRule = stylesheet.match(
            /\.is-phone \.ofc-calendar-view-content-primary\s*\{([^}]*)\}/
        )?.[1];

        expect(phoneRule).toContain("box-sizing: border-box");
        expect(phoneRule).toContain(
            "padding: 0 0 calc(4rem + env(safe-area-inset-bottom, 0px))"
        );
        expect(stylesheet).not.toContain("height: calc(100% - 4rem)");
    });

    it("uses the calendar container to wrap narrow toolbars", () => {
        expect(stylesheet).toContain("container-type: inline-size");
        expect(stylesheet).toContain("@container (max-width: 40rem)");
        expect(stylesheet).toContain(
            ".fc.ofc-calendar-root:not(.ofc-day-calendar-root)"
        );
        expect(stylesheet).toContain(".fc-toolbar.fc-footer-toolbar");
        expect(stylesheet).toContain("flex: 1 0 100%");
    });

    it("keeps the phone footer toolbar to one dense row", () => {
        const toolbarRule = stylesheet.match(
            /\.is-phone \.fc\.ofc-calendar-root:not\(\.ofc-day-calendar-root\) \.fc-toolbar\.fc-footer-toolbar\s*\{([^}]*)\}/
        )?.[1];

        expect(toolbarRule).toContain("display: grid");
        expect(toolbarRule).toContain(
            "grid-template-columns: auto minmax(0, 1fr) auto"
        );
        expect(toolbarRule).toContain("margin-top: 0.25rem");
    });

    it("tightens phone grid labels without shrinking controls below two rem", () => {
        const buttonRule = stylesheet.match(
            /\.is-phone \.fc\.ofc-calendar-root:not\(\.ofc-day-calendar-root\) \.fc-footer-toolbar \.fc-button\s*\{([^}]*)\}/
        )?.[1];
        const dayHeaderRule = stylesheet.match(
            /\.is-phone \.fc \.ofc-day-header\s*\{([^}]*)\}/
        )?.[1];

        expect(buttonRule).toContain("min-height: 2rem");
        expect(dayHeaderRule).toContain("min-height: 2.1rem");
        expect(dayHeaderRule).toContain("gap: 0");
    });

    it("contains horizontal touch scrolling inside the calendar", () => {
        expect(stylesheet).toContain("overscroll-behavior-inline: contain");
        expect(stylesheet).toContain("-webkit-overflow-scrolling: touch");
    });

    it("scrolls the standard week renderer without FullCalendar ScrollGrid", () => {
        const harnessRule = stylesheet.match(
            /\.fc\.ofc-calendar-root:not\(\.ofc-day-calendar-root\) \.fc-view-harness\s*\{([^}]*)\}/
        )?.[1];
        const weekRule = stylesheet.match(
            /\.fc\.ofc-calendar-root:not\(\.ofc-day-calendar-root\) \.fc-view-harness-active > \.fc-timeGridWeek-view\s*\{([^}]*)\}/
        )?.[1];

        expect(harnessRule).toContain("overflow-x: auto");
        expect(harnessRule).toContain("overflow-y: hidden");
        expect(weekRule).toContain("min-width: 45rem");
    });

    it("keeps the day-sidebar toolbar on one compact row", () => {
        const rule = stylesheet.match(
            /\.fc\.ofc-day-calendar-root \.fc-toolbar\.fc-header-toolbar\s*\{([^}]*)\}/
        )?.[1];

        expect(rule).toContain("flex-wrap: nowrap");
        expect(rule).toContain("row-gap: 0");
        expect(rule).toContain("margin-bottom: 0.125rem");
    });

    it("keeps the day date and weekday in a compact vertical group", () => {
        const linkRule = stylesheet.match(
            /\.fc\.ofc-day-calendar-root \.fc-col-header-cell-cushion\.ofc-daily-note-link\s*\{([^}]*)\}/
        )?.[1];
        const weekdayRule = stylesheet.match(
            /\.fc\.ofc-day-calendar-root \.ofc-day-header\s*\{([^}]*)\}/
        )?.[1];

        expect(linkRule).toContain("padding-block: 0");
        expect(weekdayRule).toContain("min-height: 1.5rem");
        expect(weekdayRule).toContain("line-height: 1");
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

    it("styles relative period labels as space-aware muted small caps", () => {
        const titleRule = stylesheet.match(
            /\.fc \.fc-toolbar-title\s*\{([^}]*)\}/
        )?.[1];
        const labelRule = stylesheet.match(
            /\.fc \.fc-toolbar-title \.ofc-relative-period-label\s*\{([^}]*)\}/
        )?.[1];

        expect(titleRule).toContain("text-align: center");
        expect(labelRule).toContain("display: block");
        expect(labelRule).toContain("color: var(--text-faint)");
        expect(labelRule).toContain("font-size: 0.72em");
        expect(labelRule).toContain("font-variant-caps: all-small-caps");
        expect(stylesheet).toContain("@container (max-width: 32rem)");
        expect(stylesheet).toContain(
            ".fc .fc-toolbar-title .ofc-relative-period-label"
        );
    });

    it("contains no retired list-view selectors", () => {
        expect(stylesheet).not.toContain("fc-list");
    });
});
