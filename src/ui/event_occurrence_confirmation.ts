import { App, ButtonComponent, Modal, Setting } from "obsidian";

export type EventOccurrenceAction = "omit" | "attend";

export interface EventOccurrenceConfirmationOptions {
    action: EventOccurrenceAction;
    title: string;
    date: string;
    confirm: () => Promise<boolean>;
    onClose?: () => void;
}

const actionLabel = (action: EventOccurrenceAction): string =>
    action === "omit" ? "Omit occurrence" : "Attend occurrence";

/** Keyboard-first confirmation for changing one rendered occurrence. */
export class EventOccurrenceConfirmationModal extends Modal {
    constructor(
        app: App,
        private readonly options: EventOccurrenceConfirmationOptions
    ) {
        super(app);
    }

    onOpen(): void {
        const label = actionLabel(this.options.action);
        this.titleEl.setText(`${label}?`);
        this.contentEl.empty();
        this.contentEl.createEl("p", {
            text: `${label} for “${this.options.title}” on ${this.options.date}?`,
        });

        let confirmButton: ButtonComponent | null = null;
        let cancelButton: ButtonComponent | null = null;
        new Setting(this.contentEl)
            .addButton((button) => {
                confirmButton = button
                    .setButtonText(label)
                    .setCta()
                    .onClick(async () => {
                        confirmButton?.setDisabled(true);
                        cancelButton?.setDisabled(true);
                        if (await this.options.confirm()) {
                            this.close();
                            return;
                        }
                        confirmButton?.setDisabled(false);
                        cancelButton?.setDisabled(false);
                        confirmButton?.buttonEl.focus();
                    });
                // Enter confirms immediately; one Tab moves focus to Cancel.
                confirmButton.buttonEl.focus();
            })
            .addButton((button) => {
                cancelButton = button
                    .setButtonText("Cancel")
                    .onClick(() => this.close());
            });
    }

    onClose(): void {
        this.contentEl.empty();
        this.options.onClose?.();
    }
}
