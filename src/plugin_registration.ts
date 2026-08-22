export const FULL_CALENDAR_VIEW_TYPE = "full-calendar-view";
export const FULL_CALENDAR_SIDEBAR_VIEW_TYPE = "full-calendar-sidebar-view";

export const CALENDAR_VIEW_REGISTRATIONS = [
    { type: FULL_CALENDAR_VIEW_TYPE, inSidebar: false },
    { type: FULL_CALENDAR_SIDEBAR_VIEW_TYPE, inSidebar: true },
] as const;

export const CALENDAR_COMMAND_METADATA = [
    { id: "full-calendar-new-event", name: "New Event" },
    { id: "full-calendar-reset", name: "Reset Event Cache" },
    { id: "full-calendar-revalidate", name: "Revalidate remote calendars" },
    { id: "full-calendar-open", name: "Open Calendar" },
    { id: "full-calendar-open-sidebar", name: "Open in sidebar" },
] as const;

export type CalendarCommandId =
    (typeof CALENDAR_COMMAND_METADATA)[number]["id"];

export const registerCalendarViews = <Leaf, View>(
    register: (type: string, creator: (leaf: Leaf) => View) => void,
    create: (leaf: Leaf, inSidebar: boolean) => View
): void => {
    for (const spec of CALENDAR_VIEW_REGISTRATIONS) {
        register(spec.type, (leaf) => create(leaf, spec.inSidebar));
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
