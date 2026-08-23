import type { App, TFile, WorkspaceLeaf } from "obsidian";
import {
    DailyNoteNavigationApi,
    openDailyNoteForDate,
    resolveDailyNotePath,
} from "./daily_note_navigation";

const date = new Date(2026, 7, 22, 12, 0, 0);

const makeApi = (
    overrides: Partial<DailyNoteNavigationApi> = {}
): DailyNoteNavigationApi => ({
    find: jest.fn(() => null),
    create: jest.fn(async () => null),
    settings: jest.fn(() => ({
        folder: "Daily",
        format: "YYYY-MM-DD",
    })),
    normalize: jest.fn((path) => path.replace(/\/+/g, "/")),
    ...overrides,
});

describe("daily-note date-header navigation", () => {
    it("uses the existing daily note path for the selected date", () => {
        const file = { path: "Daily/2026-08-22.md" } as TFile;
        const api = makeApi({ find: jest.fn(() => file) });

        expect(resolveDailyNotePath(date, api)).toBe(file.path);
        expect(
            (api.find as jest.Mock).mock.calls[0][0].format("YYYY-MM-DD")
        ).toBe("2026-08-22");
        expect(api.settings).not.toHaveBeenCalled();
    });

    it("resolves the configured path when the note does not exist", () => {
        const api = makeApi();

        expect(resolveDailyNotePath(date, api)).toBe("Daily/2026-08-22");
        expect(api.normalize).toHaveBeenCalledWith("Daily/2026-08-22");
    });

    it("opens an existing note in the most-recent unpinned leaf", async () => {
        const file = { path: "Daily/2026-08-22.md" } as TFile;
        const leaf = {
            getViewState: () => ({ pinned: false }),
            openFile: jest.fn(async () => undefined),
        } as unknown as WorkspaceLeaf;
        const workspace = {
            getMostRecentLeaf: jest.fn(() => leaf),
            getLeaf: jest.fn(),
        };
        const api = makeApi({ find: jest.fn(() => file) });

        await openDailyNoteForDate(
            { workspace } as unknown as Pick<App, "workspace">,
            date,
            api
        );

        expect(leaf.openFile).toHaveBeenCalledWith(file);
        expect(api.create).not.toHaveBeenCalled();
        expect(workspace.getLeaf).not.toHaveBeenCalled();
    });

    it("creates the missing note and uses a new tab when the recent leaf is pinned", async () => {
        const file = { path: "Daily/2026-08-22.md" } as TFile;
        const pinned = {
            getViewState: () => ({ pinned: true }),
            openFile: jest.fn(),
        } as unknown as WorkspaceLeaf;
        const fallback = {
            getViewState: () => ({ pinned: false }),
            openFile: jest.fn(async () => undefined),
        } as unknown as WorkspaceLeaf;
        const workspace = {
            getMostRecentLeaf: jest.fn(() => pinned),
            getLeaf: jest.fn(() => fallback),
        };
        const api = makeApi({ create: jest.fn(async () => file) });

        await openDailyNoteForDate(
            { workspace } as unknown as Pick<App, "workspace">,
            date,
            api
        );

        expect(
            (api.create as jest.Mock).mock.calls[0][0].format("YYYY-MM-DD")
        ).toBe("2026-08-22");
        expect(workspace.getLeaf).toHaveBeenCalledWith("tab");
        expect(fallback.openFile).toHaveBeenCalledWith(file);
    });
});
