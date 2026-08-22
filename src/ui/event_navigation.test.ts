import type { WorkspaceLeaf } from "obsidian";
import { navigateFromCalendarEvent } from "./event_navigation";

describe("calendar event navigation seam", () => {
    it("passes the originating calendar leaf to normal event navigation", async () => {
        const originatingLeaf = {} as WorkspaceLeaf;
        const openModified = jest.fn(async () => undefined);
        const openInOriginatingLeaf = jest.fn(async () => true);

        await expect(
            navigateFromCalendarEvent({
                eventId: "event-id",
                originatingLeaf,
                modified: false,
                openModified,
                openInOriginatingLeaf,
            })
        ).resolves.toBe(true);
        expect(openInOriginatingLeaf).toHaveBeenCalledWith(
            "event-id",
            originatingLeaf
        );
        expect(openModified).not.toHaveBeenCalled();
    });

    it("keeps modifier-click on its separate navigation path", async () => {
        const openModified = jest.fn(async () => undefined);
        const openInOriginatingLeaf = jest.fn(async () => false);
        await navigateFromCalendarEvent({
            eventId: "event-id",
            originatingLeaf: {} as WorkspaceLeaf,
            modified: true,
            openModified,
            openInOriginatingLeaf,
        });
        expect(openModified).toHaveBeenCalledWith("event-id");
        expect(openInOriginatingLeaf).not.toHaveBeenCalled();
    });
});
