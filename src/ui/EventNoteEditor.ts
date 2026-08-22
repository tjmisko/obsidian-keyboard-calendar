import {
    App,
    MarkdownView,
    Notice,
    TFile,
    WorkspaceLeaf,
    WorkspaceSplit,
} from "obsidian";

type ConstructableWorkspaceSplit = new (
    workspace: App["workspace"],
    direction: "horizontal" | "vertical"
) => WorkspaceSplit;

type EmbeddedSplit = WorkspaceSplit & {
    containerEl: HTMLElement;
    getRoot: () => unknown;
    getContainer: () => unknown;
};

type ExHandler = (cm: unknown, input: string, ...args: unknown[]) => unknown;

type CommandTarget = {
    handleEx?: ExHandler;
    processCommand?: ExHandler;
};

type VimApi = CommandTarget & {
    ExCommandDispatcher?: { prototype?: CommandTarget };
};

type EditorSession = {
    leaf: WorkspaceLeaf;
    view: MarkdownView;
    previousLeaf: WorkspaceLeaf | null;
    overlayEl: HTMLElement | null;
    editorContainerEl: HTMLElement | null;
};

type LegacyCodeMirrorEditor = {
    on?: unknown;
    off?: unknown;
};

const getLegacyCodeMirrorEditor = (
    view: MarkdownView
): LegacyCodeMirrorEditor | null => {
    const editMode = (view as unknown as { editMode?: any }).editMode;
    return editMode?.editor?.cm?.cm || null;
};

const getVimApi = (): VimApi | null => {
    if (typeof window === "undefined") {
        return null;
    }
    const globalWindow = window as typeof window & {
        CodeMirror?: { Vim?: VimApi };
        CodeMirrorVim?: { Vim?: VimApi };
        CodeMirrorAdapter?: { Vim?: VimApi };
    };
    return (
        globalWindow.CodeMirrorAdapter?.Vim ||
        globalWindow.CodeMirror?.Vim ||
        globalWindow.CodeMirrorVim?.Vim ||
        null
    );
};

/**
 * Installs one reversible wrapper around CodeMirror Vim's Ex entry point. The
 * wrapper delegates untouched commands and every command from an ordinary
 * editor to the handler that was present before Full Calendar loaded.
 */
export class EventNoteVimCommands {
    private vim: VimApi | null = null;
    private commandTarget: CommandTarget | null = null;
    private commandKey: keyof CommandTarget | null = null;
    private originalCommand: ExHandler | undefined = undefined;
    private wrappedCommand: ExHandler | undefined = undefined;
    private managedEditors = new Set<unknown>();
    private editorContainerEl: HTMLElement | null = null;

    constructor(
        private save: () => Promise<void>,
        private close: (save: boolean) => Promise<void>,
        private vimProvider: () => VimApi | null = getVimApi
    ) {}

    bind(view: MarkdownView, editorContainerEl: HTMLElement | null): void {
        this.managedEditors.clear();
        const editor = view.editor as unknown as Record<string, unknown>;
        const editMode = (view as unknown as { editMode?: any }).editMode;
        [
            view.editor,
            editor.cm,
            editMode?.editor,
            editMode?.editor?.cm,
            editMode?.editor?.cm?.cm,
            editMode?.cm,
        ].forEach((candidate) => {
            if (candidate) {
                this.managedEditors.add(candidate);
            }
        });
        this.editorContainerEl = editorContainerEl;
        this.install();
    }

    unbind(): void {
        this.managedEditors.clear();
        this.editorContainerEl = null;
    }

    private isManaged(cm: unknown): boolean {
        if (this.managedEditors.has(cm)) {
            return true;
        }
        if (!this.editorContainerEl || !cm || typeof cm !== "object") {
            return false;
        }
        const editor = cm as {
            dom?: Node;
            contentDOM?: Node;
            getWrapperElement?: () => Node;
        };
        const editorEl =
            editor.dom || editor.contentDOM || editor.getWrapperElement?.();
        return !!editorEl && this.editorContainerEl.contains(editorEl);
    }

