import type { MarkdownView } from "obsidian";
import type { App, WorkspaceLeaf } from "obsidian";
import EventNoteEditor, { EventNoteVimCommands } from "./EventNoteEditor";

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
        const remove = jest.fn();
        const previousLeaf = {} as WorkspaceLeaf;
        (editor as any).session = {
            leaf: { detach },
            view: { save },
            previousLeaf,
            overlayEl: { remove },
            editorContainerEl: null,
        };
        return {
            editor,
            save,
            detach,
            remove,
            previousLeaf,
            setActiveLeaf,
        };
    };

    it("flushes, detaches, removes the overlay, and restores focus", async () => {
        const { editor, save, detach, remove, previousLeaf, setActiveLeaf } =
            setup();

        await editor.close(true);

        expect(save).toHaveBeenCalledTimes(1);
        expect(detach).toHaveBeenCalledTimes(1);
        expect(remove).toHaveBeenCalledTimes(1);
        expect(setActiveLeaf).toHaveBeenCalledWith(previousLeaf, {
            focus: true,
        });
        expect(setActiveLeaf.mock.invocationCallOrder[0]).toBeLessThan(
            detach.mock.invocationCallOrder[0]
        );
        expect(editor._sessionForTest).toBeNull();
    });

    it("does not explicitly flush for :q! and still cleans up", async () => {
        const { editor, save, detach, remove } = setup();

        await editor.close(false);

        expect(save).not.toHaveBeenCalled();
        expect(detach).toHaveBeenCalledTimes(1);
        expect(remove).toHaveBeenCalledTimes(1);
    });

    it("waits for the legacy Vim adapter before exposing an embedded leaf", async () => {
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
});
