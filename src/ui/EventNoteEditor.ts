import { App, TFile, WorkspaceLeaf } from "obsidian";

/**
 * Opens an event note as an ordinary Markdown buffer in the originating leaf.
 * Keeping this on Obsidian's normal navigation path preserves command-palette,
 * Vim, recent-file, alternate-file, and back/forward behavior.
 */
export default class EventNoteEditor {
    constructor(private app: App) {}

    async open(file: TFile, targetLeaf?: WorkspaceLeaf): Promise<void> {
        const leaf =
            targetLeaf ||
            this.app.workspace.activeLeaf ||
            this.app.workspace.getLeaf(false);
        await leaf.openFile(file);
    }
}
