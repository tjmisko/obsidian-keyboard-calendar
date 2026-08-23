import type FullCalendarPlugin from "../main";
import { App, Modal, Notice, PluginSettingTab, Setting } from "obsidian";
import {
    DEFAULT_EVENT_COLOR,
    getConfiguredLocalSource,
    listEventFolders,
    LocalCalendarSource,
    preferredEventFolder,
    removeLocalSource,
    saveLocalSourceSelection,
} from "./source_settings";

export { DEFAULT_SETTINGS } from "../settings/migration";
export type { FullCalendarSettings } from "../settings/migration";

const WEEKDAYS = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
];

const INITIAL_VIEW_OPTIONS = {
    timeGridDay: "Day",
    timeGridWeek: "Week",
    dayGridMonth: "Month",
    listWeek: "List",
};

type SubmitLocalSource = (directory: string, color: string) => Promise<boolean>;

/** Native folder/color editor for the single writable local calendar. */
export class LocalCalendarSourceModal extends Modal {
    private readonly current: LocalCalendarSource | null;
    private readonly submit: SubmitLocalSource;

    constructor(
        app: App,
        current: LocalCalendarSource | null,
        submit: SubmitLocalSource
    ) {
        super(app);
        this.current = current;
        this.submit = submit;
    }

    onOpen(): void {
        this.contentEl.empty();
        this.titleEl.setText(
            this.current ? "Edit event folder" : "Choose event folder"
        );

        const folders = listEventFolders(this.app.vault);
        let directory = preferredEventFolder(
            this.app.vault,
            this.current?.directory
        );
        let color = /^#[0-9a-fA-F]{6}$/.test(this.current?.color || "")
            ? this.current?.color || DEFAULT_EVENT_COLOR
            : DEFAULT_EVENT_COLOR;

        if (!directory) {
            this.contentEl.createEl("p", {
                text: "Create an events folder in the vault, then reopen this dialog.",
            });
            return;
        }

        new Setting(this.contentEl)
            .setName("Folder")
            .setDesc("This folder stores the calendar's event notes.")
            .addDropdown((dropdown) => {
                folders.forEach((folder) => dropdown.addOption(folder, folder));
                dropdown.setValue(directory || "");
                dropdown.onChange((value) => {
                    directory = value;
                });
            });

        new Setting(this.contentEl)
            .setName("Color")
            .setDesc("Color used for events from this folder.")
            .addColorPicker((picker) => {
                picker.setValue(color);
                picker.onChange((value) => {
                    color = value;
                });
            });

        new Setting(this.contentEl).addButton((button) => {
            button
                .setButtonText(this.current ? "Save" : "Add calendar")
                .setCta()
                .onClick(async () => {
                    if (!directory) {
                        return;
                    }
                    button.setDisabled(true);
                    const saved = await this.submit(directory, color);
                    if (saved) {
                        this.close();
                    } else {
                        button.setDisabled(false);
                    }
                });
        });
    }

    onClose(): void {
        this.contentEl.empty();
    }
}

export function openLocalCalendarSourceModal(
    app: App,
    plugin: FullCalendarPlugin,
    current: LocalCalendarSource | null,
    onSaved: () => void = () => undefined
): void {
    new LocalCalendarSourceModal(app, current, async (directory, color) => {
        try {
            const source = await saveLocalSourceSelection(
                plugin,
                app.vault,
                directory,
                color
            );
            if (!source) {
                new Notice("Choose an existing vault folder and valid color.");
                return false;
            }
            onSaved();
            return true;
        } catch (error) {
            console.error(error);
            new Notice("Could not save calendar settings.");
            return false;
        }
    }).open();
}

export class FullCalendarSettingTab extends PluginSettingTab {
    plugin: FullCalendarPlugin;

    constructor(app: App, plugin: FullCalendarPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    private async commitSettings(
        settings: FullCalendarPlugin["settings"]
    ): Promise<void> {
        try {
            await this.plugin.updateSettings(settings);
        } catch (error) {
            console.error(error);
            new Notice("Could not save calendar settings.");
            await this.display();
        }
    }

    async display(): Promise<void> {
        const { containerEl } = this;
        containerEl.empty();

        containerEl.createEl("h2", { text: "Calendar Preferences" });
        new Setting(containerEl)
            .setName("Desktop Initial View")
            .setDesc("Choose the initial view range on desktop devices.")
            .addDropdown((dropdown) => {
                Object.entries(INITIAL_VIEW_OPTIONS).forEach(
                    ([value, display]) => dropdown.addOption(value, display)
                );
                dropdown.setValue(this.plugin.settings.initialView);
                dropdown.onChange(async (initialView) => {
                    await this.commitSettings({
                        ...this.plugin.settings,
                        initialView,
                    });
                });
            });

        new Setting(containerEl)
            .setName("Starting Day of the Week")
            .setDesc("Choose what day of the week to start.")
            .addDropdown((dropdown) => {
                WEEKDAYS.forEach((day, code) =>
                    dropdown.addOption(code.toString(), day)
                );
                dropdown.setValue(this.plugin.settings.firstDay.toString());
                dropdown.onChange(async (codeAsString) => {
                    await this.commitSettings({
                        ...this.plugin.settings,
                        firstDay: Number(codeAsString),
                    });
                });
            });

        new Setting(containerEl)
            .setName("24-hour format")
            .setDesc("Display the time in a 24-hour format.")
            .addToggle((toggle) => {
                toggle.setValue(this.plugin.settings.timeFormat24h);
                toggle.onChange(async (value) => {
                    await this.commitSettings({
                        ...this.plugin.settings,
                        timeFormat24h: value,
                    });
                });
            });

        containerEl.createEl("h2", { text: "Event Folder" });
        const source = getConfiguredLocalSource(this.plugin.settings);
        if (!source) {
            new Setting(containerEl)
                .setName("No event folder configured")
                .setDesc("Choose one vault folder for event notes.")
                .addButton((button) =>
                    button
                        .setButtonText("Choose folder")
                        .onClick(() =>
                            openLocalCalendarSourceModal(
                                this.app,
                                this.plugin,
                                null,
                                () => void this.display()
                            )
                        )
                );
            return;
        }

        new Setting(containerEl)
            .setName(source.directory || "Vault root (legacy)")
            .setDesc(
                "The single writable folder for event notes. Removing it changes settings only; notes are not deleted."
            )
            .addButton((button) =>
                button
                    .setButtonText("Edit")
                    .onClick(() =>
                        openLocalCalendarSourceModal(
                            this.app,
                            this.plugin,
                            source,
                            () => void this.display()
                        )
                    )
            )
            .addExtraButton((button) => {
                button.setIcon("trash").setTooltip("Remove event folder");
                button.onClick(async () => {
                    try {
                        await removeLocalSource(this.plugin);
                        await this.display();
                    } catch (error) {
                        console.error(error);
                        new Notice(
                            "Could not remove the event folder setting."
                        );
                    }
                });
            });
    }
}
