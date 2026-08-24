import { App, TFile, WorkspaceLeaf } from "obsidian";

export interface EventNoteOpenOptions {
    focusTitle?: boolean;
}

const INLINE_TITLE_SELECTOR =
    '.inline-title[contenteditable]:not([contenteditable="false"])';

const focusInlineTitle = (leaf: WorkspaceLeaf): void => {
    const title = leaf.view.containerEl.querySelector<HTMLElement>(
        INLINE_TITLE_SELECTOR
    );
    if (!title) {
        return;
    }

    title.focus();
    // Match Obsidian's new-note flow: typing replaces the placeholder title.
    const selection = title.ownerDocument.getSelection();
    if (selection) {
        const range = title.ownerDocument.createRange();
        range.selectNodeContents(title);
        selection.removeAllRanges();
        selection.addRange(range);
    }
};

/**
 * Opens an event note as an ordinary Markdown buffer in the originating leaf.
 * Keeping this on Obsidian's normal navigation path preserves command-palette,
 * Vim, recent-file, alternate-file, and back/forward behavior.
 */
export default class EventNoteEditor {
    constructor(private app: App) {}

    async open(
        file: TFile,
        targetLeaf?: WorkspaceLeaf,
        options: EventNoteOpenOptions = {}
    ): Promise<void> {
        const leaf =
            targetLeaf ||
            this.app.workspace.activeLeaf ||
            this.app.workspace.getLeaf(false);
        await leaf.openFile(file);
        if (options.focusTitle) {
            focusInlineTitle(leaf);
        }
    }
}
