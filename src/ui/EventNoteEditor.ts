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

type PerformanceLogDetails = Record<string, unknown>;

const performanceNow = (): number =>
    typeof performance === "undefined" ? Date.now() : performance.now();

const roundMilliseconds = (milliseconds: number): number =>
    Math.round(milliseconds * 10) / 10;

let performanceTraceSequence = 0;

class EventNotePerformanceTrace {
    private readonly id = ++performanceTraceSequence;
    private readonly startedAt = performanceNow();
    private previousCheckpointAt = this.startedAt;

    constructor(
        private readonly operation: string,
        private readonly context: PerformanceLogDetails = {}
    ) {
        this.checkpoint("started");
    }

    checkpoint(step: string, details: PerformanceLogDetails = {}): void {
        const now = performanceNow();
        const stepMs = roundMilliseconds(now - this.previousCheckpointAt);
        const message = `[Full Calendar][event-note performance][${this.operation}#${this.id}] ${step}`;
        const logDetails = {
            ...this.context,
            ...details,
            elapsedMs: roundMilliseconds(now - this.startedAt),
            stepMs,
            slowStep: stepMs >= 1000,
            timestamp: new Date().toISOString(),
        };
        if (logDetails.slowStep) {
            console.warn(`${message} [slow]`, logDetails);
        } else {
            console.info(message, logDetails);
        }
        this.previousCheckpointAt = performanceNow();
    }

