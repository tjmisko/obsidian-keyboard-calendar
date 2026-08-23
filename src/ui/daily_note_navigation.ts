import moment, { Moment } from "moment";
import { App, normalizePath, TFile } from "obsidian";
import {
    createDailyNote,
    DEFAULT_DAILY_NOTE_FORMAT,
    getAllDailyNotes,
    getDailyNote,
    getDailyNoteSettings,
} from "obsidian-daily-notes-interface";

export interface DailyNoteNavigationApi {
    find(day: Moment): TFile | null;
    create(day: Moment): Promise<TFile | null>;
    settings(): { folder?: string; format?: string };
    normalize(path: string): string;
}

const productionDailyNoteApi: DailyNoteNavigationApi = {
    find: (day) =>
        getDailyNote(day, getAllDailyNotes()) as unknown as TFile | null,
    create: async (day) =>
        (await createDailyNote(day)) as unknown as TFile | null,
    settings: () => getDailyNoteSettings(),
    normalize: normalizePath,
};

export function resolveDailyNotePath(
    date: Date,
    api: DailyNoteNavigationApi = productionDailyNoteApi
): string {
    const day = moment(date);
    try {
        const existingNote = api.find(day);
        if (existingNote) {
            return existingNote.path;
        }
    } catch (error) {
        console.debug("Could not resolve an existing daily note.", error);
    }

    const settings = api.settings();
    const folder = settings?.folder?.trim() || "";
    const format = settings?.format || DEFAULT_DAILY_NOTE_FORMAT;
    return api.normalize(
        [folder, day.format(format)].filter(Boolean).join("/")
    );
}

export async function openDailyNoteForDate(
    app: Pick<App, "workspace">,
    date: Date,
    api: DailyNoteNavigationApi = productionDailyNoteApi
): Promise<void> {
    const day = moment(date);
    let file: TFile | null = null;
    try {
        file = api.find(day);
    } catch (error) {
        console.debug("Could not resolve an existing daily note.", error);
    }
    file = file || (await api.create(day));
    if (!file) {
        throw new Error("Could not create the daily note.");
    }

    let leaf = app.workspace.getMostRecentLeaf();
    if (!leaf || leaf.getViewState().pinned) {
        leaf = app.workspace.getLeaf("tab");
    }
    await leaf.openFile(file);
}
