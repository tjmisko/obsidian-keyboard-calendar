import "./overrides.css";
import { ItemView, Menu, Notice, WorkspaceLeaf } from "obsidian";
import { Calendar, EventInput } from "@fullcalendar/core";
import {
    formatDateLabel,
    getAdjacentCalendarView,
    LocalMaterializedEventSource,
    renderCalendar,
} from "./calendar";
import FullCalendarPlugin from "../main";
import { OFCEvent, PLUGIN_SLUG } from "../types";
import {
    attendEventOccurrence,
    fromEventApi,
    getSingleEventStartDate,
    moveSingleTimedEvent,
    omitRecurringOccurrence,
    toEventInput,
} from "./interop";
import { renderOnboarding } from "./onboard";
import { openFullNoteForEvent } from "./actions";
import { UpdateViewCallback } from "src/core/EventCache";
import { FULL_CALENDAR_VIEW_TYPE } from "../plugin_registration";
import {
    CalendarEventGrab,
    CalendarEventNavigator,
    CALENDAR_KEYDOWN_CAPTURE_OPTIONS,
    isCalendarMoveRedoShortcut,
    navigateFromCalendarEvent,
} from "./event_navigation";
import {
    openDailyNoteForDate,
    resolveDailyNotePath,
} from "./daily_note_navigation";
import { getCalendarEventContextActions } from "./event_context";
import { handleCalendarSelection } from "./event_creation";
import { CalendarCellNavigator } from "./cell_navigation";
import { applyCalendarCacheUpdate } from "./calendar_update";
import { EventDeleteConfirmationModal } from "./event_deletion";
import { resolveEventTagColor } from "../settings/tag_settings";
import {
    createCalendarEventClipboard,
    pasteCalendarEvent,
} from "./event_clipboard";

export { FULL_CALENDAR_VIEW_TYPE } from "../plugin_registration";

