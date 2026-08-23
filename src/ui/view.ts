import "./overrides.css";
import { ItemView, Menu, Notice, WorkspaceLeaf } from "obsidian";
import { Calendar, EventSourceInput } from "@fullcalendar/core";
import {
    formatDateLabel,
    getAdjacentCalendarView,
    renderCalendar,
} from "./calendar";
import FullCalendarPlugin from "../main";
import { FCError, PLUGIN_SLUG } from "../types";
import {
    dateEndpointsToFrontmatter,
    fromEventApi,
    omitRecurringOccurrence,
    selectionRequiresDayView,
    toEventInput,
} from "./interop";
import { renderOnboarding } from "./onboard";
import { openFileForEvent } from "./actions";
import { launchEditModal } from "./event_modal";
import { isTask, toggleTask, unmakeTask } from "src/ui/tasks";
import { UpdateViewCallback } from "src/core/EventCache";
import {
    FULL_CALENDAR_SIDEBAR_VIEW_TYPE,
    FULL_CALENDAR_VIEW_TYPE,
} from "../plugin_registration";
import { navigateFromCalendarEvent } from "./event_navigation";
import {
    openDailyNoteForDate,
    resolveDailyNotePath,
} from "./daily_note_navigation";

export {
    FULL_CALENDAR_SIDEBAR_VIEW_TYPE,
    FULL_CALENDAR_VIEW_TYPE,
} from "../plugin_registration";

function getCalendarColors(color: string | null | undefined): {
    color: string;
    textColor: string;
} {
    let textVar = getComputedStyle(document.body).getPropertyValue(
        "--text-on-accent"
    );
    if (color) {
        const m = color
            .slice(1)
            .match(color.length == 7 ? /(\S{2})/g : /(\S{1})/g);
        if (m) {
            const r = parseInt(m[0], 16),
                g = parseInt(m[1], 16),
                b = parseInt(m[2], 16);
            const brightness = (r * 299 + g * 587 + b * 114) / 1000;
            if (brightness > 150) {
                textVar = "black";
            }
        }
    }

    return {
        color:
            color ||
            getComputedStyle(document.body).getPropertyValue(
                "--interactive-accent"
            ),
        textColor: textVar,
    };
}

export class CalendarView extends ItemView {
    plugin: FullCalendarPlugin;
    inSidebar: boolean;
    fullCalendarView: Calendar | null = null;
    callback: UpdateViewCallback | null = null;

    constructor(
        leaf: WorkspaceLeaf,
        plugin: FullCalendarPlugin,
        inSidebar = false
    ) {
        super(leaf);
        // Preserve this view in the leaf's Back/Forward history when an event
        // note replaces it as a normal Markdown buffer.
        this.navigation = true;
        this.plugin = plugin;
        this.inSidebar = inSidebar;
        this.registerDomEvent(document, "keydown", (event) =>
            this.handleCalendarShortcut(event)
        );
    }

    private handleCalendarShortcut(event: KeyboardEvent): void {
        const target = event.target;
        const targetElement = target instanceof Element ? target : null;
        const isEditing = !!targetElement?.closest(
            'input, textarea, select, [contenteditable]:not([contenteditable="false"]), .cm-editor, .modal-container, [role="dialog"]'
        );
        if (
            !this.fullCalendarView ||
            this.app.workspace.activeLeaf !== this.leaf ||
            event.defaultPrevented ||
            event.repeat ||
            event.ctrlKey ||
            event.metaKey ||
            event.altKey ||
            isEditing
        ) {
            return;
        }

        if (event.key === "Tab") {
            event.preventDefault();
            event.stopPropagation();
            this.containerEl
                .querySelector<HTMLElement>(".fc-toolbar .fc-button:focus")
                ?.blur();
            this.fullCalendarView.changeView(
                getAdjacentCalendarView(
                    this.fullCalendarView.view.type,
                    event.shiftKey
                )
            );
            return;
        }

        if (event.key.toLowerCase() === "t") {
            event.preventDefault();
            this.fullCalendarView.today();
        }
    }

    getIcon(): string {
        return "calendar-glyph";
    }

    getViewType() {
        return this.inSidebar
            ? FULL_CALENDAR_SIDEBAR_VIEW_TYPE
            : FULL_CALENDAR_VIEW_TYPE;
    }

    getDisplayText() {
        return this.inSidebar ? "Full Calendar" : "Calendar";
    }

