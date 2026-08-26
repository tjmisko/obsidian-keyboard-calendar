import { ItemView, WorkspaceLeaf } from "obsidian";
import { LEGACY_FULL_CALENDAR_VIEW_TYPE } from "../legacy_primary_bridge";

/** Decoder-only view for primary leaves saved under the former product ID. */
export class LegacyPrimaryCompatibilityView extends ItemView {
    constructor(
        leaf: WorkspaceLeaf,
        private readonly requestMigration: () => void
    ) {
        super(leaf);
    }

    getViewType(): string {
        return LEGACY_FULL_CALENDAR_VIEW_TYPE;
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
            text: "Updating this saved calendar to Keyboard Calendar…",
        });
        this.requestMigration();
    }
}