    install(): void {
        if (this.vim) {
            return;
        }
        const vim = this.vimProvider();
        if (!vim) {
            return;
        }

        const dispatcher = vim.ExCommandDispatcher?.prototype;
        const commandTarget =
            dispatcher && typeof dispatcher.processCommand === "function"
                ? dispatcher
                : vim;
        const commandKey =
            commandTarget === dispatcher ? "processCommand" : "handleEx";
        const original = commandTarget[commandKey];
        if (typeof original !== "function") {
            return;
        }
        const self = this;
        const wrapped = function (
            this: unknown,
            cm: unknown,
            input: string,
            ...args: unknown[]
        ): unknown {
            if (!self.isManaged(cm)) {
                return original.call(this, cm, input, ...args);
            }

            const command = input.trim().replace(/^:/, "").toLowerCase();
            if (command === "w" || command === "write") {
                void self.save();
                return;
            }
            if (["wq", "wq!", "x", "xit"].includes(command)) {
                void self.close(true);
                return;
            }
            if (["q", "q!", "quit"].includes(command)) {
                void self.close(false);
                return;
            }
            return original.call(this, cm, input, ...args);
        };

        this.vim = vim;
        this.commandTarget = commandTarget;
        this.commandKey = commandKey;
        this.originalCommand = original;
        this.wrappedCommand = wrapped;
        commandTarget[commandKey] = wrapped;
    }

    uninstall(): void {
        if (
            this.commandTarget &&
            this.commandKey &&
            this.originalCommand &&
            this.commandTarget[this.commandKey] === this.wrappedCommand
        ) {
            this.commandTarget[this.commandKey] = this.originalCommand;
        }
        this.unbind();
        this.vim = null;
        this.commandTarget = null;
        this.commandKey = null;
        this.originalCommand = undefined;
        this.wrappedCommand = undefined;
    }
}

/**
 * Owns the temporary real WorkspaceLeaf used to edit a full-note event. All
 * unsupported workspace integration is intentionally confined to this class.
 */
export default class EventNoteEditor {
    private session: EditorSession | null = null;
    private vimCommands = new EventNoteVimCommands(
        () => this.save(),
        (save) => this.close(save)
    );

    constructor(private app: App) {}

    /**
     * Vimrc Support listens for active-leaf-change and assumes Obsidian's
     * legacy CodeMirror facade already exists. A detached leaf can finish
     * rendering a frame after openFile resolves, so do not expose it as the
     * active leaf until that facade is usable.
     */
    private async waitForVimAdapter(view: MarkdownView): Promise<void> {
        const appWithVim = this.app as unknown as {
            isVimEnabled?: () => boolean;
        };
        if (appWithVim.isVimEnabled?.() !== true) {
            return;
        }

        for (let attempt = 0; attempt < 30; attempt += 1) {
            const codeMirror = getLegacyCodeMirrorEditor(view);
            if (
                codeMirror &&
                typeof codeMirror.on === "function" &&
                typeof codeMirror.off === "function"
            ) {
                return;
            }
            await new Promise<void>((resolve) => setTimeout(resolve, 16));
        }

        throw new Error("The embedded Vim editor did not finish initializing.");
    }

    private makeOverlay(): {
        overlayEl: HTMLElement;
        panelEl: HTMLElement;
    } {
        const overlayEl = document.createElement("div");
        overlayEl.className = "ofc-event-note-overlay";

        const panelEl = document.createElement("div");
        panelEl.className = "ofc-event-note-dialog";
        panelEl.setAttribute("role", "dialog");
        panelEl.setAttribute("aria-modal", "true");
        panelEl.setAttribute("aria-label", "Edit calendar event note");
        panelEl.tabIndex = -1;

        const closeButton = document.createElement("button");
        closeButton.className = "ofc-event-note-close clickable-icon";
        closeButton.type = "button";
        closeButton.setAttribute("aria-label", "Save and close event note");
        closeButton.textContent = "×";
        closeButton.addEventListener("click", () => void this.close(true));
        panelEl.appendChild(closeButton);

        panelEl.addEventListener("keydown", (event) => {
            if (event.key !== "Tab") {
                return;
            }
            const focusable = Array.from(
                panelEl.querySelectorAll<HTMLElement>(
                    'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
                )
            ).filter(
                (element) =>
                    element.offsetParent !== null || element === closeButton
            );
            if (focusable.length === 0) {
                event.preventDefault();
                panelEl.focus();
                return;
            }
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        });

        overlayEl.appendChild(panelEl);
        document.body.appendChild(overlayEl);
        return { overlayEl, panelEl };
    }

