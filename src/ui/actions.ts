import { TFile, Vault, Workspace } from "obsidian";
import EventCache from "src/core/EventCache";

/**
 * Open a file in the editor to a given event.
 * @param cache
 * @param param1 App
 * @param id event ID
 * @returns
 */
export async function openFullNoteForEvent(
    cache: EventCache,
    { workspace, vault }: { workspace: Workspace; vault: Vault },
    id: string
): Promise<boolean> {
    const details = cache.getInfoForFullNoteEvent(id);
    if (!details) {
        return false;
    }
    const { path } = details.location;
    let leaf = workspace.getMostRecentLeaf(workspace.rootSplit);
    const file = vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
        return false;
    }
    if (!leaf) {
        return false;
    }
    if (leaf.getViewState().pinned) {
        leaf = workspace.getLeaf("tab");
    }
    await leaf.openFile(file);
    return true;
}
