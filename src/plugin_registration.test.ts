import {
    CALENDAR_COMMAND_METADATA,
    CALENDAR_VIEW_REGISTRATIONS,
    DAY_CALENDAR_VIEW_TYPE,
    FULL_CALENDAR_VIEW_TYPE,
    registerCalendarCommands,
    registerCalendarViews,
    reportEventNoteCreationFailure,
} from "./plugin_registration";
import { Notice } from "obsidian";

describe("plugin registration seams", () => {
    it("registers the primary and right-sidebar calendar views", () => {
        const register = jest.fn();
        const create = jest.fn(
            (
                leaf: string,
                spec: (typeof CALENDAR_VIEW_REGISTRATIONS)[number]
            ) => ({ leaf, spec })
        );
        registerCalendarViews(register, create);

        expect(CALENDAR_VIEW_REGISTRATIONS[0].type).toBe(
            FULL_CALENDAR_VIEW_TYPE
        );
        expect(CALENDAR_VIEW_REGISTRATIONS[1]).toEqual({
            type: DAY_CALENDAR_VIEW_TYPE,
            surface: "day-sidebar",
        });
        expect(CALENDAR_VIEW_REGISTRATIONS).toHaveLength(2);
        expect(register).toHaveBeenCalledTimes(2);
        expect(register.mock.calls[0][1]("main-leaf")).toEqual({
            leaf: "main-leaf",
            spec: CALENDAR_VIEW_REGISTRATIONS[0],
        });
        expect(register.mock.calls[1][1]("right-leaf")).toEqual({
            leaf: "right-leaf",
            spec: CALENDAR_VIEW_REGISTRATIONS[1],
        });
    });

    it("registers the stable open command through an injectable callback", () => {
        const register = jest.fn();
        registerCalendarCommands(register, (metadata) => metadata);
        expect(CALENDAR_COMMAND_METADATA).toHaveLength(4);
        expect(register).toHaveBeenCalledTimes(4);
        expect(register).toHaveBeenCalledWith({
            id: "full-calendar-open",
            name: "Open Calendar",
        });
        expect(CALENDAR_COMMAND_METADATA.map(({ id }) => id)).not.toContain(
            "full-calendar-revalidate"
        );
        expect(register).toHaveBeenCalledWith({
            id: "full-calendar-open-day",
            name: "Open Day Calendar",
        });
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
