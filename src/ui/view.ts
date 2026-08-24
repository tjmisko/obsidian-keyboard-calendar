import "./overrides.css";
import { ItemView, Menu, Notice, WorkspaceLeaf } from "obsidian";
import { Calendar } from "@fullcalendar/core";
import {
    formatDateLabel,
    getAdjacentCalendarView,
    LocalMaterializedEventSource,
    renderCalendar,
} from "./calendar";
import FullCalendarPlugin from "../main";
import { PLUGIN_SLUG } from "../types";
import { fromEventApi, omitRecurringOccurrence, toEventInput } from "./interop";
import { renderOnboarding } from "./onboard";
import { openFullNoteForEvent } from "./actions";
import { UpdateViewCallback } from "src/core/EventCache";
import { FULL_CALENDAR_VIEW_TYPE } from "../plugin_registration";
import { navigateFromCalendarEvent } from "./event_navigation";
import {
    openDailyNoteForDate,
    resolveDailyNotePath,
} from "./daily_note_navigation";
import { getCalendarEventContextActions } from "./event_context";
import { handleCalendarSelection } from "./event_creation";
import { CalendarCellNavigator } from "./cell_navigation";

export { FULL_CALENDAR_VIEW_TYPE } from "../plugin_registration";

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
    fullCalendarView: Calendar | null = null;
    cellNavigator: CalendarCellNavigator | null = null;
    callback: UpdateViewCallback | null = null;

    constructor(leaf: WorkspaceLeaf, plugin: FullCalendarPlugin) {
        super(leaf);
        // Preserve this view in the leaf's Back/Forward history when an event
        // note replaces it as a normal Markdown buffer.
        this.navigation = true;
        this.plugin = plugin;
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
            event.ctrlKey ||
            event.metaKey ||
            event.altKey ||
            isEditing
        ) {
            return;
        }

        if (this.cellNavigator?.handleKey(event.key, event.repeat)) {
            event.preventDefault();
            event.stopPropagation();
            return;
        }

        if (event.key === "Tab") {
            if (event.repeat) {
                return;
            }
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
            if (event.repeat) {
                return;
            }
            event.preventDefault();
            this.fullCalendarView.today();
        }
    }

    getIcon(): string {
        return "calendar-glyph";
    }

    getViewType() {
        return FULL_CALENDAR_VIEW_TYPE;
    }

    getDisplayText() {
        return "Calendar";
    }

    getDailyNotePath(date: Date): string {
        return resolveDailyNotePath(date);
    }

    async openDailyNote(date: Date): Promise<void> {
        await openDailyNoteForDate(this.app, date);
    }

    translateSources() {
        return this.plugin.cache.getAllEvents().map(
            ({
                events,
                editable,
                color,
                id,
            }): LocalMaterializedEventSource => ({
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

        if (this.plugin.settings.calendarSources.length === 0) {
            renderOnboarding(this.app, this.plugin, calendarEl);
            return;
        }

        const sources: LocalMaterializedEventSource[] = this.translateSources();

        if (this.fullCalendarView) {
            this.cellNavigator?.destroy();
            this.cellNavigator = null;
            this.fullCalendarView.destroy();
            this.fullCalendarView = null;
        }
        const handleSelection = async (
            start: Date,
            end: Date,
            allDay: boolean,
            viewType: string
        ): Promise<void> => {
            await handleCalendarSelection({
                start,
                end,
                allDay,
                viewType,
                openDay: (date) => {
                    this.fullCalendarView?.changeView("timeGridDay");
                    this.fullCalendarView?.gotoDate(date);
                },
                createTimedNote: async (partialEvent) => {
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
            });
        };
        this.fullCalendarView = renderCalendar(calendarEl, sources, {
            eventClick: async (info) => {
                try {
                    const openedNote = await navigateFromCalendarEvent({
                        eventId: info.event.id,
                        originatingLeaf: this.leaf,
                        modified:
                            info.jsEvent.getModifierState("Control") ||
                            info.jsEvent.getModifierState("Meta"),
                        openModified: async (eventId) =>
                            openFullNoteForEvent(
                                this.plugin.cache,
                                this.app,
                                eventId
                            ),
                        openInOriginatingLeaf: async (eventId, leaf) =>
                            this.plugin.openEventNote(eventId, leaf),
                    });
                    return openedNote;
                } catch (e) {
                    if (e instanceof Error) {
                        console.warn(e);
                        new Notice(e.message);
                    }
                }
            },
            select: handleSelection,
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
                    const location = this.plugin.cache.getInfoForFullNoteEvent(
                        info.event.id
                    )?.location;
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
            datesSet: () => this.cellNavigator?.syncToView(true),
            ghostEventTags: () => this.plugin.settings.ghostEventTags,
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
                if (!this.plugin.cache) {
                    return;
                }
                const event = this.plugin.cache.getEventById(e.id);
                if (!event) {
                    return;
                }
                const occurrenceDate = e.start
                    ? formatDateLabel(e.start)
                    : null;
                const actions = getCalendarEventContextActions({
                    event,
                    isLocalFullNote:
                        this.plugin.cache.getInfoForFullNoteEvent(e.id) !==
                        null,
                    occurrenceDate,
                    omit: async (date) => {
                        try {
                            await this.plugin.cache.processEvent(
                                e.id,
                                (event) => omitRecurringOccurrence(event, date)
                            );
                            new Notice(`Omitted occurrence on ${date}.`);
                        } catch (error) {
                            console.error(error);
                            new Notice(
                                error instanceof Error
                                    ? error.message
                                    : "Could not omit this occurrence."
                            );
                        }
                    },
                });
                if (actions.length === 0) {
                    return;
                }
                const menu = new Menu();
                actions.forEach((action) =>
                    menu.addItem((item) =>
                        item
                            .setTitle(action.title)
                            .setDisabled(action.disabled)
                            .onClick(action.run)
                    )
                );
                menu.showAtMouseEvent(mouseEvent);
            },
        });
        this.cellNavigator = new CalendarCellNavigator(
            calendarEl,
            this.fullCalendarView,
            {
                createEvent: async (start, end) =>
                    handleSelection(
                        start,
                        end,
                        false,
                        this.fullCalendarView?.view.type || "timeGridWeek"
                    ),
            }
        );
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
                toRemove.forEach((id) => {
                    const event = this.fullCalendarView?.getEventById(id);
                    if (event) {
                        event.remove();
                    }
                });
                toAdd.forEach(({ id, event, sourceId }) => {
                    const eventInput = toEventInput(id, event);
                    this.fullCalendarView?.addEvent(eventInput!, sourceId);
                });
            }
        });
    }

    onResize(): void {
        if (this.fullCalendarView) {
            this.fullCalendarView.render();
            this.cellNavigator?.renderSelection();
        }
    }

    async onunload() {
        this.cellNavigator?.destroy();
        this.cellNavigator = null;
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
