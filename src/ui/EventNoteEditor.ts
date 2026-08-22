import {
    App,
    MarkdownView,
    Modal,
    Notice,
    TFile,
    WorkspaceLeaf,
} from "obsidian";

type ExHandler = (cm: unknown, input: string, ...args: unknown[]) => unknown;

type CommandTarget = {
    handleEx?: ExHandler;
    processCommand?: ExHandler;
};

type VimApi = CommandTarget & {
    ExCommandDispatcher?: { prototype?: CommandTarget };
};

type PortalLocation = {
    containerEl: HTMLElement;
    placeholder: Node;
    parent: Node;
};

type EditorMode = "registered-leaf-modal" | "standard-tab-fallback";

type EditorSession = {
    leaf: WorkspaceLeaf;
    view: MarkdownView;
    previousLeaf: WorkspaceLeaf | null;
    modal: EventNoteModalController | null;
    portal: PortalLocation | null;
    editorContainerEl: HTMLElement | null;
    mode: EditorMode;
    vimEnabled: boolean;
};

type OpeningSession = {
    operationId: number;
    leaf: WorkspaceLeaf | null;
    previousLeaf: WorkspaceLeaf | null;
    modal: EventNoteModalController;
    cancelled: boolean;
    detached: boolean;
};

export type EventNoteModalController = {
    open: () => void;
    closeManaged: () => void;
    mountLeaf: (containerEl: HTMLElement) => void;
};

export type EventNoteModalFactory = (
    app: App,
    requestClose: () => void
) => EventNoteModalController;

