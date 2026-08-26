import { App, Modal, Notice, Setting } from "obsidian";

export interface DiagnosticReportSource {
    getReport(): string;
    clear(): void;
}

const selectReportText = (textarea: HTMLTextAreaElement): void => {
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
};

export const copyDiagnosticReport = async (
    report: string,
    textarea: HTMLTextAreaElement
): Promise<boolean> => {
    try {
        if (
            typeof navigator !== "undefined" &&
            navigator.clipboard?.writeText
        ) {
            await navigator.clipboard.writeText(report);
            return true;
        }
    } catch (_error) {
        // Fall through to the WebView-compatible selection/copy path.
    }

    selectReportText(textarea);
    try {
        return (
            typeof document !== "undefined" &&
            typeof document.execCommand === "function" &&
            document.execCommand("copy")
        );
    } catch (_error) {
        return false;
    }
};

/** A mobile-safe, selectable report that does not depend on the calendar UI. */
export class DiagnosticReportModal extends Modal {
    private reportEl: HTMLTextAreaElement | null = null;

    constructor(app: App, private readonly source: DiagnosticReportSource) {
        super(app);
    }

    onOpen(): void {
        this.contentEl.empty();
        this.contentEl.createEl("h2", {
            text: "Keyboard Calendar diagnostics",
        });
        this.contentEl.createEl("p", {
            text: "The report contains runtime, device, layout, and error details. It intentionally omits note contents, titles, and configured folder paths; review it before sharing because error messages can contain additional context.",
        });

        const textarea = this.contentEl.createEl("textarea", {
            cls: "keyboard-calendar-diagnostic-report",
        });
        textarea.readOnly = true;
        textarea.setAttribute(
            "aria-label",
            "Keyboard Calendar diagnostic report"
        );
        textarea.style.boxSizing = "border-box";
        textarea.style.width = "100%";
        textarea.style.height = "50vh";
        textarea.style.minHeight = "16rem";
        textarea.style.fontFamily = "var(--font-monospace)";
        textarea.style.fontSize = "var(--font-ui-smaller)";
        textarea.style.whiteSpace = "pre";
        this.reportEl = textarea;
        this.refreshReport();

        new Setting(this.contentEl)
            .addButton((button) =>
                button
                    .setButtonText("Copy report")
                    .setCta()
                    .onClick(async () => {
                        const report = this.reportEl?.value || "";
                        const copied =
                            !!this.reportEl &&
                            (await copyDiagnosticReport(report, this.reportEl));
                        new Notice(
                            copied
                                ? "Keyboard Calendar diagnostic report copied."
                                : "Could not copy automatically. The report text is selected; use the system Copy action."
                        );
                    })
            )
            .addButton((button) =>
                button
                    .setButtonText("Clear saved log")
                    .setWarning()
                    .onClick(() => {
                        this.source.clear();
                        this.refreshReport();
                        new Notice("Keyboard Calendar diagnostic log cleared.");
                    })
            )
            .addButton((button) =>
                button.setButtonText("Close").onClick(() => this.close())
            );
    }

    onClose(): void {
        this.reportEl = null;
        this.contentEl.empty();
    }

    private refreshReport(): void {
        if (this.reportEl) {
            this.reportEl.value = this.source.getReport();
        }
    }
}
