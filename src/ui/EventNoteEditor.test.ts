import { MarkdownView } from "obsidian";
import type { App, TFile, WorkspaceLeaf } from "obsidian";
import EventNoteEditor, {
    EventNoteModalController,
    EventNoteVimCommands,
} from "./EventNoteEditor";

class FakeNode {
    parentNode: FakeNode | null = null;
    children: FakeNode[] = [];
    insertBefore = jest.fn((node: FakeNode, reference: FakeNode | null) => {
        node.parentNode?.removeChild(node);
        const index = reference ? this.children.indexOf(reference) : -1;
        this.children.splice(index < 0 ? this.children.length : index, 0, node);
        node.parentNode = this;
        return node;
    });
    appendChild = jest.fn((node: FakeNode) => {
        node.parentNode?.removeChild(node);
        this.children.push(node);
        node.parentNode = this;
        return node;
    });
    removeChild = jest.fn((node: FakeNode) => {
        const index = this.children.indexOf(node);
        if (index >= 0) {
            this.children.splice(index, 1);
        }
        node.parentNode = null;
        return node;
    });
}

describe("event-note Vim commands", () => {
    const setup = () => {
        const original = jest.fn();
        const vim = { handleEx: original };
        const save = jest.fn(async () => undefined);
        const close = jest.fn(async (_save: boolean) => undefined);
        const editor = {};
        const view = { editor } as MarkdownView;
        const commands = new EventNoteVimCommands(save, close, () => vim);
        commands.bind(view, null);
        return { commands, vim, original, save, close, editor };
    };

    it.each(["w", "write"])("scopes :%s to save without closing", (input) => {
        const { vim, save, close, editor } = setup();

        vim.handleEx(editor, input);

        expect(save).toHaveBeenCalledTimes(1);
        expect(close).not.toHaveBeenCalled();
    });

    it.each(["wq", "wq!", "x", "xit"])(
        "handles save-and-close command :%s",
        (input) => {
            const { vim, close, editor } = setup();

            vim.handleEx(editor, input);

            expect(close).toHaveBeenCalledWith(true);
        }
    );

    it.each(["q", "q!", "quit"])(
        "handles close command :%s without snapshot rollback",
        (input) => {
            const { vim, close, editor } = setup();

            vim.handleEx(editor, input);

            expect(close).toHaveBeenCalledWith(false);
        }
    );

    it("delegates ordinary notes and unknown managed commands", () => {
        const { vim, original, editor } = setup();
        const ordinaryEditor = {};

        vim.handleEx(ordinaryEditor, "q");
        vim.handleEx(editor, "set number");

        expect(original).toHaveBeenNthCalledWith(1, ordinaryEditor, "q");
        expect(original).toHaveBeenNthCalledWith(2, editor, "set number");
    });

    it("restores the previous Ex handler on unload", () => {
        const { commands, vim, original } = setup();

        commands.uninstall();

        expect(vim.handleEx).toBe(original);
    });

    it("wraps the dispatcher used by interactive Ex prompts when available", () => {
        const original = jest.fn();
        const prototype = { processCommand: original };
        const vim = {
            handleEx: jest.fn(),
            ExCommandDispatcher: { prototype },
        };
        const close = jest.fn(async (_save: boolean) => undefined);
        const editor = {};
        const commands = new EventNoteVimCommands(
            async () => undefined,
            close,
            () => vim
        );
        commands.bind({ editor } as MarkdownView, null);

        prototype.processCommand(editor, "q");
        commands.uninstall();

        expect(close).toHaveBeenCalledWith(false);
        expect(original).not.toHaveBeenCalled();
        expect(prototype.processCommand).toBe(original);
    });
});

