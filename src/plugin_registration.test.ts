import {
    CALENDAR_COMMAND_METADATA,
    CALENDAR_VIEW_REGISTRATIONS,
    FULL_CALENDAR_VIEW_TYPE,
    registerCalendarCommands,
    registerCalendarViews,
} from "./plugin_registration";

describe("plugin registration seams", () => {
    it("registers both stable view types with the correct sidebar mode", () => {
        const register = jest.fn();
        const create = jest.fn((leaf: string, inSidebar: boolean) => ({
            leaf,
            inSidebar,
        }));
        registerCalendarViews(register, create);

        expect(CALENDAR_VIEW_REGISTRATIONS[0].type).toBe(
            FULL_CALENDAR_VIEW_TYPE
        );
        expect(register).toHaveBeenCalledTimes(2);
        expect(register.mock.calls[0][1]("main-leaf")).toEqual({
            leaf: "main-leaf",
            inSidebar: false,
        });
        expect(register.mock.calls[1][1]("side-leaf")).toEqual({
            leaf: "side-leaf",
            inSidebar: true,
        });
    });

    it("registers the stable open command through an injectable callback", () => {
        const register = jest.fn();
        registerCalendarCommands(register, (metadata) => metadata);
        expect(register).toHaveBeenCalledTimes(
            CALENDAR_COMMAND_METADATA.length
        );
        expect(register).toHaveBeenCalledWith({
            id: "full-calendar-open",
            name: "Open Calendar",
        });
    });
});
