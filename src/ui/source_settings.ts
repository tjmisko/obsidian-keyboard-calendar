import { TFolder, Vault } from "obsidian";
import { CalendarInfo } from "../types";
import type { FullCalendarSettings } from "../settings/migration";

export type LocalCalendarSource = Extract<CalendarInfo, { type: "local" }>;

export const TARGET_EVENT_DIRECTORY = "events";
export const DEFAULT_EVENT_COLOR = "#3788d8";

export interface SettingsWriter {
    settings: FullCalendarSettings;
    updateSettings(settings: FullCalendarSettings): Promise<void>;
}

export function listEventFolders(vault: Vault): string[] {
    return vault
        .getAllLoadedFiles()
        .filter(
            (file): file is TFolder =>
                file instanceof TFolder &&
                !file.isRoot() &&
                file.path.length > 0
        )
        .map((folder) => folder.path)
        .sort((left, right) => left.localeCompare(right));
}

export function getConfiguredLocalSource(
    settings: FullCalendarSettings
): LocalCalendarSource | null {
    const source = settings.calendarSources[0];
    return source?.type === "local" ? source : null;
}

export function preferredEventFolder(
    vault: Vault,
    currentDirectory?: string
): string | null {
    const folders = listEventFolders(vault);
    if (currentDirectory && folders.includes(currentDirectory)) {
        return currentDirectory;
    }
    return folders.includes(TARGET_EVENT_DIRECTORY)
        ? TARGET_EVENT_DIRECTORY
        : folders[0] || null;
}

export function validateLocalSourceSelection(
    vault: Vault,
    directory: string,
    color: string
): LocalCalendarSource | null {
    const folder = vault.getAbstractFileByPath(directory);
    if (
        !(folder instanceof TFolder) ||
        folder.isRoot() ||
        folder.path !== directory ||
        !/^#[0-9a-fA-F]{6}$/.test(color)
    ) {
        return null;
    }
    return {
        type: "local",
        directory: folder.path,
        color: color.toLowerCase(),
    };
}

export async function saveLocalSourceSelection(
    writer: SettingsWriter,
    vault: Vault,
    directory: string,
    color: string
): Promise<LocalCalendarSource | null> {
    const source = validateLocalSourceSelection(vault, directory, color);
    if (!source) {
        return null;
    }
    await writer.updateSettings({
        ...writer.settings,
        calendarSources: [source],
    });
    return source;
}

export async function removeLocalSource(writer: SettingsWriter): Promise<void> {
    await writer.updateSettings({
        ...writer.settings,
        calendarSources: [],
    });
}
