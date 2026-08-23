import type { App, TFile, WorkspaceLeaf } from "obsidian";
import EventNoteEditor from "./EventNoteEditor";

describe("event-note navigation", () => {
    const file = { path: "Events/2026-08-22 - Test.md" } as TFile;

    const setup = () => {
        const activeLeaf = {
            getViewState: () => ({ type: "full-calendar-view" }),
            openFile: jest.fn(async () => undefined),
        } as unknown as WorkspaceLeaf;
        const fallbackLeaf = {
            getViewState: () => ({ type: "empty" }),
            openFile: jest.fn(async () => undefined),
        } as unknown as WorkspaceLeaf;
        const workspace = {
            activeLeaf,
            getLeaf: jest.fn(() => fallbackLeaf),
        };
        const editor = new EventNoteEditor({ workspace } as unknown as App);
        return { activeLeaf, editor, fallbackLeaf, workspace };
    };

    it("opens in an explicitly supplied originating leaf", async () => {
        const { editor, workspace } = setup();
        const originatingLeaf = {
            getViewState: () => ({ type: "full-calendar-view" }),
            openFile: jest.fn(async () => undefined),
        } as unknown as WorkspaceLeaf;

        await editor.open(file, originatingLeaf);

        expect(originatingLeaf.openFile).toHaveBeenCalledWith(file);
        expect(workspace.getLeaf).not.toHaveBeenCalled();
    });

    it("uses the active leaf when no origin is supplied", async () => {
        const { activeLeaf, editor, workspace } = setup();

        await editor.open(file);

        expect(activeLeaf.openFile).toHaveBeenCalledWith(file);
        expect(workspace.getLeaf).not.toHaveBeenCalled();
    });

    it("uses a normal navigable leaf when there is no active leaf", async () => {
        const { editor, fallbackLeaf, workspace } = setup();
        workspace.activeLeaf = null as unknown as WorkspaceLeaf;

        await editor.open(file);

        expect(workspace.getLeaf).toHaveBeenCalledWith(false);
        expect(fallbackLeaf.openFile).toHaveBeenCalledWith(file);
    });

    it("propagates normal file-open failures", async () => {
        const { activeLeaf, editor } = setup();
        (activeLeaf.openFile as jest.Mock).mockRejectedValueOnce(
            new Error("open failed")
        );

        await expect(editor.open(file)).rejects.toThrow("open failed");
    });
});