    private async openEmbedded(
        file: TFile,
        previousLeaf: WorkspaceLeaf | null
    ): Promise<void> {
        const { overlayEl, panelEl } = this.makeOverlay();
        let leaf: WorkspaceLeaf | null = null;
        try {
            const Split =
                WorkspaceSplit as unknown as ConstructableWorkspaceSplit;
            if (
                typeof Split !== "function" ||
                typeof this.app.workspace.createLeafInParent !== "function"
            ) {
                throw new Error("Embedded workspace leaves are unavailable.");
            }
            const split = new Split(
                this.app.workspace,
                "vertical"
            ) as EmbeddedSplit;
            if (!split.containerEl) {
                throw new Error("Embedded workspace split has no container.");
            }
            split.getRoot = () => this.app.workspace.rootSplit;
            split.getContainer = () => this.app.workspace.rootSplit;
            panelEl.appendChild(split.containerEl);

            leaf = this.app.workspace.createLeafInParent(split, 0);
            await leaf.openFile(file, { active: false });
            if (!(leaf.view instanceof MarkdownView)) {
                throw new Error("Obsidian did not create a Markdown view.");
            }
            await this.waitForVimAdapter(leaf.view);

            const editorContainerEl =
                (leaf as unknown as { containerEl?: HTMLElement })
                    .containerEl || split.containerEl;
            this.session = {
                leaf,
                view: leaf.view,
                previousLeaf,
                overlayEl,
                editorContainerEl,
            };
            this.vimCommands.bind(leaf.view, editorContainerEl);
            this.app.workspace.setActiveLeaf(leaf, { focus: true });
            leaf.view.editor.focus();
            leaf.onResize();
        } catch (error) {
            if (this.session?.leaf === leaf) {
                this.session = null;
                this.vimCommands.unbind();
            }
            if (
                leaf &&
                this.app.workspace.activeLeaf === leaf &&
                previousLeaf
            ) {
                this.app.workspace.setActiveLeaf(previousLeaf, {
                    focus: true,
                });
            }
            leaf?.detach();
            overlayEl.remove();
            throw error;
        }
    }

    private async openInTab(
        file: TFile,
        previousLeaf: WorkspaceLeaf | null
    ): Promise<void> {
        const leaf = this.app.workspace.getLeaf("tab");
        try {
            await leaf.openFile(file);
            if (!(leaf.view instanceof MarkdownView)) {
                throw new Error("Obsidian did not create a Markdown view.");
            }
            const editorContainerEl =
                (leaf as unknown as { containerEl?: HTMLElement })
                    .containerEl || null;
            this.session = {
                leaf,
                view: leaf.view,
                previousLeaf,
                overlayEl: null,
                editorContainerEl,
            };
            this.vimCommands.bind(leaf.view, editorContainerEl);
            leaf.view.editor.focus();
        } catch (error) {
            leaf.detach();
            throw error;
        }
    }

    async open(file: TFile): Promise<void> {
        await this.close(true);
        const previousLeaf =
            this.app.workspace.activeLeaf ||
            this.app.workspace.getMostRecentLeaf();
        try {
            await this.openEmbedded(file, previousLeaf);
        } catch (error) {
            console.warn(
                "Full Calendar could not mount an embedded Markdown leaf; falling back to a tab.",
                error
            );
            new Notice(
                "This Obsidian version cannot embed the event editor. Opened the note in a tab instead."
            );
            await this.openInTab(file, previousLeaf);
        }
    }

    async save(): Promise<void> {
        if (this.session) {
            await this.session.view.save();
        }
    }

    async close(save = true): Promise<void> {
        const session = this.session;
        if (!session) {
            return;
        }
        this.session = null;
        this.vimCommands.unbind();
        try {
            if (save) {
                await session.view.save();
            }
        } finally {
            if (session.previousLeaf) {
                try {
                    this.app.workspace.setActiveLeaf(session.previousLeaf, {
                        focus: true,
                    });
                } catch (error) {
                    console.debug(
                        "Could not restore the previously active calendar leaf.",
                        error
                    );
                }
            }
            session.leaf.detach();
            session.overlayEl?.remove();
        }
    }

    unload(): void {
        void this.close(true);
        this.vimCommands.uninstall();
    }

    get _sessionForTest(): EditorSession | null {
        return this.session;
    }
}