describe("event-note editor lifecycle", () => {
    const setup = () => {
        const setActiveLeaf = jest.fn();
        const app = { workspace: { setActiveLeaf } } as unknown as App;
        const editor = new EventNoteEditor(app);
        const save = jest.fn(async () => undefined);
        const detach = jest.fn();
        const closeManaged = jest.fn();
        const previousLeaf = {} as WorkspaceLeaf;
        const parent = new FakeNode();
        const placeholder = new FakeNode();
        const host = new FakeNode();
        const container = new FakeNode();
        parent.appendChild(placeholder);
        host.appendChild(container);
        (editor as any).session = {
            leaf: { detach },
            view: { save },
            previousLeaf,
            modal: { closeManaged },
            portal: {
                containerEl: container,
                placeholder,
                parent,
            },
            editorContainerEl: container,
            mode: "registered-leaf-modal",
            vimEnabled: false,
        };
        return {
            editor,
            save,
            detach,
            closeManaged,
            previousLeaf,
            setActiveLeaf,
            parent,
            placeholder,
            container,
        };
    };

    const setupOpen = (
        options: {
            openFile?: () => Promise<void>;
            mountError?: Error;
        } = {}
    ) => {
        const file = {
            path: "Events/2026-08-22 - Test.md",
            stat: { size: 128, mtime: Date.now() },
        } as TFile;
        const previousLeaf = {
            getViewState: () => ({ type: "full-calendar" }),
        } as WorkspaceLeaf;
        const parent = new FakeNode();
        const host = new FakeNode();
        const container = new FakeNode();
        const placeholder = new FakeNode();
        parent.appendChild(container);
        const focus = jest.fn();
        const save = jest.fn(async () => undefined);
        const view = new MarkdownView({} as WorkspaceLeaf);
        Object.assign(view, { editor: { focus }, save, file });
        const detach = jest.fn();
        const onResize = jest.fn();
        const openFile = jest.fn(options.openFile || (async () => undefined));
        const leaf = {
            containerEl: container,
            detach,
            getViewState: () => ({ type: "markdown" }),
            onResize,
            openFile,
            view,
        } as unknown as WorkspaceLeaf;
        const workspace: any = {
            activeLeaf: previousLeaf,
            getLeaf: jest.fn(() => leaf),
            getMostRecentLeaf: jest.fn(() => previousLeaf),
        };
        workspace.setActiveLeaf = jest.fn((activeLeaf: WorkspaceLeaf) => {
            workspace.activeLeaf = activeLeaf;
        });
        const app = {
            isVimEnabled: () => false,
            workspace,
        } as unknown as App;
        let requestClose: () => void = () => undefined;
        const modal: EventNoteModalController = {
            open: jest.fn(),
            closeManaged: jest.fn(),
            mountLeaf: jest.fn((element: HTMLElement) => {
                if (options.mountError) {
                    throw options.mountError;
                }
                host.appendChild(element as unknown as FakeNode);
            }),
        };
        const editor = new EventNoteEditor(app, {
            createModal: (_app, close) => {
                requestClose = close;
                return modal;
            },
            createPlaceholder: () => placeholder as unknown as Node,
        });
        return {
            app,
            container,
            detach,
            editor,
            file,
            focus,
            host,
            leaf,
            modal,
            onResize,
            openFile,
            parent,
            placeholder,
            previousLeaf,
            requestClose: () => requestClose(),
            save,
            workspace,
        };
    };

    it("flushes, restores the portal, detaches, closes, and restores focus", async () => {
        const {
            editor,
            save,
            detach,
            closeManaged,
            previousLeaf,
            setActiveLeaf,
            parent,
            placeholder,
            container,
        } = setup();

        await editor.close(true);

        expect(save).toHaveBeenCalledTimes(1);
        expect(detach).toHaveBeenCalledTimes(1);
        expect(closeManaged).toHaveBeenCalledTimes(1);
        expect(parent.children).toEqual([container]);
        expect(placeholder.parentNode).toBeNull();
        expect(setActiveLeaf).toHaveBeenCalledWith(previousLeaf, {
            focus: true,
        });
        expect(parent.insertBefore.mock.invocationCallOrder[0]).toBeLessThan(
            setActiveLeaf.mock.invocationCallOrder[0]
        );
        expect(setActiveLeaf.mock.invocationCallOrder[0]).toBeLessThan(
            detach.mock.invocationCallOrder[0]
        );
        expect(detach.mock.invocationCallOrder[0]).toBeLessThan(
            closeManaged.mock.invocationCallOrder[0]
        );
        expect(editor._sessionForTest).toBeNull();
    });

    it("logs per-step and total performance timing while closing", async () => {
        const info = jest.spyOn(console, "info").mockImplementation(() => {});
        try {
            const { editor } = setup();

            await editor.close(true);

            const closeLogs = info.mock.calls.filter(
                ([message]) =>
                    typeof message === "string" &&
                    message.includes("[event-note performance][close#")
            );
            expect(closeLogs.map(([message]) => message)).toEqual(
                expect.arrayContaining([
                    expect.stringContaining("close.view-save.started"),
                    expect.stringContaining("close.view-save.completed"),
                    expect.stringContaining("close.portal-restore.completed"),
                    expect.stringContaining("close.leaf-detach.completed"),
                    expect.stringContaining("completed"),
                ])
            );
            closeLogs.forEach(([, details]) => {
                expect(details).toEqual(
                    expect.objectContaining({
                        elapsedMs: expect.any(Number),
                        stepMs: expect.any(Number),
                        slowStep: expect.any(Boolean),
                        timestamp: expect.any(String),
                    })
                );
            });
            const completion = closeLogs.find(([message]) =>
                /\] completed$/.test(String(message))
            );
            expect(completion?.[1]).toEqual(
                expect.objectContaining({
                    mode: "registered-leaf-modal",
                    portaled: true,
                    slowestStep: expect.any(String),
                    slowestStepMs: expect.any(Number),
                    totalMs: expect.any(Number),
                    vimEnabled: false,
                })
            );
        } finally {
            info.mockRestore();
        }
    });

    it("does not explicitly flush for :q! and still cleans up", async () => {
        const { editor, save, detach, closeManaged } = setup();

        await editor.close(false);

        expect(save).not.toHaveBeenCalled();
        expect(detach).toHaveBeenCalledTimes(1);
        expect(closeManaged).toHaveBeenCalledTimes(1);
    });

    it("waits for the legacy Vim adapter after opening a registered leaf", async () => {
        jest.useFakeTimers();
        try {
            const app = {
                isVimEnabled: () => true,
            } as unknown as App;
            const editor = new EventNoteEditor(app);
            const view = {
                editMode: { editor: { cm: {} } },
            } as unknown as MarkdownView;

            const ready = (editor as any).waitForVimAdapter(view);
            (view as any).editMode.editor.cm.cm = {
                on: jest.fn(),
                off: jest.fn(),
            };
            jest.advanceTimersByTime(16);

            await ready;
        } finally {
            jest.useRealTimers();
        }
    });

    it("opens through a registered leaf before portaling it into the modal", async () => {
        const {
            editor,
            file,
            host,
            leaf,
            modal,
            openFile,
            parent,
            placeholder,
            workspace,
        } = setupOpen();

        await editor.open(file);

        expect(modal.open).toHaveBeenCalledTimes(1);
        expect(workspace.getLeaf).toHaveBeenCalledWith("tab");
        expect(workspace.setActiveLeaf).toHaveBeenCalledWith(leaf, {
            focus: true,
        });
        expect(openFile).toHaveBeenCalledTimes(1);
        expect(modal.mountLeaf).toHaveBeenCalledTimes(1);
        expect(parent.children).toEqual([placeholder]);
        expect(host.children).toHaveLength(1);
        expect(editor._sessionForTest).toEqual(
            expect.objectContaining({
                leaf,
                mode: "registered-leaf-modal",
                portal: expect.any(Object),
            })
        );

        await editor.close(false);
    });

    it("keeps the already-open leaf as a tab when portaling fails", async () => {
        const error = jest.spyOn(console, "error").mockImplementation(() => {});
        const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
        try {
            const {
                container,
                detach,
                editor,
                file,
                leaf,
                modal,
                openFile,
                parent,
            } = setupOpen({ mountError: new Error("portal failed") });

            await editor.open(file);

            expect(openFile).toHaveBeenCalledTimes(1);
            expect(detach).not.toHaveBeenCalled();
            expect(modal.closeManaged).toHaveBeenCalledTimes(1);
            expect(parent.children).toEqual([container]);
            expect(editor._sessionForTest).toEqual(
                expect.objectContaining({
                    leaf,
                    mode: "standard-tab-fallback",
                    portal: null,
                })
            );

            await editor.close(false);
        } finally {
            error.mockRestore();
            warn.mockRestore();
        }
    });

    it("cancels and detaches a registered leaf while openFile is pending", async () => {
        let finishOpen: () => void = () => undefined;
        const openFilePromise = new Promise<void>((resolve) => {
            finishOpen = resolve;
        });
        const { detach, editor, file, modal, openFile, requestClose } =
            setupOpen({ openFile: () => openFilePromise });

        const opening = editor.open(file);
        await Promise.resolve();
        await Promise.resolve();
        expect(openFile).toHaveBeenCalledTimes(1);

        requestClose();
        await Promise.resolve();
        expect(modal.closeManaged).toHaveBeenCalledTimes(1);
        expect(detach).toHaveBeenCalledTimes(1);

        finishOpen();
        await opening;
        expect(editor._sessionForTest).toBeNull();
        expect(editor._openingForTest).toBeNull();
        expect(detach).toHaveBeenCalledTimes(1);
    });

    it("keeps the newer session when a superseded open finishes late", async () => {
        let finishFirstOpen: () => void = () => undefined;
        const firstOpenFile = new Promise<void>((resolve) => {
            finishFirstOpen = resolve;
        });
        const {
            detach: firstDetach,
            editor,
            file: firstFile,
            host: secondHost,
            openFile,
            workspace,
        } = setupOpen({ openFile: () => firstOpenFile });
        const firstOpening = editor.open(firstFile);
        await Promise.resolve();
        await Promise.resolve();
        expect(openFile).toHaveBeenCalledTimes(1);

        const secondFile = {
            path: "Events/2026-08-23 - Second.md",
            stat: { size: 64, mtime: Date.now() },
        } as TFile;
        const secondParent = new FakeNode();
        const secondContainer = new FakeNode();
        secondParent.appendChild(secondContainer);
        const secondView = new MarkdownView({} as WorkspaceLeaf);
        Object.assign(secondView, {
            editor: { focus: jest.fn() },
            file: secondFile,
            save: jest.fn(async () => undefined),
        });
        const secondLeaf = {
            containerEl: secondContainer,
            detach: jest.fn(),
            getViewState: () => ({ type: "markdown" }),
            onResize: jest.fn(),
            openFile: jest.fn(async () => undefined),
            view: secondView,
        } as unknown as WorkspaceLeaf;
        const secondModal: EventNoteModalController = {
            open: jest.fn(),
            closeManaged: jest.fn(),
            mountLeaf: jest.fn((element: HTMLElement) => {
                secondHost.appendChild(element as unknown as FakeNode);
            }),
        };
        workspace.getLeaf.mockReturnValue(secondLeaf);
        (editor as any).createModal = () => secondModal;

        await editor.open(secondFile);
        finishFirstOpen();
        await firstOpening;

        expect(firstDetach).toHaveBeenCalledTimes(1);
        expect(secondLeaf.openFile).toHaveBeenCalledWith(secondFile);
        expect(editor._sessionForTest).toEqual(
            expect.objectContaining({ leaf: secondLeaf })
        );

        await editor.close(false);
    });

    it("restores the prior leaf when normal file opening fails", async () => {
        const error = jest.spyOn(console, "error").mockImplementation(() => {});
        try {
            const {
                detach,
                editor,
                file,
                leaf,
                modal,
                previousLeaf,
                workspace,
            } = setupOpen({
                openFile: async () => {
                    throw new Error("open failed");
                },
            });

            await expect(editor.open(file)).rejects.toThrow("open failed");

            expect(modal.closeManaged).toHaveBeenCalledTimes(1);
            expect(detach).toHaveBeenCalledTimes(1);
            expect(workspace.setActiveLeaf).toHaveBeenCalledWith(leaf, {
                focus: true,
            });
            expect(workspace.setActiveLeaf).toHaveBeenLastCalledWith(
                previousLeaf,
                { focus: true }
            );
            expect(editor._sessionForTest).toBeNull();
        } finally {
            error.mockRestore();
        }
    });
});
