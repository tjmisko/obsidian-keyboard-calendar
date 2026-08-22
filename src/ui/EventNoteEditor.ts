import { App, TFile, WorkspaceLeaf } from "obsidian";

const performanceNow = (): number =>
    typeof performance === "undefined" ? Date.now() : performance.now();

const roundMilliseconds = (milliseconds: number): number =>
    Math.round(milliseconds * 10) / 10;

const SLOW_OPEN_THRESHOLD_MS = 250;

let openSequence = 0;

/**
 * Opens an event note as an ordinary Markdown buffer in the originating leaf.
 * Keeping this on Obsidian's normal navigation path preserves command-palette,
 * Vim, recent-file, alternate-file, and back/forward behavior.
 */
export default class EventNoteEditor {
    constructor(private app: App) {}

    async open(file: TFile, targetLeaf?: WorkspaceLeaf): Promise<void> {
        const id = ++openSequence;
        const startedAt = performanceNow();
        const activeLeaf = this.app.workspace.activeLeaf;
        const leaf =
            targetLeaf || activeLeaf || this.app.workspace.getLeaf(false);
        let sourceViewType: string | undefined;
        try {
            sourceViewType = leaf.getViewState().type;
        } catch {
            sourceViewType = undefined;
        }
        const context = {
            filePath: file.path,
            sourceViewType,
            target: targetLeaf
                ? "originating-leaf"
                : activeLeaf
                ? "active-leaf"
                : "navigable-leaf",
        };
        console.info(
            `[Full Calendar][event-note navigation][open#${id}] started`,
            context
        );

        try {
            await leaf.openFile(file);
            const elapsedMs = roundMilliseconds(performanceNow() - startedAt);
            const details = {
                ...context,
                elapsedMs,
                slow: elapsedMs >= SLOW_OPEN_THRESHOLD_MS,
            };
            const message = `[Full Calendar][event-note navigation][open#${id}] completed`;
            if (details.slow) {
                console.warn(`${message} [slow]`, details);
            } else {
                console.info(message, details);
            }
        } catch (error) {
            console.error(
                `[Full Calendar][event-note navigation][open#${id}] failed`,
                {
                    ...context,
                    elapsedMs: roundMilliseconds(performanceNow() - startedAt),
                    errorName: error instanceof Error ? error.name : undefined,
                    errorMessage:
                        error instanceof Error ? error.message : String(error),
                },
                error
            );
            throw error;
        }
    }
}
