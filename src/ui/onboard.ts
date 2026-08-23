import { App, Notice, Setting } from "obsidian";
import type FullCalendarPlugin from "../main";
import { LocalCalendarSourceModal } from "./settings";
import {
    LocalCalendarSource,
    saveLocalSourceSelection,
} from "./source_settings";

export async function completeOnboarding(
    app: App,
    plugin: FullCalendarPlugin,
    directory: string,
    color: string
): Promise<LocalCalendarSource | null> {
    const source = await saveLocalSourceSelection(
        plugin,
        app.vault,
        directory,
        color
    );
    if (source) {
        try {
            await plugin.activateView();
        } catch (error) {
            console.error(error);
            new Notice(
                "The event folder was saved, but the calendar could not open."
            );
        }
    }
    return source;
}

export function renderOnboarding(
    app: App,
    plugin: FullCalendarPlugin,
    el: HTMLElement
): void {
    el.style.height = "100%";
    const noCalendar = el.createDiv();
    noCalendar.style.height = "100%";
    noCalendar.style.display = "flex";
    noCalendar.style.alignItems = "center";
    noCalendar.style.justifyContent = "center";
    const notice = noCalendar.createDiv();
    notice.createEl("h1").textContent = "No calendar available";
    notice.createEl("p").textContent =
        "Choose one vault folder for full-note calendar events.";

    new Setting(notice).addButton((button) => {
        button.setButtonText("Choose event folder").setCta();
        button.onClick(() => {
            new LocalCalendarSourceModal(
                app,
                null,
                async (directory, color) => {
                    try {
                        const source = await completeOnboarding(
                            app,
                            plugin,
                            directory,
                            color
                        );
                        if (!source) {
                            new Notice(
                                "Choose an existing vault folder and valid color."
                            );
                            return false;
                        }
                        return true;
                    } catch (error) {
                        console.error(error);
                        new Notice("Could not save calendar settings.");
                        return false;
                    }
                }
            ).open();
        });
    });
}
