import { Notice } from "obsidian";

export const KEYBOARD_CALENDAR_VIEW_TYPE = "keyboard-calendar-view";
export const DAY_CALENDAR_VIEW_TYPE = "keyboard-calendar-day-view";

export const CALENDAR_VIEW_REGISTRATIONS = [
    { type: KEYBOARD_CALENDAR_VIEW_TYPE, surface: "primary" },
    { type: DAY_CALENDAR_VIEW_TYPE, surface: "day-sidebar" },
] as const;

export const CALENDAR_COMMAND_METADATA = [
    { id: "keyboard-calendar-new-event", name: "New Event" },
    { id: "keyboard-calendar-reset", name: "Reset Event Cache" },
    { id: "keyboard-calendar-open", name: "Open Calendar" },
    { id: "keyboard-calendar-open-day", name: "Open Day Calendar" },
    {
        id: "keyboard-calendar-diagnostics",
        name: "Show Diagnostic Report",
    },
] as const;

export type CalendarCommandId =
    (typeof CALENDAR_COMMAND_METADATA)[number]["id"];

export const reportEventNoteCreationFailure = (error: unknown): void => {
    console.error("Could not create event note", error);
    new Notice(
        "Could not create the event note. Check the console for details."
    );
};

export const registerCalendarViews = <Leaf, View>(
    register: (type: string, creator: (leaf: Leaf) => View) => void,
    create: (
        leaf: Leaf,
        spec: (typeof CALENDAR_VIEW_REGISTRATIONS)[number]
    ) => View
): void => {
    for (const spec of CALENDAR_VIEW_REGISTRATIONS) {
        register(spec.type, (leaf) => create(leaf, spec));
    }
};

export const registerCalendarCommands = <Command>(
    register: (command: Command) => void,
    create: (metadata: (typeof CALENDAR_COMMAND_METADATA)[number]) => Command
): void => {
    for (const metadata of CALENDAR_COMMAND_METADATA) {
        register(create(metadata));
    }
};
