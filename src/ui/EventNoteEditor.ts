import { App, TFile, WorkspaceLeaf } from "obsidian";

export interface EventNoteOpenOptions {
    focusTitle?: boolean;
    focusEventOnReturn?: boolean;
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
    private readonly calendarReturnTargets = new WeakMap<
        WorkspaceLeaf,
        TFile
    >();

    constructor(private app: App) {}

    consumeCalendarReturnTarget(leaf: WorkspaceLeaf): TFile | null {
        const file = this.calendarReturnTargets.get(leaf) || null;
        this.calendarReturnTargets.delete(leaf);
        return file;
    }

    async open(
        file: TFile,
        targetLeaf?: WorkspaceLeaf,
        options: EventNoteOpenOptions = {}
    ): Promise<void> {
        const leaf =
            targetLeaf ||
            this.app.workspace.activeLeaf ||
            this.app.workspace.getLeaf(false);
        if (options.focusEventOnReturn) {
            this.calendarReturnTargets.set(leaf, file);
        }
        try {
            await leaf.openFile(file);
        } catch (error) {
            if (this.calendarReturnTargets.get(leaf) === file) {
                this.calendarReturnTargets.delete(leaf);
            }
            throw error;
        }
        if (options.focusTitle) {
            focusInlineTitle(leaf);
        }
    }
}