    getDailyNotePath(date: Date): string {
        return resolveDailyNotePath(date);
    }

    async openDailyNote(date: Date): Promise<void> {
        await openDailyNoteForDate(this.app, date);
    }

    translateSources() {
        return this.plugin.cache.getAllEvents().map(
            ({ events, editable, color, id }): EventSourceInput => ({
                id,
                events: events.flatMap(
                    (e) => toEventInput(e.id, e.event) || []
                ),
                editable,
                ...getCalendarColors(color),
            })
        );
    }

    async onOpen() {
        await this.plugin.loadSettings();
        if (!this.plugin.cache) {
            new Notice("Full Calendar event cache not loaded.");
            return;
        }
        if (!this.plugin.cache.initialized) {
            await this.plugin.cache.populate();
        }

        const container = this.containerEl.children[1];
        container.empty();
        let calendarEl = container.createEl("div");

        if (
            this.plugin.settings.calendarSources.filter(
                (s) => s.type !== "FOR_TEST_ONLY"
            ).length === 0
        ) {
            renderOnboarding(this.app, this.plugin, calendarEl);
            return;
        }

        const sources: EventSourceInput[] = this.translateSources();

        if (this.fullCalendarView) {
            this.fullCalendarView.destroy();
            this.fullCalendarView = null;
        }
        this.fullCalendarView = renderCalendar(calendarEl, sources, {
            forceNarrow: this.inSidebar,
            eventClick: async (info) => {
                try {
                    const openedNote = await navigateFromCalendarEvent({
                        eventId: info.event.id,
                        originatingLeaf: this.leaf,
                        modified:
                            info.jsEvent.getModifierState("Control") ||
                            info.jsEvent.getModifierState("Meta"),
                        openModified: async (eventId) =>
                            openFileForEvent(
                                this.plugin.cache,
                                this.app,
                                eventId
                            ),
                        openInOriginatingLeaf: async (eventId, leaf) =>
                            this.plugin.openEventNote(eventId, leaf),
                    });
                    if (!openedNote) {
                        launchEditModal(this.plugin, info.event.id);
                    }
                } catch (e) {
                    if (e instanceof Error) {
                        console.warn(e);
                        new Notice(e.message);
                    }
                }
            },
            select: async (start, end, allDay, viewType) => {
                if (selectionRequiresDayView(viewType, allDay)) {
                    this.fullCalendarView?.changeView("timeGridDay");
                    this.fullCalendarView?.gotoDate(start);
                    return;
                }
                const partialEvent = dateEndpointsToFrontmatter(
                    start,
                    end,
                    false
                );
                try {
                    await this.plugin.createTimedEventNote(
                        partialEvent,
                        this.leaf
                    );
                } catch (e) {
                    if (e instanceof Error) {
                        console.error(e);
                        new Notice(e.message);
                    }
                }
            },
            modifyEvent: async (newEvent, oldEvent) => {
                try {
                    if (
                        this.plugin.cache.getEventById(oldEvent.id)?.type ===
                        "rrule"
                    ) {
                        return false;
                    }
                    const didModify = await this.plugin.cache.updateEventWithId(
                        oldEvent.id,
                        fromEventApi(newEvent)
                    );
                    return !!didModify;
                } catch (e: any) {
                    console.error(e);
                    new Notice(e.message);
                    return false;
                }
            },

            eventMouseEnter: async (info) => {
                try {
                    const location = this.plugin.cache.getInfoForEditableEvent(
                        info.event.id
                    ).location;
                    if (location) {
                        this.app.workspace.trigger("hover-link", {
                            event: info.jsEvent,
                            source: PLUGIN_SLUG,
                            hoverParent: calendarEl,
                            targetEl: info.jsEvent.target,
                            linktext: location.path,
                            sourcePath: location.path,
                        });
                    }
                } catch (e) {}
            },
            firstDay: this.plugin.settings.firstDay,
            initialView: this.plugin.settings.initialView,
            timeFormat24h: this.plugin.settings.timeFormat24h,
            dailyNotePath: (date) => this.getDailyNotePath(date),
            openDailyNote: async (date) => {
                try {
                    await this.openDailyNote(date);
                } catch (error) {
                    console.error(error);
                    new Notice(
                        error instanceof Error
                            ? error.message
                            : "Could not open the daily note."
                    );
                }
            },
            openContextMenuForEvent: async (e, mouseEvent) => {
                const menu = new Menu();
                if (!this.plugin.cache) {
                    return;
                }
                const event = this.plugin.cache.getEventById(e.id);
                if (!event) {
                    return;
                }

                if (this.plugin.cache.isEventEditable(e.id)) {
                    if (event.type !== "single") {
                        const occurrenceDate = e.start
                            ? formatDateLabel(e.start)
                            : null;
                        menu.addItem((item) =>
                            item
                                .setTitle("Omit this occurrence")
                                .setDisabled(!occurrenceDate)
                                .onClick(async () => {
                                    if (!this.plugin.cache || !occurrenceDate) {
                                        return;
                                    }
                                    try {
                                        await this.plugin.cache.processEvent(
                                            e.id,
                                            (event) =>
                                                omitRecurringOccurrence(
                                                    event,
                                                    occurrenceDate
                                                )
                                        );
                                        new Notice(
                                            `Omitted occurrence on ${occurrenceDate}.`
                                        );
                                    } catch (error) {
                                        console.error(error);
                                        new Notice(
                                            error instanceof Error
                                                ? error.message
                                                : "Could not omit this occurrence."
                                        );
                                    }
                                })
                        );
                        menu.addSeparator();
                    }
                    if (isTask(event)) {
                        menu.addItem((item) =>
                            item
                                .setTitle("Remove checkbox")
                                .onClick(async () => {
                                    await this.plugin.cache.processEvent(
                                        e.id,
                                        unmakeTask
                                    );
                                })
                        );
                        menu.addSeparator();
                    }
                    menu.addItem((item) =>
                        item.setTitle("Go to note").onClick(() => {
                            if (!this.plugin.cache) {
                                return;
                            }
                            openFileForEvent(this.plugin.cache, this.app, e.id);
                        })
                    );
                    menu.addItem((item) =>
                        item.setTitle("Delete").onClick(async () => {
                            if (!this.plugin.cache) {
                                return;
                            }
                            await this.plugin.cache.deleteEvent(e.id);
                            new Notice(`Deleted event "${e.title}".`);
                        })
                    );
                } else {
                    menu.addItem((item) => {
                        item.setTitle("No actions available").setDisabled(true);
                    });
                }

                menu.showAtMouseEvent(mouseEvent);
            },
            toggleTask: async (e, isDone) => {
                const event = this.plugin.cache.getEventById(e.id);
                if (!event) {
                    return false;
                }
                if (event.type !== "single") {
                    return false;
                }

                try {
                    await this.plugin.cache.updateEventWithId(
                        e.id,
                        toggleTask(event, isDone)
                    );
                } catch (e) {
                    if (e instanceof FCError) {
                        new Notice(e.message);
                    }
                    return false;
                }
                return true;
            },
        });
        if (this.callback) {
            this.plugin.cache.off("update", this.callback);
            this.callback = null;
        }
        this.callback = this.plugin.cache.on("update", (payload) => {
            if (payload.type === "resync") {
                this.fullCalendarView?.removeAllEventSources();
                const sources = this.translateSources();
                sources.forEach((source) =>
                    this.fullCalendarView?.addEventSource(source)
                );
                return;
            } else if (payload.type === "events") {
                const { toRemove, toAdd } = payload;
                console.debug("updating view from cache...", {
                    toRemove,
                    toAdd,
                });
                toRemove.forEach((id) => {
                    const event = this.fullCalendarView?.getEventById(id);
                    if (event) {
                        console.debug("removing event", event.toPlainObject());
                        event.remove();
                    } else {
                        console.warn(
                            `Event with id=${id} was slated to be removed but does not exist in the calendar.`
                        );
                    }
                });
                toAdd.forEach(({ id, event, calendarId }) => {
                    const eventInput = toEventInput(id, event);
                    console.debug("adding event", {
                        id,
                        event,
                        eventInput,
                        calendarId,
                    });
                    const addedEvent = this.fullCalendarView?.addEvent(
                        eventInput!,
                        calendarId
                    );
                    console.debug("event that was added", addedEvent);
                });
            }
        });
    }

    onResize(): void {
        if (this.fullCalendarView) {
            this.fullCalendarView.render();
        }
    }

    async onunload() {
        if (this.fullCalendarView) {
            this.fullCalendarView.destroy();
            this.fullCalendarView = null;
        }
        if (this.callback) {
            this.plugin.cache.off("update", this.callback);
            this.callback = null;
        }
    }
}
