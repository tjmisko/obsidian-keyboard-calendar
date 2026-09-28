import { App, Modal } from "obsidian";
import {
    EventDraft,
    ResolvedEventDraft,
    resolveEventDraft,
} from "./event_draft";

export interface EventCreationModalOptions {
    draft: EventDraft;
    /** Persist the event; resolve false to keep the dialog open. */
    create: (
        resolved: Extract<ResolvedEventDraft, { ok: true }>
    ) => Promise<boolean>;
    onClose?: () => void;
}

/**
 * Touch replacement for desktop's select-to-create-a-note: a long press on the
 * time grid proposes an event, and nothing is written until the reader
 * confirms it here. Native date and time inputs bring up the platform pickers.
 */
export class EventCreationModal extends Modal {
    private submitting = false;

    constructor(app: App, private readonly options: EventCreationModalOptions) {
        super(app);
    }

    onOpen(): void {
        const { draft } = this.options;
        this.modalEl.addClass("ofc-event-create-modal");
        this.titleEl.setText("New event");
        this.contentEl.empty();

        const form = this.contentEl.createEl("form", {
            cls: "ofc-event-create-form",
        });
        form.setAttribute("novalidate", "");

        const titleInput = form.createEl("input", {
            cls: "ofc-event-create-title",
            type: "text",
            placeholder: "Event title",
        });
        titleInput.value = draft.title;
        titleInput.setAttribute("aria-label", "Event title");
        titleInput.setAttribute("enterkeyhint", "done");
        titleInput.setAttribute("autocapitalize", "sentences");

        const when = form.createDiv({ cls: "ofc-event-create-when" });
        const dateInput = when.createEl("input", {
            cls: "ofc-event-create-date",
            type: "date",
        });
        dateInput.value = draft.date;
        dateInput.setAttribute("aria-label", "Date");

        const times = when.createDiv({ cls: "ofc-event-create-times" });
        const startInput = times.createEl("input", {
            cls: "ofc-event-create-time",
            type: "time",
        });
        startInput.value = draft.startTime;
        startInput.step = "300";
        startInput.setAttribute("aria-label", "Start time");
        times.createSpan({
            cls: "ofc-event-create-time-separator",
            text: "–",
        });
        const endInput = times.createEl("input", {
            cls: "ofc-event-create-time",
            type: "time",
        });
        endInput.value = draft.endTime;
        endInput.step = "300";
        endInput.setAttribute("aria-label", "End time");

        const error = form.createDiv({ cls: "ofc-event-create-error" });
        error.setAttribute("role", "alert");

        const actions = form.createDiv({ cls: "ofc-event-create-actions" });
        const cancelButton = actions.createEl("button", {
            text: "Cancel",
            type: "button",
        });
        cancelButton.addEventListener("click", () => this.close());
        const createButton = actions.createEl("button", {
            cls: "mod-cta",
            text: "Create",
            type: "submit",
        });

        form.addEventListener("submit", (event) => {
            event.preventDefault();
            if (this.submitting) {
                return;
            }
            const resolved = resolveEventDraft({
                title: titleInput.value,
                date: dateInput.value,
                startTime: startInput.value,
                endTime: endInput.value,
            });
            if (!resolved.ok) {
                error.setText(resolved.error);
                return;
            }
            error.setText("");
            this.submitting = true;
            createButton.disabled = true;
            cancelButton.disabled = true;
            void this.options
                .create(resolved)
                .catch(() => false)
                .then((created) => {
                    if (created) {
                        this.close();
                        return;
                    }
                    this.submitting = false;
                    createButton.disabled = false;
                    cancelButton.disabled = false;
                });
        });

        titleInput.focus();
    }

    onClose(): void {
        this.contentEl.empty();
        this.options.onClose?.();
    }
}
