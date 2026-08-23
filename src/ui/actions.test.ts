import { TFile } from "obsidian";
import type { Vault, Workspace, WorkspaceLeaf } from "obsidian";
import EventCache from "../core/EventCache";
import { openFullNoteForEvent } from "./actions";

describe("modifier-click full-note routing", () => {
    it("rejects events outside the local full-note boundary before vault access", async () => {
        const cache = {
            getInfoForFullNoteEvent: jest.fn(() => null),
        } as unknown as EventCache;
        const vault = { getAbstractFileByPath: jest.fn() } as unknown as Vault;
        const workspace = {
            getMostRecentLeaf: jest.fn(),
        } as unknown as Workspace;

        await expect(
            openFullNoteForEvent(cache, { workspace, vault }, "not-local")
        ).resolves.toBe(false);
        expect(vault.getAbstractFileByPath).not.toHaveBeenCalled();
        expect(workspace.getMostRecentLeaf).not.toHaveBeenCalled();
    });

    it("opens an admitted full note through the existing modifier-click leaf path", async () => {
        const file = new TFile();
        file.name = "Event.md";
        const cache = {
            getInfoForFullNoteEvent: jest.fn(() => ({
                location: { path: file.path },
            })),
        } as unknown as EventCache;
        const leaf = {
            getViewState: () => ({ pinned: false }),
            openFile: jest.fn(async () => undefined),
        } as unknown as WorkspaceLeaf;
        const workspace = {
            getMostRecentLeaf: jest.fn(() => leaf),
            getLeaf: jest.fn(),
        } as unknown as Workspace;
        const vault = {
            getAbstractFileByPath: jest.fn(() => file),
        } as unknown as Vault;

        await expect(
            openFullNoteForEvent(cache, { workspace, vault }, "local-event")
        ).resolves.toBe(true);
        expect(vault.getAbstractFileByPath).toHaveBeenCalledWith(file.path);
        expect(leaf.openFile).toHaveBeenCalledWith(file);
    });
});
