import { App, ButtonComponent, Modal, Setting } from "obsidian";

export interface EventDeleteConfirmationOptions {
    title: string;
    recurring: boolean;
    confirm: () => Promise<boolean>;
    onClose?: () => void;
}

/** Native confirmation dialog for deleting an event's backing note. */
export class EventDeleteConfirmationModal extends Modal {
    constructor(
        app: App,
        private readonly options: EventDeleteConfirmationOptions
    ) {
        super(app);
    }

    onOpen(): void {
        this.titleEl.setText("Delete event?");
        this.contentEl.empty();
        this.contentEl.createEl("p", {
            text: this.options.recurring
                ? `“${this.options.title}” is recurring. This will delete the backing note and the entire series.`
                : `This will delete the backing note for “${this.options.title}”.`,
        });
        this.contentEl.createEl("p", {
            text: "The note will be moved to trash.",
        });

        let cancelButton: ButtonComponent | null = null;
        let deleteButton: ButtonComponent | null = null;
        new Setting(this.contentEl)
            .addButton((button) => {
                cancelButton = button
                    .setButtonText("Cancel")
                    .onClick(() => this.close());
                cancelButton.buttonEl.focus();
            })
            .addButton((button) => {
                deleteButton = button
                    .setButtonText("Move to trash")
                    .setWarning()
                    .onClick(async () => {
                        cancelButton?.setDisabled(true);
                        deleteButton?.setDisabled(true);
                        if (await this.options.confirm()) {
                            this.close();
                            return;
                        }
                        cancelButton?.setDisabled(false);
                        deleteButton?.setDisabled(false);
                    });
            });
    }

    onClose(): void {
        this.contentEl.empty();
        this.options.onClose?.();
    }
}