type EventNoteEditorDependencies = {
    createModal?: EventNoteModalFactory;
    createPlaceholder?: () => Node;
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

const SLOW_STEP_THRESHOLD_MS = 250;

let performanceTraceSequence = 0;

class EventNotePerformanceTrace {
    private readonly id = ++performanceTraceSequence;
    private readonly startedAt = performanceNow();
    private previousCheckpointAt = this.startedAt;
    private slowestStep = "started";
    private slowestStepMs = 0;

    constructor(
        private readonly operation: string,
        private readonly context: PerformanceLogDetails = {}
    ) {
        this.checkpoint("started");
    }

    checkpoint(step: string, details: PerformanceLogDetails = {}): void {
        const now = performanceNow();
        const stepMs = roundMilliseconds(now - this.previousCheckpointAt);
        if (stepMs > this.slowestStepMs) {
            this.slowestStep = step;
            this.slowestStepMs = stepMs;
        }
        const message = `[Full Calendar][event-note performance][${this.operation}#${this.id}] ${step}`;
        const logDetails = {
            ...this.context,
            ...details,
            elapsedMs: roundMilliseconds(now - this.startedAt),
            stepMs,
            slowStep: stepMs >= SLOW_STEP_THRESHOLD_MS,
            timestamp: new Date().toISOString(),
        };
        if (logDetails.slowStep) {
            console.warn(`${message} [slow]`, logDetails);
        } else {
            console.info(message, logDetails);
        }
        this.previousCheckpointAt = performanceNow();
    }

    complete(details: PerformanceLogDetails = {}): void {
        this.checkpoint("completed", {
            ...details,
            totalMs: roundMilliseconds(performanceNow() - this.startedAt),
            slowestStep: this.slowestStep,
            slowestStepMs: this.slowestStepMs,
        });
    }

    failure(
        step: string,
        error: unknown,
        details: PerformanceLogDetails = {}
    ): void {
        const now = performanceNow();
        const stepMs = roundMilliseconds(now - this.previousCheckpointAt);
        if (stepMs > this.slowestStepMs) {
            this.slowestStep = step;
            this.slowestStepMs = stepMs;
        }
        console.error(
            `[Full Calendar][event-note performance][${this.operation}#${this.id}] ${step}`,
            {
                ...this.context,
                ...details,
                elapsedMs: roundMilliseconds(now - this.startedAt),
                stepMs,
                slowStep: stepMs >= SLOW_STEP_THRESHOLD_MS,
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

class EventNoteModal extends Modal implements EventNoteModalController {
    private closed = false;
    private managedClose = false;
    private leafHostEl: HTMLElement | null = null;

    constructor(app: App, private readonly requestClose: () => void) {
        super(app);
    }

    onOpen(): void {
        this.closed = false;
        this.managedClose = false;
        this.modalEl.classList.add("ofc-event-note-modal");
        this.contentEl.classList.add("ofc-event-note-dialog");
        this.contentEl.replaceChildren();

        const loadingEl = document.createElement("div");
        loadingEl.className = "ofc-event-note-loading";
        loadingEl.setAttribute("role", "status");
        loadingEl.textContent = "Opening event note…";
        this.contentEl.appendChild(loadingEl);

        this.leafHostEl = document.createElement("div");
        this.leafHostEl.className = "ofc-event-note-leaf-host";
        this.contentEl.appendChild(this.leafHostEl);
    }

    onClose(): void {
        this.closed = true;
        this.leafHostEl = null;
        if (!this.managedClose) {
            this.requestClose();
        }
    }

    mountLeaf(containerEl: HTMLElement): void {
        if (!this.leafHostEl || this.closed) {
            throw new Error("The event-note modal closed before mounting.");
        }
        this.contentEl.querySelector(".ofc-event-note-loading")?.remove();
        this.leafHostEl.appendChild(containerEl);
    }

    closeManaged(): void {
        this.managedClose = true;
        if (!this.closed) {
            this.close();
        }
    }
}

class EventNoteOpenCancelled extends Error {
    constructor() {
        super("Event-note opening was cancelled.");
        this.name = "EventNoteOpenCancelled";
    }
}

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
 * Opens a normal registered workspace leaf, lets Obsidian and third-party
 * plugins initialize it through the standard lifecycle, and only then moves
 * its DOM container into an Obsidian Modal. The leaf is returned to its
 * original registered location before it is detached.
 */
export default class EventNoteEditor {
    private session: EditorSession | null = null;
    private opening: OpeningSession | null = null;
    private operationSequence = 0;
    private readonly createModal: EventNoteModalFactory;
    private readonly createPlaceholder: () => Node;
    private vimCommands = new EventNoteVimCommands(
        () => this.save(),
        (save) => this.close(save)
    );

    constructor(
        private app: App,
        dependencies: EventNoteEditorDependencies = {}
    ) {
        this.createModal =
            dependencies.createModal ||
            ((modalApp, requestClose) =>
                new EventNoteModal(modalApp, requestClose));
        this.createPlaceholder =
            dependencies.createPlaceholder ||
            (() => document.createComment("full-calendar-event-note"));
    }

    private isVimEnabled(): boolean {
        const appWithVim = this.app as unknown as {
            isVimEnabled?: () => boolean;
        };
        return appWithVim.isVimEnabled?.() === true;
    }

    /** Waits only after normal leaf initialization has completed. */
    private async waitForVimAdapter(
        view: MarkdownView,
        trace?: EventNotePerformanceTrace
    ): Promise<void> {
        const vimEnabled = this.isVimEnabled();
        trace?.checkpoint("registered-leaf.vim-adapter.checked", {
            vimEnabled,
        });
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
                trace?.checkpoint("registered-leaf.vim-adapter.ready", {
                    attempts: attempt + 1,
                });
                return;
            }
            if (attempt === 0 || (attempt + 1) % 5 === 0) {
                trace?.checkpoint("registered-leaf.vim-adapter.waiting", {
                    attempts: attempt + 1,
                });
            }
            await new Promise<void>((resolve) => setTimeout(resolve, 16));
        }

        trace?.checkpoint("registered-leaf.vim-adapter.timed-out", {
            attempts: 30,
        });
        throw new Error("The Vim editor did not finish initializing.");
    }

    private leafViewType(leaf: WorkspaceLeaf | null): string | undefined {
        try {
            return leaf?.getViewState().type;
        } catch {
            return undefined;
        }
    }

    private throwIfOpeningChanged(opening: OpeningSession): void {
        if (
            opening.cancelled ||
            this.opening !== opening ||
            this.operationSequence !== opening.operationId
        ) {
            throw new EventNoteOpenCancelled();
        }
    }

    private mountLeafInModal(
        opening: OpeningSession,
        containerEl: HTMLElement
    ): PortalLocation {
        const parent = containerEl.parentNode;
        if (!parent) {
            throw new Error("The registered workspace leaf has no DOM parent.");
        }
        const placeholder = this.createPlaceholder();
        parent.insertBefore(placeholder, containerEl);
        try {
            opening.modal.mountLeaf(containerEl);
        } catch (error) {
            parent.insertBefore(containerEl, placeholder);
            placeholder.parentNode?.removeChild(placeholder);
            throw error;
        }
        return { containerEl, placeholder, parent };
    }

    private restorePortal(
        portal: PortalLocation,
        trace: EventNotePerformanceTrace
    ): void {
        trace.checkpoint("close.portal-restore.started");
        if (portal.placeholder.parentNode === portal.parent) {
            portal.parent.insertBefore(portal.containerEl, portal.placeholder);
            portal.parent.removeChild(portal.placeholder);
        } else if (portal.containerEl.parentNode !== portal.parent) {
            portal.parent.appendChild(portal.containerEl);
        }
        trace.checkpoint("close.portal-restore.completed");
    }

    private restoreActiveLeafAfterStaleOpen(
        opening: OpeningSession,
        trace: EventNotePerformanceTrace
    ): void {
        if (!opening.leaf || this.app.workspace.activeLeaf !== opening.leaf) {
            return;
        }
        const replacement =
            this.session?.leaf || this.opening?.leaf || opening.previousLeaf;
        if (replacement && replacement !== opening.leaf) {
            this.app.workspace.setActiveLeaf(replacement, { focus: true });
            trace.checkpoint("cancelled.active-leaf.replaced", {
                replacementViewType: this.leafViewType(replacement),
            });
        }
    }

    private cleanupOpening(
        opening: OpeningSession,
        trace: EventNotePerformanceTrace
    ): void {
        opening.modal.closeManaged();
        this.restoreActiveLeafAfterStaleOpen(opening, trace);
        if (opening.leaf && !opening.detached) {
            opening.leaf.detach();
            opening.detached = true;
            trace.checkpoint("cancelled.leaf-detached");
        }
        if (this.opening === opening) {
            this.opening = null;
        }
    }

    private cancelOpening(trace: EventNotePerformanceTrace): boolean {
        const opening = this.opening;
        if (!opening) {
            return false;
        }
        opening.cancelled = true;
        this.opening = null;
        trace.checkpoint("close.opening-cancelled", {
            hasLeaf: !!opening.leaf,
        });
        this.cleanupOpening(opening, trace);
        return true;
    }

    private bindAndFocus(
        session: EditorSession,
        trace: EventNotePerformanceTrace
    ): void {
        try {
            this.vimCommands.bind(session.view, session.editorContainerEl);
            trace.checkpoint("editor.vim-commands.bound");
        } catch (error) {
            trace.failure("editor.vim-commands.bind.failed", error);
        }
        try {
            session.view.editor.focus();
            session.leaf.onResize();
            trace.checkpoint("editor.ready");
        } catch (error) {
            trace.failure("editor.focus-or-resize.failed", error);
        }
    }

    async open(file: TFile): Promise<void> {
        const operationId = ++this.operationSequence;
        const trace = new EventNotePerformanceTrace("open", {
            filePath: file.path,
            fileSizeBytes: file.stat.size,
            fileModifiedAt: new Date(file.stat.mtime).toISOString(),
        });
        trace.checkpoint("existing-session.close.started", {
            hasExistingSession: !!this.session,
            hasOpeningSession: !!this.opening,
        });
        try {
            await this.closeSession(true, trace);
        } catch (error) {
            trace.failure("existing-session.close.failed", error);
            throw error;
        }
        trace.checkpoint("existing-session.close.completed");
        if (operationId !== this.operationSequence) {
            trace.complete({
                mode: "cancelled",
                vimEnabled: false,
                portaled: false,
            });
            return;
        }

        const previousLeaf =
            this.app.workspace.activeLeaf ||
            this.app.workspace.getMostRecentLeaf();
        trace.checkpoint("previous-leaf.resolved", {
            hasPreviousLeaf: !!previousLeaf,
            previousLeafViewType: this.leafViewType(previousLeaf),
        });

        const modal = this.createModal(this.app, () => void this.close(true));
        const opening: OpeningSession = {
            operationId,
            leaf: null,
            previousLeaf,
            modal,
            cancelled: false,
            detached: false,
        };
        this.opening = opening;
        let leafOpened = false;
        let view: MarkdownView | null = null;
        let portal: PortalLocation | null = null;
        const vimEnabled = this.isVimEnabled();

        try {
            modal.open();
            trace.checkpoint("modal.visible", { loading: true });
            this.throwIfOpeningChanged(opening);

            trace.checkpoint("registered-leaf.create.started");
            const leaf = this.app.workspace.getLeaf("tab");
            opening.leaf = leaf;
            this.app.workspace.setActiveLeaf(leaf, { focus: true });
            trace.checkpoint("registered-leaf.create.completed", {
                leafViewType: this.leafViewType(leaf),
            });

            trace.checkpoint("registered-leaf.open-file.started");
            await leaf.openFile(file);
            leafOpened = true;
            trace.checkpoint("registered-leaf.open-file.completed", {
                leafViewType: this.leafViewType(leaf),
            });
            this.throwIfOpeningChanged(opening);
            if (!(leaf.view instanceof MarkdownView)) {
                throw new Error("Obsidian did not create a Markdown view.");
            }
            view = leaf.view;
            await this.waitForVimAdapter(view, trace);
            this.throwIfOpeningChanged(opening);

            const editorContainerEl = (
                leaf as unknown as { containerEl?: HTMLElement }
            ).containerEl;
            if (!editorContainerEl) {
                throw new Error(
                    "The registered workspace leaf has no container."
                );
            }
            trace.checkpoint("modal.portal.started");
            portal = this.mountLeafInModal(opening, editorContainerEl);
            trace.checkpoint("modal.portal.completed");
            this.throwIfOpeningChanged(opening);

            const session: EditorSession = {
                leaf,
                view,
                previousLeaf,
                modal,
                portal,
                editorContainerEl,
                mode: "registered-leaf-modal",
                vimEnabled,
            };
            this.session = session;
            this.opening = null;
            trace.checkpoint("session.created", {
                mode: session.mode,
                hasEditorContainer: true,
            });
            this.bindAndFocus(session, trace);
            trace.complete({
                mode: session.mode,
                vimEnabled,
                portaled: true,
            });
        } catch (error) {
            const cancelled =
                error instanceof EventNoteOpenCancelled ||
                opening.cancelled ||
                operationId !== this.operationSequence;
            if (cancelled) {
                trace.checkpoint("opening.cancelled");
                if (portal) {
                    this.restorePortal(portal, trace);
                }
                this.cleanupOpening(opening, trace);
                trace.complete({
                    mode: "cancelled",
                    vimEnabled,
                    portaled: false,
                });
                return;
            }

            trace.failure("registered-leaf.modal-open.failed", error, {
                leafOpened,
                hasMarkdownView: !!view,
                portaled: !!portal,
            });
            if (portal) {
                this.restorePortal(portal, trace);
                portal = null;
            }
            if (this.opening === opening) {
                this.opening = null;
            }

            if (leafOpened && view && opening.leaf) {
                modal.closeManaged();
                const leaf = opening.leaf;
                this.app.workspace.setActiveLeaf(leaf, { focus: true });
                const editorContainerEl =
                    (leaf as unknown as { containerEl?: HTMLElement })
                        .containerEl || null;
                const session: EditorSession = {
                    leaf,
                    view,
                    previousLeaf,
                    modal: null,
                    portal: null,
                    editorContainerEl,
                    mode: "standard-tab-fallback",
                    vimEnabled,
                };
                this.session = session;
                this.bindAndFocus(session, trace);
                console.warn(
                    "Full Calendar could not portal the registered Markdown leaf into its modal; leaving the already-open note in its tab.",
                    error
                );
                new Notice(
                    "The event editor modal was unavailable. The note remains open in its tab."
                );
                trace.complete({
                    mode: session.mode,
                    vimEnabled,
                    portaled: false,
                });
                return;
            }

            this.cleanupOpening(opening, trace);
            new Notice("Full Calendar could not open this event note.");
            trace.failure("failed", error, {
                mode: "registered-leaf-modal",
            });
            throw error;
        }
    }

    async save(): Promise<void> {
        const session = this.session;
        const trace = new EventNotePerformanceTrace("save", {
            filePath: session?.view.file?.path,
        });
        if (!session) {
            trace.complete({ reason: "no-active-session" });
            return;
        }
        try {
            trace.checkpoint("view.save.started");
            await session.view.save();
            trace.complete({ mode: session.mode });
        } catch (error) {
            trace.failure("failed", error);
            throw error;
        }
    }

    private async closeSession(
        save: boolean,
        trace: EventNotePerformanceTrace
    ): Promise<void> {
        const cancelledOpening = this.cancelOpening(trace);
        const session = this.session;
        if (!session) {
            trace.checkpoint("close.skipped", {
                reason: cancelledOpening
                    ? "opening-session-cancelled"
                    : "no-active-session",
                save,
            });
            return;
        }
        trace.checkpoint("close.started", {
            filePath: session.view.file?.path,
            save,
            mode: session.mode,
            portaled: !!session.portal,
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
            if (session.portal) {
                this.restorePortal(session.portal, trace);
            }
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
            trace.checkpoint("close.modal-close.started");
            session.modal?.closeManaged();
            trace.checkpoint("close.modal-close.completed");
        }
    }

    async close(save = true): Promise<void> {
        ++this.operationSequence;
        const session = this.session;
        const trace = new EventNotePerformanceTrace("close", {
            filePath: session?.view.file?.path,
            save,
        });
        try {
            await this.closeSession(save, trace);
            trace.complete({
                mode: session?.mode,
                vimEnabled: session?.vimEnabled,
                portaled: !!session?.portal,
            });
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

    get _openingForTest(): OpeningSession | null {
        return this.opening;
    }
}