    failure(
        step: string,
        error: unknown,
        details: PerformanceLogDetails = {}
    ): void {
        const now = performanceNow();
        const stepMs = roundMilliseconds(now - this.previousCheckpointAt);
        console.error(
            `[Full Calendar][event-note performance][${this.operation}#${this.id}] ${step}`,
            {
                ...this.context,
                ...details,
                elapsedMs: roundMilliseconds(now - this.startedAt),
                stepMs,
                slowStep: stepMs >= 1000,
                timestamp: new Date().toISOString(),
                errorName: error instanceof Error ? error.name : undefined,
                errorMessage:
                    error instanceof Error ? error.message : String(error),
            },
            error
        );
        this.previousCheckpointAt = performanceNow();
    }
}

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
    private async waitForVimAdapter(
        view: MarkdownView,
        trace?: EventNotePerformanceTrace
    ): Promise<void> {
        const appWithVim = this.app as unknown as {
            isVimEnabled?: () => boolean;
        };
        const vimEnabled = appWithVim.isVimEnabled?.() === true;
        trace?.checkpoint("embedded.vim-adapter.checked", { vimEnabled });
        if (!vimEnabled) {
            return;
        }

        for (let attempt = 0; attempt < 30; attempt += 1) {
            const codeMirror = getLegacyCodeMirrorEditor(view);
            if (
                codeMirror &&
                typeof codeMirror.on === "function" &&
                typeof codeMirror.off === "function"
            ) {
                trace?.checkpoint("embedded.vim-adapter.ready", {
                    attempts: attempt + 1,
                });
                return;
            }
            if (attempt === 0 || (attempt + 1) % 5 === 0) {
                trace?.checkpoint("embedded.vim-adapter.waiting", {
                    attempts: attempt + 1,
                });
            }
            await new Promise<void>((resolve) => setTimeout(resolve, 16));
        }

        trace?.checkpoint("embedded.vim-adapter.timed-out", { attempts: 30 });
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
        previousLeaf: WorkspaceLeaf | null,
        trace: EventNotePerformanceTrace
    ): Promise<void> {
        trace.checkpoint("embedded.overlay.create.started");
        const { overlayEl, panelEl } = this.makeOverlay();
        trace.checkpoint("embedded.overlay.create.completed", {
            overlayConnected: overlayEl.isConnected,
        });
        let leaf: WorkspaceLeaf | null = null;
        try {
            trace.checkpoint("embedded.workspace-split.create.started");
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
            trace.checkpoint("embedded.workspace-split.create.completed");
            if (!split.containerEl) {
                throw new Error("Embedded workspace split has no container.");
            }
            split.getRoot = () => this.app.workspace.rootSplit;
            split.getContainer = () => this.app.workspace.rootSplit;
            panelEl.appendChild(split.containerEl);
            trace.checkpoint("embedded.workspace-split.attached");

            trace.checkpoint("embedded.leaf.create.started");
            leaf = this.app.workspace.createLeafInParent(split, 0);
            trace.checkpoint("embedded.leaf.create.completed", {
                leafViewType: leaf.getViewState().type,
            });
            trace.checkpoint("embedded.leaf.open-file.started");
            await leaf.openFile(file, { active: false });
            trace.checkpoint("embedded.leaf.open-file.completed", {
                leafViewType: leaf.getViewState().type,
            });
            if (!(leaf.view instanceof MarkdownView)) {
                throw new Error("Obsidian did not create a Markdown view.");
            }
            await this.waitForVimAdapter(leaf.view, trace);

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
            trace.checkpoint("embedded.session.created", {
                hasEditorContainer: !!editorContainerEl,
            });
            this.vimCommands.bind(leaf.view, editorContainerEl);
            trace.checkpoint("embedded.vim-commands.bound");
            trace.checkpoint("embedded.active-leaf.set.started");
            this.app.workspace.setActiveLeaf(leaf, { focus: true });
            trace.checkpoint("embedded.active-leaf.set.completed");
            trace.checkpoint("embedded.editor.focus.started");
            leaf.view.editor.focus();
            trace.checkpoint("embedded.editor.focus.completed");
            trace.checkpoint("embedded.leaf.resize.started");
            leaf.onResize();
            trace.checkpoint("embedded.leaf.resize.completed");
        } catch (error) {
            trace.failure("embedded.open.failed", error, {
                hasLeaf: !!leaf,
                sessionCreated: this.session?.leaf === leaf,
            });
            if (this.session?.leaf === leaf) {
                this.session = null;
                this.vimCommands.unbind();
                trace.checkpoint("embedded.failed-session.cleared");
            }
            if (
                leaf &&
                this.app.workspace.activeLeaf === leaf &&
                previousLeaf
            ) {
                this.app.workspace.setActiveLeaf(previousLeaf, {
                    focus: true,
                });
                trace.checkpoint("embedded.previous-leaf.restored");
            }
            trace.checkpoint("embedded.cleanup.started");
            leaf?.detach();
            overlayEl.remove();
            trace.checkpoint("embedded.cleanup.completed");
            throw error;
        }
    }

    private async openInTab(
        file: TFile,
        previousLeaf: WorkspaceLeaf | null,
        trace: EventNotePerformanceTrace
    ): Promise<void> {
        trace.checkpoint("fallback-tab.leaf.create.started");
        const leaf = this.app.workspace.getLeaf("tab");
        trace.checkpoint("fallback-tab.leaf.create.completed");
        try {
            trace.checkpoint("fallback-tab.leaf.open-file.started");
            await leaf.openFile(file);
            trace.checkpoint("fallback-tab.leaf.open-file.completed", {
                leafViewType: leaf.getViewState().type,
            });
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
            trace.checkpoint("fallback-tab.session.created", {
                hasEditorContainer: !!editorContainerEl,
            });
            this.vimCommands.bind(leaf.view, editorContainerEl);
            trace.checkpoint("fallback-tab.vim-commands.bound");
            trace.checkpoint("fallback-tab.editor.focus.started");
            leaf.view.editor.focus();
            trace.checkpoint("fallback-tab.editor.focus.completed");
        } catch (error) {
            trace.failure("fallback-tab.open.failed", error);
            leaf.detach();
            trace.checkpoint("fallback-tab.failed-leaf.detached");
            throw error;
        }
    }

    async open(file: TFile): Promise<void> {
        const trace = new EventNotePerformanceTrace("open", {
            filePath: file.path,
            fileSizeBytes: file.stat.size,
            fileModifiedAt: new Date(file.stat.mtime).toISOString(),
        });
        trace.checkpoint("existing-session.close.started", {
            hasExistingSession: !!this.session,
        });
        try {
            await this.closeSession(true, trace);
        } catch (error) {
            trace.failure("existing-session.close.failed", error);
            throw error;
        }
        trace.checkpoint("existing-session.close.completed");
        const previousLeaf =
            this.app.workspace.activeLeaf ||
            this.app.workspace.getMostRecentLeaf();
        trace.checkpoint("previous-leaf.resolved", {
            hasPreviousLeaf: !!previousLeaf,
            previousLeafViewType: previousLeaf?.getViewState().type,
        });
        try {
            await this.openEmbedded(file, previousLeaf, trace);
            trace.checkpoint("completed", { mode: "embedded" });
        } catch (error) {
            trace.checkpoint("fallback-tab.requested");
            console.warn(
                "Full Calendar could not mount an embedded Markdown leaf; falling back to a tab.",
                error
            );
            new Notice(
                "This Obsidian version cannot embed the event editor. Opened the note in a tab instead."
            );
            try {
                await this.openInTab(file, previousLeaf, trace);
                trace.checkpoint("completed", { mode: "fallback-tab" });
            } catch (fallbackError) {
                trace.failure("failed", fallbackError, {
                    mode: "fallback-tab",
                });
                throw fallbackError;
            }
        }
    }

    async save(): Promise<void> {
        const session = this.session;
        const trace = new EventNotePerformanceTrace("save", {
            filePath: session?.view.file?.path,
        });
        if (!session) {
            trace.checkpoint("skipped", { reason: "no-active-session" });
            return;
        }
        try {
            trace.checkpoint("view.save.started");
            await session.view.save();
            trace.checkpoint("completed");
        } catch (error) {
            trace.failure("failed", error);
            throw error;
        }
    }

    private async closeSession(
        save: boolean,
        trace: EventNotePerformanceTrace
    ): Promise<void> {
        const session = this.session;
        if (!session) {
            trace.checkpoint("close.skipped", {
                reason: "no-active-session",
                save,
            });
            return;
        }
        trace.checkpoint("close.started", {
            filePath: session.view.file?.path,
            save,
            hasOverlay: !!session.overlayEl,
        });
        this.session = null;
        this.vimCommands.unbind();
        trace.checkpoint("close.session-cleared");
        try {
            if (save) {
                trace.checkpoint("close.view-save.started");
                await session.view.save();
                trace.checkpoint("close.view-save.completed");
            }
        } finally {
            if (session.previousLeaf) {
                try {
                    trace.checkpoint("close.previous-leaf.restore.started");
                    this.app.workspace.setActiveLeaf(session.previousLeaf, {
                        focus: true,
                    });
                    trace.checkpoint("close.previous-leaf.restore.completed");
                } catch (error) {
                    trace.failure("close.previous-leaf.restore.failed", error);
                    console.debug(
                        "Could not restore the previously active calendar leaf.",
                        error
                    );
                }
            }
            trace.checkpoint("close.leaf-detach.started");
            session.leaf.detach();
            trace.checkpoint("close.leaf-detach.completed");
            trace.checkpoint("close.overlay-remove.started");
            session.overlayEl?.remove();
            trace.checkpoint("close.overlay-remove.completed");
        }
    }

    async close(save = true): Promise<void> {
        const trace = new EventNotePerformanceTrace("close", {
            filePath: this.session?.view.file?.path,
            save,
        });
        try {
            await this.closeSession(save, trace);
            trace.checkpoint("completed");
        } catch (error) {
            trace.failure("failed", error);
            throw error;
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