type CalendarNavigationMode = "normal" | "insert" | "grab" | "scale";

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
    eventNavigator: CalendarEventNavigator | null = null;
    callback: UpdateViewCallback | null = null;
    private navigationMode: CalendarNavigationMode = "normal";
    private modeChipEl: HTMLElement | null = null;
    private deleteConfirmationModal: EventDeleteConfirmationModal | null = null;

    constructor(leaf: WorkspaceLeaf, plugin: FullCalendarPlugin) {
        super(leaf);
        // Preserve this view in the leaf's Back/Forward history when an event
        // note replaces it as a normal Markdown buffer.
        this.navigation = true;
        this.plugin = plugin;
        // FullCalendar's focused event elements can activate Enter at the
        // target phase, so modal shortcuts must intercept keydown first.
        this.registerDomEvent(
            document,
            "keydown",
            (event) => this.handleCalendarShortcut(event),
            CALENDAR_KEYDOWN_CAPTURE_OPTIONS
        );
    }

    private handleCalendarShortcut(event: KeyboardEvent): void {
        const target = event.target;
        const targetElement = target instanceof Element ? target : null;
        const isEditing = !!targetElement?.closest(
            'input, textarea, select, [contenteditable]:not([contenteditable="false"]), .cm-editor, .modal-container, [role="dialog"]'
        );
        const isMoveRedo =
            this.navigationMode === "normal" &&
            isCalendarMoveRedoShortcut(event);
        if (
            !this.fullCalendarView ||
            this.app.workspace.activeLeaf !== this.leaf ||
            event.defaultPrevented ||
            (event.ctrlKey && !isMoveRedo) ||
            event.metaKey ||
            event.altKey ||
            isEditing
        ) {
            return;
        }

        if (isMoveRedo) {
            event.preventDefault();
            event.stopPropagation();
            this.eventNavigator?.handleKey("U", event.repeat);
            return;
        }

        if (this.navigationMode === "insert" && event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            this.enterNormalMode();
            return;
        }

        if (this.navigationMode === "normal" && event.key === "i") {
            if (event.repeat || this.enterInsertMode()) {
                event.preventDefault();
                event.stopPropagation();
            }
            return;
        }

        const handledByNavigator =
            this.navigationMode === "insert"
                ? this.cellNavigator?.handleKey(event.key, event.repeat)
                : this.eventNavigator?.handleKey(event.key, event.repeat);
        if (handledByNavigator) {
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

    private enterInsertMode(): boolean {
        if (
            !this.fullCalendarView?.view.type.startsWith("timeGrid") ||
            !this.cellNavigator
        ) {
            return false;
        }
        this.eventNavigator?.deactivate();
        this.cellNavigator.activateAtCurrentTime();
        this.navigationMode = "insert";
        this.updateModeChip();
        return true;
    }

    private enterNormalMode(): void {
        const cursorDate = this.cellNavigator?.getSelectedCell()?.start;
        this.cellNavigator?.deactivate();
        this.navigationMode = "normal";
        this.eventNavigator?.activate(cursorDate || new Date());
        this.updateModeChip();
    }

    private requestEventDeletion(eventId: string): void {
        const event = this.plugin.cache.getEventById(eventId);
        if (!event) {
            new Notice("Could not find that event note.");
            return;
        }

        this.deleteConfirmationModal?.close();
        let modal: EventDeleteConfirmationModal;
        modal = new EventDeleteConfirmationModal(this.app, {
            title: event.title,
            recurring: event.type === "recurring" || event.type === "rrule",
            confirm: async () => {
                try {
                    const deleted = await this.plugin.cache.deleteEventWithId(
                        eventId
                    );
                    if (deleted) {
                        this.eventNavigator?.forgetEvent(eventId);
                    }
                    return deleted;
                } catch (error) {
                    console.error(error);
                    new Notice(
                        error instanceof Error
                            ? error.message
                            : "Could not delete the event."
                    );
                    return false;
                }
            },
            onClose: () => {
                if (this.deleteConfirmationModal === modal) {
                    this.deleteConfirmationModal = null;
                }
                if (this.navigationMode !== "insert") {
                    this.eventNavigator?.syncToView();
                }
            },
        });
        this.deleteConfirmationModal = modal;
        modal.open();
    }

    private yankCalendarEvent({
        eventId,
        start,
        end,
    }: CalendarEventGrab): void {
        const event = this.plugin.cache.getEventById(eventId);
        const info = this.plugin.cache.getInfoForFullNoteEvent(eventId);
        if (!event || !info) {
            new Notice("Only local event notes can be yanked.");
            return;
        }
        this.plugin.eventClipboard = createCalendarEventClipboard(
            event,
            info.location.path,
            start,
            end
        );
        new Notice(`Yanked “${event.title}”.`);
    }

    private async pasteYankedEvent(start: Date): Promise<void> {
        const clipboard = this.plugin.eventClipboard;
        if (!clipboard) {
            new Notice("Yank an event with yy before pasting.");
            return;
        }
        try {
            const location = await this.plugin.cache.createEvent(
                pasteCalendarEvent(clipboard, start),
                clipboard.copiedBasename
            );
            const pastedEventId = this.plugin.cache.getEventIdForPath(
                location.file.path
            );
            new Notice(`Pasted ${location.file.path}.`);
            if (this.navigationMode === "normal" && pastedEventId) {
                this.eventNavigator?.activate(start, pastedEventId);
            }
        } catch (error) {
            console.error(error);
            new Notice(
                error instanceof Error
                    ? error.message
                    : "Could not paste the yanked event."
            );
        }
    }

    private createModeChip(calendarEl: HTMLElement): void {
        this.modeChipEl?.remove();
        const chip = calendarEl.ownerDocument.createElement("span");
        chip.className = "ofc-mode-chip";
        chip.setAttribute("role", "status");
        chip.setAttribute("aria-live", "polite");
        const toolbarChunk = calendarEl.querySelector<HTMLElement>(
            ".fc-header-toolbar .fc-toolbar-chunk"
        );
        (toolbarChunk || calendarEl).appendChild(chip);
        this.modeChipEl = chip;
        this.updateModeChip();
    }

    private updateModeChip(): void {
        if (!this.modeChipEl) {
            return;
        }
        const label =
            this.navigationMode === "normal"
                ? "Normal"
                : this.navigationMode === "insert"
                ? "Insert"
                : this.navigationMode === "grab"
                ? "Grab"
                : "Scale";
        this.modeChipEl.dataset.mode = this.navigationMode;
        this.modeChipEl.textContent = label;
        this.modeChipEl.setAttribute("aria-label", `Calendar mode: ${label}`);
        this.modeChipEl.title =
            this.navigationMode === "normal"
                ? "Normal mode — i inserts; m moves; s scales; yy/p copy/paste; x/Delete removes; zt/zz/zb align"
                : this.navigationMode === "insert"
                ? "Insert mode — p pastes; Escape returns; zt/zz/zb align the selected cell"
                : this.navigationMode === "grab"
                ? "Grab mode — arrows move; Enter/Escape keep; zt/zz/zb align"
                : "Scale mode — up/down resize the bottom; Enter/Escape keep; zt/zz/zb align";
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
                    (e) => this.translateEvent(e.id, e.event) || []
                ),
                editable,
                ...getCalendarColors(color),
            })
        );
    }

    private translateEvent(id: string, event: OFCEvent): EventInput | null {
        const input = toEventInput(id, event);
        if (!input) {
            return null;
        }
        const tagColor = resolveEventTagColor(
            event.categories,
            this.plugin.settings.eventTagColors
        );
        return tagColor ? { ...input, ...getCalendarColors(tagColor) } : input;
    }

    async onOpen() {
        await this.plugin.loadSettings();
        if (!this.plugin.cache) {
            new Notice("Keyboard Calendar event cache not loaded.");
            return;
        }
        if (!this.plugin.cache.initialized) {
            await this.plugin.cache.populate();
        } else {
            await this.plugin.cache.reconcileFromDisk();
        }

        const container = this.containerEl.children[1];
        container.empty();
        let calendarEl = container.createEl("div");

        if (this.plugin.settings.calendarSources.length === 0) {
            renderOnboarding(this.app, this.plugin, calendarEl);
            return;
        }

        const returnTarget =
            this.plugin.eventNoteEditor?.consumeCalendarReturnTarget(
                this.leaf
            ) || null;
        const returnEventId = returnTarget
            ? this.plugin.cache.getEventIdForPath(returnTarget.path)
            : null;
        const returnEvent = returnEventId
            ? this.plugin.cache.getEventById(returnEventId)
            : null;
        const returnEventDate = returnEvent
            ? getSingleEventStartDate(returnEvent)
            : null;

        const sources: LocalMaterializedEventSource[] = this.translateSources();

        if (this.fullCalendarView) {
            this.cellNavigator?.destroy();
            this.cellNavigator = null;
            this.eventNavigator?.destroy();
            this.eventNavigator = null;
            this.modeChipEl?.remove();
            this.modeChipEl = null;
            this.fullCalendarView.destroy();
            this.fullCalendarView = null;
        }
        const handleSelection = async (
            start: Date,
            end: Date,
            viewType: string,
            focusTitle = false
        ): Promise<void> => {
            await handleCalendarSelection({
                start,
                end,
                viewType,
                focusTitle,
                openDay: (date) => {
                    this.fullCalendarView?.changeView("timeGridDay");
                    this.fullCalendarView?.gotoDate(date);
                },
                createTimedNote: async (partialEvent, options) => {
                    try {
                        await this.plugin.createTimedEventNote(
                            partialEvent,
                            this.leaf,
                            options
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
                if (
                    this.navigationMode === "grab" ||
                    this.navigationMode === "scale"
                ) {
                    info.jsEvent.preventDefault();
                    return false;
                }
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
            initialDate: returnEventDate || undefined,
            timeFormat24h: this.plugin.settings.timeFormat24h,
            datesSet: () => {
                if (
                    this.navigationMode === "insert" &&
                    !this.fullCalendarView?.view.type.startsWith("timeGrid")
                ) {
                    this.enterNormalMode();
                } else if (this.navigationMode === "insert") {
                    this.cellNavigator?.syncToView(true);
                } else {
                    this.eventNavigator?.syncToView();
                }
            },
            eventsSet: () => {
                if (this.navigationMode !== "insert") {
                    this.eventNavigator?.syncToView();
                }
            },
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
                    ghostEventTags: this.plugin.settings.ghostEventTags,
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
                    attend: async (date) => {
                        try {
                            await this.plugin.cache.processEvent(
                                e.id,
                                (event) => attendEventOccurrence(event, date)
                            );
                            new Notice(`Attending occurrence on ${date}.`);
                        } catch (error) {
                            console.error(error);
                            new Notice(
                                error instanceof Error
                                    ? error.message
                                    : "Could not mark this occurrence as attending."
                            );
                        }
                    },
                    deleteEvent: () => this.requestEventDeletion(e.id),
                });
                const menu = new Menu();
                actions.forEach((action) => {
                    if (action.separatorBefore) {
                        menu.addSeparator();
                    }
                    menu.addItem((item) =>
                        item
                            .setTitle(action.title)
                            .setIcon(action.icon)
                            .setDisabled(action.disabled)
                            .onClick(action.run)
                    );
                });
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
                        this.fullCalendarView?.view.type || "timeGridWeek",
                        true
                    ),
                pasteEvent: (start) => this.pasteYankedEvent(start),
            }
        );
        this.cellNavigator.deactivate();
        const canTransformEvent = (eventId: string): boolean => {
            const event = this.plugin.cache.getEventById(eventId);
            return !!(
                this.fullCalendarView?.view.type.startsWith("timeGrid") &&
                event?.type === "single" &&
                this.plugin.cache.getInfoForFullNoteEvent(eventId)
            );
        };
        this.eventNavigator = new CalendarEventNavigator(calendarEl, {
            canGrabEvent: canTransformEvent,
            canScaleEvent: canTransformEvent,
            onGrabUnavailable: () =>
                new Notice(
                    "Grab mode is available for editable, single timed events in week and day views."
                ),
            previewGrabbedEvent: ({ eventId, start, end }) => {
                const calendar = this.fullCalendarView;
                const event = calendar?.getEventById(eventId);
                if (!calendar || !event) {
                    return;
                }
                event.setDates(start, end, { allDay: false });
                const { activeStart, activeEnd } = calendar.view;
                if (start < activeStart || start >= activeEnd) {
                    calendar.gotoDate(start);
                }
            },
            commitGrabbedEvent: async ({ eventId, start, end }) => {
                try {
                    const event = this.plugin.cache.getEventById(eventId);
                    if (event?.type !== "single") {
                        return false;
                    }
                    const movedEvent = moveSingleTimedEvent(event, start, end);
                    if (!movedEvent) {
                        return false;
                    }
                    return !!(await this.plugin.cache.updateEventWithId(
                        eventId,
                        movedEvent
                    ));
                } catch (error) {
                    console.error(error);
                    new Notice(
                        error instanceof Error
                            ? error.message
                            : "Could not update the event timing."
                    );
                    return false;
                }
            },
            requestDeleteEvent: (eventId) => this.requestEventDeletion(eventId),
            yankEvent: (event) => this.yankCalendarEvent(event),
            pasteEvent: (start) => this.pasteYankedEvent(start),
            onGrabModeChange: (active) => {
                this.navigationMode = active ? "grab" : "normal";
                this.updateModeChip();
            },
            onScaleUnavailable: () =>
                new Notice(
                    "Scale mode is available for editable, single timed events in week and day views."
                ),
            onScaleModeChange: (active) => {
                this.navigationMode = active ? "scale" : "normal";
                this.updateModeChip();
            },
        });
        this.navigationMode = "normal";
        this.eventNavigator.activate(
            returnEventDate || undefined,
            returnEventId || undefined
        );
        this.createModeChip(calendarEl);
        if (this.callback) {
            this.plugin.cache.off("update", this.callback);
            this.callback = null;
        }
        this.callback = this.plugin.cache.on("update", (payload) => {
            if (!this.fullCalendarView) {
                return;
            }
            applyCalendarCacheUpdate({
                calendar: this.fullCalendarView,
                update: payload,
                getEventSources: () => this.translateSources(),
                convertEvent: (id, event) => this.translateEvent(id, event),
                renderSelection: () => {
                    if (this.navigationMode === "insert") {
                        this.cellNavigator?.renderSelection();
                    } else {
                        this.eventNavigator?.syncToView();
                    }
                },
            });
        });
    }

    onResize(): void {
        if (this.fullCalendarView) {
            this.fullCalendarView.render();
            if (this.navigationMode === "insert") {
                this.cellNavigator?.renderSelection();
            } else {
                this.eventNavigator?.syncToView();
            }
        }
    }

    async onunload() {
        this.deleteConfirmationModal?.close();
        this.deleteConfirmationModal = null;
        this.cellNavigator?.destroy();
        this.cellNavigator = null;
        this.eventNavigator?.destroy();
        this.eventNavigator = null;
        this.modeChipEl?.remove();
        this.modeChipEl = null;
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
