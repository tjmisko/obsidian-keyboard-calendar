import { ItemView, WorkspaceLeaf } from "obsidian";
import { LEGACY_FULL_CALENDAR_SIDEBAR_VIEW_TYPE } from "../legacy_sidebar_bridge";

/** Decoder-only view retained for workspace layouts saved by older releases. */
export class LegacySidebarCompatibilityView extends ItemView {
    private readonly requestMigration: () => void;

    constructor(leaf: WorkspaceLeaf, requestMigration: () => void) {
        super(leaf);
        this.requestMigration = requestMigration;
    }

    getViewType(): string {
        return LEGACY_FULL_CALENDAR_SIDEBAR_VIEW_TYPE;
    }

    getDisplayText(): string {
        return "Keyboard Calendar compatibility";
    }

    getIcon(): string {
        return "calendar-glyph";
    }

    async onOpen(): Promise<void> {
        this.contentEl.empty();
        this.contentEl.createEl("p", {
            text: "Moving this saved sidebar calendar to a normal tab…",
        });
        this.requestMigration();
    }
}
