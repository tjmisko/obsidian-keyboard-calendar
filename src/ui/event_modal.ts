import { Notice } from "obsidian";
import * as React from "react";
import { EditableCalendar } from "src/calendars/EditableCalendar";
import FullCalendarPlugin from "src/main";
import { OFCEvent } from "src/types";
import { openFileForEvent } from "./actions";
import { EditEvent } from "./components/EditEvent";
import { EditRetendEvent } from "./components/EditRetendEvent";
import ReactModal from "./ReactModal";

export function launchCreateModal(
    plugin: FullCalendarPlugin,
    partialEvent: Partial<OFCEvent>
) {
    const calendars = [...plugin.cache.calendars.entries()]
        .filter(([_, cal]) => cal instanceof EditableCalendar)
        .map(([id, cal]) => {
            return {
                id,
                type: cal.type,
                name: cal.name,
            };
        });

    // If the default calendar is retend, use the retend-specific modal
    const defaultCal = calendars[0];
    if (defaultCal && defaultCal.type === "retend") {
        new ReactModal(plugin.app, async (closeModal) =>
            React.createElement(EditRetendEvent, {
                initialEvent: partialEvent,
                categories: plugin.settings.retendCategories || {},
                submit: async (data: OFCEvent) => {
                    try {
                        await plugin.cache.addEvent(defaultCal.id, data);
                    } catch (e) {
                        if (e instanceof Error) {
                            new Notice(
                                "Error when creating event: " + e.message
                            );
                            console.error(e);
                        }
                    }
                    closeModal();
                },
            })
        ).open();
        return;
    }

    new ReactModal(plugin.app, async (closeModal) =>
        React.createElement(EditEvent, {
            initialEvent: partialEvent,
            calendars,
            defaultCalendarIndex: 0,
            submit: async (data, calendarIndex) => {
                const calendarId = calendars[calendarIndex].id;
                try {
                    await plugin.cache.addEvent(calendarId, data);
                } catch (e) {
                    if (e instanceof Error) {
                        new Notice("Error when creating event: " + e.message);
                        console.error(e);
                    }
                }
                closeModal();
            },
        })
    ).open();
}

export function launchEditModal(plugin: FullCalendarPlugin, eventId: string) {
    const eventToEdit = plugin.cache.getEventById(eventId);
    if (!eventToEdit) {
        throw new Error("Cannot edit event that doesn't exist.");
    }
    const calId = plugin.cache.getInfoForEditableEvent(eventId).calendar.id;
    const calendar = plugin.cache.getCalendarById(calId);

    // Use retend-specific modal for retend calendar events
    if (calendar && calendar.type === "retend") {
        new ReactModal(plugin.app, async (closeModal) =>
            React.createElement(EditRetendEvent, {
                initialEvent: eventToEdit,
                categories: plugin.settings.retendCategories || {},
                submit: async (data: OFCEvent) => {
                    try {
                        await plugin.cache.updateEventWithId(eventId, data);
                    } catch (e) {
                        if (e instanceof Error) {
                            new Notice(
                                "Error when updating event: " + e.message
                            );
                            console.error(e);
                        }
                    }
                    closeModal();
                },
                deleteEvent: async () => {
                    try {
                        await plugin.cache.deleteEvent(eventId);
                        closeModal();
                    } catch (e) {
                        if (e instanceof Error) {
                            new Notice(
                                "Error when deleting event: " + e.message
                            );
                            console.error(e);
                        }
                    }
                },
            })
        ).open();
        return;
    }

    const calendars = [...plugin.cache.calendars.entries()]
        .filter(([_, cal]) => cal instanceof EditableCalendar)
        .map(([id, cal]) => {
            return {
                id,
                type: cal.type,
                name: cal.name,
            };
        });

    const calIdx = calendars.findIndex(({ id }) => id === calId);

    new ReactModal(plugin.app, async (closeModal) =>
        React.createElement(EditEvent, {
            initialEvent: eventToEdit,
            calendars,
            defaultCalendarIndex: calIdx,
            submit: async (data, calendarIndex) => {
                try {
                    if (calendarIndex !== calIdx) {
                        await plugin.cache.moveEventToCalendar(
                            eventId,
                            calendars[calendarIndex].id
                        );
                    }
                    await plugin.cache.updateEventWithId(eventId, data);
                } catch (e) {
                    if (e instanceof Error) {
                        new Notice("Error when updating event: " + e.message);
                        console.error(e);
                    }
                }
                closeModal();
            },
            open: async () => {
                openFileForEvent(plugin.cache, plugin.app, eventId);
            },
            deleteEvent: async () => {
                try {
                    await plugin.cache.deleteEvent(eventId);
                    closeModal();
                } catch (e) {
                    if (e instanceof Error) {
                        new Notice("Error when deleting event: " + e.message);
                        console.error(e);
                    }
                }
            },
        })
    ).open();
}
