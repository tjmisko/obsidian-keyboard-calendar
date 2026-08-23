import { Notice } from "obsidian";

export const FULL_CALENDAR_VIEW_TYPE = "full-calendar-view";

export const CALENDAR_VIEW_REGISTRATIONS = [
    { type: FULL_CALENDAR_VIEW_TYPE },
] as const;

export const CALENDAR_COMMAND_METADATA = [
    { id: "full-calendar-new-event", name: "New Event" },
    { id: "full-calendar-reset", name: "Reset Event Cache" },
    { id: "full-calendar-open", name: "Open Calendar" },
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
    create: (leaf: Leaf) => View
): void => {
    for (const spec of CALENDAR_VIEW_REGISTRATIONS) {
        register(spec.type, create);
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
