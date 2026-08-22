import type { WorkspaceLeaf } from "obsidian";

interface CalendarEventNavigation {
    eventId: string;
    originatingLeaf: WorkspaceLeaf;
    modified: boolean;
    openModified: (eventId: string) => Promise<void>;
    openInOriginatingLeaf: (
        eventId: string,
        leaf: WorkspaceLeaf
    ) => Promise<boolean>;
}

/** Test seam for the distinct modifier-click and same-leaf navigation paths. */
export async function navigateFromCalendarEvent({
    eventId,
    originatingLeaf,
    modified,
    openModified,
    openInOriginatingLeaf,
}: CalendarEventNavigation): Promise<boolean> {
    if (modified) {
        await openModified(eventId);
        return true;
    }
    return openInOriginatingLeaf(eventId, originatingLeaf);
}
