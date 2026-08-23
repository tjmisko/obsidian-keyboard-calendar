import {
    CALENDAR_COMMAND_METADATA,
    CALENDAR_VIEW_REGISTRATIONS,
    FULL_CALENDAR_VIEW_TYPE,
    registerCalendarCommands,
    registerCalendarViews,
    reportEventNoteCreationFailure,
} from "./plugin_registration";
import { Notice } from "obsidian";

describe("plugin registration seams", () => {
    it("registers only the stable active calendar view", () => {
        const register = jest.fn();
        const create = jest.fn((leaf: string) => ({ leaf }));
        registerCalendarViews(register, create);

        expect(CALENDAR_VIEW_REGISTRATIONS[0].type).toBe(
            FULL_CALENDAR_VIEW_TYPE
        );
        expect(CALENDAR_VIEW_REGISTRATIONS).toHaveLength(1);
        expect(register).toHaveBeenCalledTimes(1);
        expect(register.mock.calls[0][1]("main-leaf")).toEqual({
            leaf: "main-leaf",
        });
    });

    it("registers the stable open command through an injectable callback", () => {
        const register = jest.fn();
        registerCalendarCommands(register, (metadata) => metadata);
        expect(CALENDAR_COMMAND_METADATA).toHaveLength(3);
        expect(register).toHaveBeenCalledTimes(3);
        expect(register).toHaveBeenCalledWith({
            id: "full-calendar-open",
            name: "Open Calendar",
        });
        expect(CALENDAR_COMMAND_METADATA.map(({ id }) => id)).not.toContain(
            "full-calendar-revalidate"
        );
        expect(CALENDAR_COMMAND_METADATA.map(({ id }) => id)).not.toContain(
            "full-calendar-open-sidebar"
        );
    });

    it("reports asynchronous new-event command failures", () => {
        const error = new Error("disk failed");
        const consoleError = jest
            .spyOn(console, "error")
            .mockImplementation(() => undefined);
        const mockNotice = Notice as unknown as { notices: string[] };
        mockNotice.notices = [];

        reportEventNoteCreationFailure(error);

        expect(consoleError).toHaveBeenCalledWith(
            "Could not create event note",
            error
        );
        expect(mockNotice.notices).toEqual([
            "Could not create the event note. Check the console for details.",
        ]);
        consoleError.mockRestore();
    });
});
