import "./overrides.css";
import {
    ItemView,
    Menu,
    Notice,
    Platform,
    ViewStateResult,
    WorkspaceLeaf,
} from "obsidian";
import { Calendar, EventInput } from "@fullcalendar/core";
import {
    collectCalendarRenderDiagnostics,
    CalendarPeriodDirection,
    formatDateLabel,
    getAdjacentCalendarView,
    LocalMaterializedEventSource,
    navigateCalendarPeriod,
    renderCalendar,
    revealCalendarColumn,
    scrollCalendarDateIntoView,
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
import {
    DAY_CALENDAR_VIEW_TYPE,
    KEYBOARD_CALENDAR_VIEW_TYPE,
} from "../plugin_registration";
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
import {
    canAttendEventOccurrence,
    canOmitEventOccurrence,
    getCalendarEventContextActions,
} from "./event_context";
import { handleCalendarSelection } from "./event_creation";
import { EventCreationModal } from "./event_creation_modal";
import { DayPeekModal } from "./day_peek_modal";
import { createEventDraft } from "./event_draft";
import { haptic, STEP_HAPTIC_MS } from "./haptics";
import { CalendarCellNavigator } from "./cell_navigation";
import { applyCalendarCacheUpdate } from "./calendar_update";
import { EventDeleteConfirmationModal } from "./event_deletion";
import {
    EventOccurrenceAction,
    EventOccurrenceConfirmationModal,
} from "./event_occurrence_confirmation";
import {
    resolveEventTagColor,
    resolveEventTextColor,
} from "../settings/tag_settings";
import {
    createCalendarEventClipboard,
    pasteCalendarEvent,
} from "./event_clipboard";
import {
    getZoomAnchoredScrollTop,
    isTimeGridZoomView,
    refreshTimeGridLayout,
    TimeGridZoom,
    TimeGridZoomDirection,
} from "./calendar_zoom";
import { attachPinchZoom } from "./pinch_zoom";
import {
    CALENDAR_VIEWPORT_STATE_KEY,
    CalendarViewportState,
    findCalendarBodyScroller,
    findCalendarHorizontalScroller,
    formatViewportDate,
    parseCalendarViewportState,
    parseViewportDate,
    readCalendarViewportFromEphemeralState,
    readZoomLevelFromViewState,
} from "./calendar_viewport";

export {
    DAY_CALENDAR_VIEW_TYPE,
    KEYBOARD_CALENDAR_VIEW_TYPE,
} from "../plugin_registration";

type CalendarNavigationMode = "normal" | "insert" | "grab" | "scale";
export type CalendarViewSurface = "primary" | "day-sidebar";

function getCalendarColors(
    color: string | null | undefined,
    useDarkTextOnLightEventColors: boolean
): {
    color: string;
    textColor: string;
} {
    return {
        color:
            color ||
            getComputedStyle(document.body).getPropertyValue(
                "--interactive-accent"
            ),
        textColor: resolveEventTextColor(color, useDarkTextOnLightEventColors),
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
    private occurrenceConfirmationModal: EventOccurrenceConfirmationModal | null =
        null;
    private creationModal: EventCreationModal | null = null;
    private dayPeekModal: DayPeekModal | null = null;
    private detachPinchZoom: (() => void) | null = null;
    private readonly timeGridZoom = new TimeGridZoom();
    private calendarEl: HTMLElement | null = null;
    private weekAnchorAnimationFrame: number | null = null;
    private weekAnchorWindow: Window | null = null;
    private lastPrimaryViewType: string | null = null;
    /** Viewport handed over by Obsidian before the calendar finished rendering. */
    private pendingViewport: CalendarViewportState | null = null;
    private viewportRestoreFrame: number | null = null;
    private viewportRestoreWindow: Window | null = null;
    /** An event note the reader just came back from; keep it on screen. */
    private returnEventDate: Date | null = null;

    constructor(
        leaf: WorkspaceLeaf,
        plugin: FullCalendarPlugin,
        private readonly surface: CalendarViewSurface = "primary"
    ) {
        super(leaf);
        // Preserve this view in the leaf's Back/Forward history when an event
        // note replaces it as a normal Markdown buffer.
        this.navigation = surface === "primary";
        this.plugin = plugin;
        // FullCalendar's focused event elements can activate Enter at the
        // target phase, so modal shortcuts must intercept keydown first.
        this.registerDomEvent(
            document,
            "keydown",
            (event) => this.handleCalendarShortcut(event),
            CALENDAR_KEYDOWN_CAPTURE_OPTIONS
        );
        this.registerDomEvent(
            this.contentEl,
            "click",
            (event) => this.handleMoreLinkTap(event),
            { capture: true }
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

        if (this.calendarEl) {
            const anchor = this.captureZoomAnchor();
            const zoom = this.timeGridZoom.handleKey(
                event.key,
                this.fullCalendarView.view.type,
                this.calendarEl
            );
            if (zoom.handled) {
                event.preventDefault();
                event.stopPropagation();
                if (zoom.changed) {
                    this.refreshAfterZoomChange();
                    this.restoreZoomAnchor(anchor);
                }
                return;
            }
        }

        if (event.key === "Tab" && this.surface === "primary") {
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
        const focusedEventDate = this.eventNavigator?.getFocusedEvent()
            ? this.eventNavigator.getFocusedDate()
            : null;
        this.eventNavigator?.deactivate();
        if (focusedEventDate) {
            this.cellNavigator.activateAt(focusedEventDate);
        } else {
            this.cellNavigator.activateAtCurrentTime();
        }
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

        this.occurrenceConfirmationModal?.close();
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

    private async updateEventOccurrence(
        action: EventOccurrenceAction,
        eventId: string,
        date: string
    ): Promise<boolean> {
        try {
            await this.plugin.cache.processEvent(eventId, (event) =>
                action === "omit"
                    ? omitRecurringOccurrence(event, date)
                    : attendEventOccurrence(event, date)
            );
            new Notice(
                action === "omit"
                    ? `Omitted occurrence on ${date}.`
                    : `Attending occurrence on ${date}.`
            );
            return true;
        } catch (error) {
            console.error(error);
            new Notice(
                error instanceof Error
                    ? error.message
                    : action === "omit"
                    ? "Could not omit this occurrence."
                    : "Could not mark this occurrence as attending."
            );
            return false;
        }
    }

    private requestEventOccurrenceAction(
        action: EventOccurrenceAction,
        eventId: string,
        occurrence: Date
    ): void {
        const event = this.plugin.cache.getEventById(eventId);
        const isLocalFullNote =
            this.plugin.cache.getInfoForFullNoteEvent(eventId) !== null;
        const date = formatDateLabel(occurrence);
        const isAvailable = event
            ? action === "omit"
                ? canOmitEventOccurrence(event, isLocalFullNote, date)
                : canAttendEventOccurrence(
                      event,
                      isLocalFullNote,
                      date,
                      this.plugin.settings.ghostEventTags
                  )
            : false;
        if (!event || !isAvailable) {
            return;
        }

        this.deleteConfirmationModal?.close();
        this.occurrenceConfirmationModal?.close();
        let modal: EventOccurrenceConfirmationModal;
        modal = new EventOccurrenceConfirmationModal(this.app, {
            action,
            title: event.title,
            date,
            confirm: () => this.updateEventOccurrence(action, eventId, date),
            onClose: () => {
                if (this.occurrenceConfirmationModal === modal) {
                    this.occurrenceConfirmationModal = null;
                }
                if (this.navigationMode !== "insert") {
                    this.eventNavigator?.syncToView();
                }
            },
        });
        this.occurrenceConfirmationModal = modal;
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

    private openDayPeek(date: Date): void {
        this.dayPeekModal?.close();
        let modal: DayPeekModal;
        modal = new DayPeekModal(this.app, {
            date,
            zoomLevel: this.timeGridZoom.index,
            firstDay: this.plugin.settings.firstDay,
            timeFormat24h: this.plugin.settings.timeFormat24h,
            ghostEventTags: () => this.plugin.settings.ghostEventTags,
            getEventSources: () => this.translateSources(),
            subscribe: (onChange) => {
                const callback = this.plugin.cache.on("update", onChange);
                return () => {
                    this.plugin.cache.off("update", callback);
                    if (this.dayPeekModal === modal) {
                        this.dayPeekModal = null;
                    }
                };
            },
            openEvent: (eventId) => {
                void this.plugin
                    .openEventNote(eventId, this.leaf)
                    .catch((error) => {
                        console.error(error);
                        new Notice(
                            error instanceof Error
                                ? error.message
                                : "Could not open the event note."
                        );
                    });
            },
            proposeEvent: (start, end) => this.proposeTimedEvent(start, end),
        });
        this.dayPeekModal = modal;
        modal.open();
    }

    /**
     * On touch, "+N more" opens the day peek instead of FullCalendar's small
     * popover. Capture runs before FullCalendar's own handler on the link.
     */
    private handleMoreLinkTap(event: MouseEvent): void {
        if (!Platform.isMobile || this.surface !== "primary") {
            return;
        }
        const target = event.target instanceof Element ? event.target : null;
        const link = target?.closest(".fc-daygrid-more-link");
        const date = parseViewportDate(
            link
                ?.closest<HTMLElement>(".fc-daygrid-day[data-date]")
                ?.getAttribute("data-date")
        );
        if (!date) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        this.openDayPeek(date);
    }

    private proposeTimedEvent(start: Date, end: Date): void {
        if (!this.plugin.cache.hasLocalCalendar()) {
            new Notice(
                "Add a full-note calendar before creating an event note."
            );
            return;
        }
        haptic();
        this.creationModal?.close();
        let modal: EventCreationModal;
        modal = new EventCreationModal(this.app, {
            draft: createEventDraft(start, end),
            create: async ({ event, basename, start: eventStart }) => {
                try {
                    const file = await this.plugin.createEventNote(
                        event,
                        basename
                    );
                    if (!file) {
                        return false;
                    }
                    const eventId = this.plugin.cache.getEventIdForPath(
                        file.path
                    );
                    if (this.navigationMode === "normal" && eventId) {
                        this.eventNavigator?.activate(eventStart, eventId);
                    }
                    return true;
                } catch (error) {
                    console.error(error);
                    new Notice(
                        error instanceof Error
                            ? error.message
                            : "Could not create the event."
                    );
                    return false;
                }
            },
            onClose: () => {
                if (this.creationModal === modal) {
                    this.creationModal = null;
                }
            },
        });
        this.creationModal = modal;
        modal.open();
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
                ? "Normal mode — arrows or h/j/k/l focus events and cross week boundaries; o omits; a attends; i inserts; m moves; s scales; yy/p copy/paste; x/Delete removes; zt/zz/zb align"
                : this.navigationMode === "insert"
                ? "Insert mode — T jumps to the current time; {hour}G jumps to an hour; p pastes; Escape returns; zt/zz/zb align the selected cell"
                : this.navigationMode === "grab"
                ? "Grab mode — arrows move; Enter/Escape keep; zt/zz/zb align"
                : "Scale mode — up/down resize the bottom; Enter/Escape keep; zt/zz/zb align";
    }

    getIcon(): string {
        return "calendar-glyph";
    }

    getViewType() {
        return this.surface === "day-sidebar"
            ? DAY_CALENDAR_VIEW_TYPE
            : KEYBOARD_CALENDAR_VIEW_TYPE;
    }

    getDisplayText() {
        return this.surface === "day-sidebar" ? "Day Calendar" : "Calendar";
    }

    /**
     * Persisted with the workspace layout, which Obsidian keeps per device
     * (workspace.json vs workspace-mobile.json), so phone and desktop each
     * keep their own zoom.
     */
    getState(): Record<string, unknown> {
        return { ...super.getState(), zoomLevel: this.timeGridZoom.index };
    }

    async setState(state: unknown, result: ViewStateResult): Promise<void> {
        const zoomLevel = readZoomLevelFromViewState(state);
        if (
            zoomLevel !== null &&
            this.timeGridZoom.setIndex(zoomLevel, this.calendarEl)
        ) {
            this.refreshAfterZoomChange(false);
        }
        await super.setState(state, result);
    }

    /**
     * Obsidian records ephemeral state in the leaf's Back/Forward history but
     * not in the saved layout: going back returns to the same period and
     * scroll position, while a fresh launch still opens on today.
     */
    getEphemeralState(): Record<string, unknown> {
        const viewport = this.captureViewport();
        return {
            ...super.getEphemeralState(),
            ...(viewport && { [CALENDAR_VIEWPORT_STATE_KEY]: viewport }),
        };
    }

    setEphemeralState(state: unknown): void {
        super.setEphemeralState(state);
        const viewport = readCalendarViewportFromEphemeralState(state);
        if (viewport) {
            this.restoreViewport(viewport);
        }
    }

    private captureViewport(): CalendarViewportState | null {
        const calendar = this.fullCalendarView;
        const calendarEl = this.calendarEl;
        if (!calendar || !calendarEl) {
            return this.pendingViewport;
        }
        return parseCalendarViewportState({
            viewType: calendar.view.type,
            date: formatViewportDate(calendar.getDate()),
            zoomLevel: this.timeGridZoom.index,
            scrollTop: findCalendarBodyScroller(calendarEl)?.scrollTop,
            scrollLeft: findCalendarHorizontalScroller(calendarEl)?.scrollLeft,
        });
    }

    private isSurfaceViewType(viewType: string): boolean {
        return this.surface === "day-sidebar"
            ? viewType === "timeGridDay"
            : viewType === "timeGridWeek" || viewType === "dayGridMonth";
    }

    private cancelViewportRestore(): void {
        if (this.viewportRestoreFrame !== null && this.viewportRestoreWindow) {
            this.viewportRestoreWindow.cancelAnimationFrame(
                this.viewportRestoreFrame
            );
        }
        this.viewportRestoreFrame = null;
        this.viewportRestoreWindow = null;
    }

    private restoreViewport(viewport: CalendarViewportState): void {
        const calendar = this.fullCalendarView;
        const calendarEl = this.calendarEl;
        if (!calendar || !calendarEl) {
            this.pendingViewport = viewport;
            return;
        }
        this.pendingViewport = null;
        const date = parseViewportDate(viewport.date);
        if (!date || !this.isSurfaceViewType(viewport.viewType)) {
            return;
        }

        if (
            viewport.zoomLevel !== null &&
            this.timeGridZoom.setIndex(viewport.zoomLevel, calendarEl)
        ) {
            this.refreshAfterZoomChange(false);
        }
        if (calendar.view.type !== viewport.viewType) {
            calendar.changeView(viewport.viewType, date);
        } else {
            calendar.gotoDate(date);
        }
        // An event note the reader just edited may now live in another week.
        const returnEventDate = this.returnEventDate;
        const { activeStart, activeEnd } = calendar.view;
        if (
            returnEventDate &&
            (returnEventDate < activeStart || returnEventDate >= activeEnd)
        ) {
            calendar.gotoDate(returnEventDate);
        }

        // FullCalendar settles its own initial scroll over the next frames,
        // and the week anchor would recenter the columns; the restored
        // offsets must land last.
        this.cancelWeekAnchor();
        this.cancelViewportRestore();
        const applyScroll = () => {
            const bodyScroller = findCalendarBodyScroller(calendarEl);
            if (bodyScroller) {
                bodyScroller.scrollTop = viewport.scrollTop;
            }
            const horizontalScroller =
                findCalendarHorizontalScroller(calendarEl);
            if (horizontalScroller) {
                horizontalScroller.scrollLeft = viewport.scrollLeft;
            }
        };
        const revealReturnEvent = () => {
            if (!returnEventDate) {
                return;
            }
            this.eventNavigator?.getFocusedEvent()?.scrollIntoView?.({
                block: "nearest",
                inline: "nearest",
            });
        };
        applyScroll();
        const calendarWindow = calendarEl.ownerDocument.defaultView;
        if (!calendarWindow) {
            revealReturnEvent();
            return;
        }
        let remainingFrames = 2;
        const applyOnFrame = () => {
            this.viewportRestoreFrame = null;
            this.viewportRestoreWindow = null;
            if (
                this.fullCalendarView !== calendar ||
                this.calendarEl !== calendarEl
            ) {
                return;
            }
            applyScroll();
            remainingFrames -= 1;
            if (remainingFrames > 0) {
                this.viewportRestoreWindow = calendarWindow;
                this.viewportRestoreFrame =
                    calendarWindow.requestAnimationFrame(applyOnFrame);
                return;
            }
            revealReturnEvent();
        };
        this.viewportRestoreWindow = calendarWindow;
        this.viewportRestoreFrame =
            calendarWindow.requestAnimationFrame(applyOnFrame);
    }

    private canZoom(): boolean {
        return (
            !!this.fullCalendarView &&
            isTimeGridZoomView(this.fullCalendarView.view.type)
        );
    }

    /** Pinch and menu zoom: one level, anchored at a screen y or the center. */
    private stepZoom(
        direction: TimeGridZoomDirection,
        anchorClientY?: number
    ): boolean {
        const calendarEl = this.calendarEl;
        if (!calendarEl || !this.canZoom()) {
            return false;
        }
        const anchor = this.captureZoomAnchor(anchorClientY);
        if (!this.timeGridZoom.step(direction, calendarEl)) {
            return false;
        }
        this.refreshAfterZoomChange();
        this.restoreZoomAnchor(anchor);
        return true;
    }

    private captureZoomAnchor(anchorClientY?: number): {
        scroller: HTMLElement;
        scrollTop: number;
        scrollHeight: number;
        anchorOffset: number;
    } | null {
        const scroller = this.calendarEl
            ? findCalendarBodyScroller(this.calendarEl)
            : null;
        if (!scroller) {
            return null;
        }
        const viewportHeight = scroller.clientHeight;
        const anchorOffset =
            anchorClientY === undefined
                ? viewportHeight / 2
                : Math.max(
                      0,
                      Math.min(
                          viewportHeight,
                          anchorClientY - scroller.getBoundingClientRect().top
                      )
                  );
        return {
            scroller,
            scrollTop: scroller.scrollTop,
            scrollHeight: scroller.scrollHeight,
            anchorOffset,
        };
    }

    private restoreZoomAnchor(
        anchor: ReturnType<CalendarView["captureZoomAnchor"]>
    ): void {
        if (!anchor || !anchor.scroller.isConnected) {
            return;
        }
        const scrollTop = getZoomAnchoredScrollTop({
            scrollTop: anchor.scrollTop,
            anchorOffset: anchor.anchorOffset,
            previousScrollHeight: anchor.scrollHeight,
            nextScrollHeight: anchor.scroller.scrollHeight,
        });
        if (scrollTop !== null) {
            anchor.scroller.scrollTop = scrollTop;
        }
    }

    onPaneMenu(menu: Menu, source: string): void {
        super.onPaneMenu(menu, source);
        if (!this.canZoom()) {
            return;
        }
        menu.addItem((item) =>
            item
                .setTitle("Zoom in")
                .setIcon("zoom-in")
                .onClick(() => {
                    this.stepZoom("in");
                })
        );
        menu.addItem((item) =>
            item
                .setTitle("Zoom out")
                .setIcon("zoom-out")
                .onClick(() => {
                    this.stepZoom("out");
                })
        );
    }

    /**
     * Zoom restyles the slot height; FullCalendar must rebuild its slat
     * coordinates, and selection outlines must follow the resized grid.
     */
    private refreshAfterZoomChange(persist = true): void {
        if (this.fullCalendarView) {
            refreshTimeGridLayout(
                this.fullCalendarView,
                this.timeGridZoom.level
            );
            if (this.navigationMode === "insert") {
                this.cellNavigator?.renderSelection();
            } else {
                this.eventNavigator?.syncToView();
            }
        }
        if (persist) {
            this.app.workspace.requestSaveLayout();
        }
    }

    goToDate(date: Date): void {
        this.fullCalendarView?.gotoDate(date);
    }

    navigateView(direction: CalendarPeriodDirection): boolean {
        const calendar = this.fullCalendarView;
        if (!navigateCalendarPeriod(calendar, direction) || !calendar) {
            return false;
        }
        this.focusCalendarRangeBoundary(direction === "next" ? 1 : -1);
        return true;
    }

    private navigateWeeks(delta: number): void {
        const calendar = this.fullCalendarView;
        if (!calendar) {
            return;
        }
        calendar.incrementDate({ weeks: delta });
        this.focusCalendarRangeBoundary(delta);
    }

    private focusCalendarRangeBoundary(delta: number): void {
        if (this.navigationMode === "insert" || !this.fullCalendarView) {
            return;
        }
        const { activeStart, activeEnd } = this.fullCalendarView.view;
        this.eventNavigator?.syncToView(
            delta > 0 ? activeStart : new Date(activeEnd.getTime() - 1)
        );
    }

    private cancelWeekAnchor(): void {
        if (this.weekAnchorAnimationFrame !== null && this.weekAnchorWindow) {
            this.weekAnchorWindow.cancelAnimationFrame(
                this.weekAnchorAnimationFrame
            );
        }
        this.weekAnchorAnimationFrame = null;
        this.weekAnchorWindow = null;
    }

    private scheduleWeekAnchor(): void {
        this.cancelWeekAnchor();
        const calendar = this.fullCalendarView;
        const calendarEl = this.calendarEl;
        if (
            this.surface !== "primary" ||
            !calendar ||
            !calendarEl ||
            calendar.view.type !== "timeGridWeek"
        ) {
            return;
        }

        const scrollAnchorIntoView = () => {
            this.weekAnchorAnimationFrame = null;
            this.weekAnchorWindow = null;
            if (
                this.fullCalendarView !== calendar ||
                this.calendarEl !== calendarEl ||
                calendar.view.type !== "timeGridWeek"
            ) {
                return;
            }
            const focusedEvent = this.eventNavigator?.getFocusedEvent();
            if (focusedEvent) {
                revealCalendarColumn(focusedEvent);
                return;
            }
            scrollCalendarDateIntoView(calendarEl, calendar.getDate());
        };

        const calendarWindow = calendarEl.ownerDocument.defaultView;
        if (!calendarWindow) {
            scrollAnchorIntoView();
            return;
        }
        this.weekAnchorWindow = calendarWindow;
        this.weekAnchorAnimationFrame =
            calendarWindow.requestAnimationFrame(scrollAnchorIntoView);
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
                ...getCalendarColors(
                    color,
                    this.plugin.settings.useDarkTextOnLightEventColors
                ),
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
        return tagColor
            ? {
                  ...input,
                  ...getCalendarColors(
                      tagColor,
                      this.plugin.settings.useDarkTextOnLightEventColors
                  ),
              }
            : input;
    }

    async onOpen(): Promise<void> {
        const startedAt = Date.now();
        this.plugin.diagnostics.info("calendar-view.open.started", {
            surface: this.surface,
        });
        try {
            await this.openCalendar();
            this.plugin.diagnostics.info("calendar-view.open.completed", {
                surface: this.surface,
                durationMs: Date.now() - startedAt,
                layout: this.calendarEl
                    ? collectCalendarRenderDiagnostics(
                          this.calendarEl,
                          this.fullCalendarView
                      )
                    : null,
            });
        } catch (error) {
            this.plugin.diagnostics.error("calendar-view.open.failed", error, {
                surface: this.surface,
                durationMs: Date.now() - startedAt,
                layout: this.calendarEl
                    ? collectCalendarRenderDiagnostics(
                          this.calendarEl,
                          this.fullCalendarView
                      )
                    : null,
            });
            this.renderDiagnosticFailure();
            new Notice(
                "Keyboard Calendar could not render. Open its diagnostic report from the command palette."
            );
        }
    }

    private renderDiagnosticFailure(): void {
        this.contentEl.empty();
        const failure = this.contentEl.createDiv({
            cls: "keyboard-calendar-render-failure",
        });
        failure.createEl("h2", { text: "Calendar could not render" });
        failure.createEl("p", {
            text: "A diagnostic report was saved without note contents or event titles.",
        });
        const actions = failure.createDiv();
        const reportButton = actions.createEl("button", {
            text: "Show diagnostic report",
        });
        reportButton.addEventListener("click", () =>
            this.plugin.showDiagnosticReport()
        );
        const retryButton = actions.createEl("button", { text: "Retry" });
        retryButton.addEventListener("click", () => {
            void this.onOpen();
        });
    }

    private async openCalendar(): Promise<void> {
        await this.plugin.loadSettings();
        this.plugin.diagnostics.info("calendar-view.settings.loaded", {
            surface: this.surface,
            sourceCount: this.plugin.settings.calendarSources.length,
            initialView: this.plugin.settings.initialView,
        });
        if (!this.plugin.cache) {
            this.plugin.diagnostics.warning("calendar-view.cache.missing", {
                surface: this.surface,
            });
            new Notice("Keyboard Calendar event cache not loaded.");
            return;
        }
        const cacheStartedAt = Date.now();
        const cacheWasInitialized = this.plugin.cache.initialized;
        if (!this.plugin.cache.initialized) {
            await this.plugin.cache.populate();
        } else {
            await this.plugin.cache.reconcileFromDisk();
        }
        const cachedSources = this.plugin.cache.getAllEvents();
        this.plugin.diagnostics.info("calendar-view.cache.ready", {
            surface: this.surface,
            operation: cacheWasInitialized ? "reconcile" : "populate",
            durationMs: Date.now() - cacheStartedAt,
            sourceCount: cachedSources.length,
            eventCount: cachedSources.reduce(
                (total, source) => total + source.events.length,
                0
            ),
        });

        const container = this.contentEl;
        container.empty();
        container.addClass(
            "ofc-calendar-view-content",
            `ofc-calendar-view-content-${this.surface}`
        );
        const calendarEl = container.createEl("div", {
            cls: [
                "ofc-calendar-root",
                ...(this.surface === "day-sidebar"
                    ? ["ofc-day-calendar-root"]
                    : []),
            ],
        });
        this.calendarEl = calendarEl;
        this.timeGridZoom.applyTo(calendarEl);
        this.detachPinchZoom?.();
        this.detachPinchZoom = attachPinchZoom(calendarEl, {
            isEnabled: () => this.canZoom(),
            onStep: (direction, focalClientY) => {
                if (this.stepZoom(direction, focalClientY)) {
                    haptic(STEP_HAPTIC_MS);
                }
            },
        });
        this.plugin.diagnostics.info("calendar-view.container.created", {
            surface: this.surface,
            layout: collectCalendarRenderDiagnostics(calendarEl),
        });

        if (this.plugin.settings.calendarSources.length === 0) {
            this.plugin.diagnostics.info("calendar-view.onboarding.rendered", {
                surface: this.surface,
            });
            renderOnboarding(this.app, this.plugin, calendarEl);
            return;
        }

        const returnTarget =
            this.surface === "primary"
                ? this.plugin.eventNoteEditor?.consumeCalendarReturnTarget(
                      this.leaf
                  ) || null
                : null;
        const returnEventId = returnTarget
            ? this.plugin.cache.getEventIdForPath(returnTarget.path)
            : null;
        const returnEvent = returnEventId
            ? this.plugin.cache.getEventById(returnEventId)
            : null;
        const returnEventDate = returnEvent
            ? getSingleEventStartDate(returnEvent)
            : null;
        this.returnEventDate = returnEventDate;

        const sources: LocalMaterializedEventSource[] = this.translateSources();
        this.plugin.diagnostics.info("calendar-view.sources.translated", {
            surface: this.surface,
            sourceCount: sources.length,
            eventCount: sources.reduce(
                (total, source) => total + source.events.length,
                0
            ),
        });

        if (this.fullCalendarView) {
            this.cancelWeekAnchor();
            this.cancelViewportRestore();
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
                    // A phone's sidebar is a drawer that hides the month;
                    // peek at the day over it instead.
                    if (Platform.isMobile && this.surface === "primary") {
                        haptic();
                        this.openDayPeek(date);
                        return;
                    }
                    void this.plugin.activateDayView(date).catch((error) => {
                        console.error(error);
                        new Notice("Could not open the day calendar.");
                    });
                },
                createTimedNote: async (partialEvent, options) => {
                    try {
                        const targetLeaf =
                            this.surface === "day-sidebar"
                                ? this.app.workspace.getMostRecentLeaf(
                                      this.app.workspace.rootSplit
                                  ) || this.app.workspace.getLeaf(false)
                                : this.leaf;
                        await this.plugin.createTimedEventNote(
                            partialEvent,
                            targetLeaf,
                            options
                        );
                    } catch (e) {
                        if (e instanceof Error) {
                            console.error(e);
                            new Notice(e.message);
                        }
                    }
                },
                proposeTimedEvent: Platform.isMobile
                    ? (start, end) => this.proposeTimedEvent(start, end)
                    : undefined,
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
                            this.surface === "day-sidebar"
                                ? openFullNoteForEvent(
                                      this.plugin.cache,
                                      this.app,
                                      eventId
                                  )
                                : this.plugin.openEventNote(eventId, leaf),
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
            variant: this.surface,
            isMobile: Platform.isMobile,
            timeFormat24h: this.plugin.settings.timeFormat24h,
            datesSet: (viewType) => {
                if (
                    this.surface === "primary" &&
                    (viewType === "dayGridMonth" || viewType === "timeGridWeek")
                ) {
                    const priorViewType = this.lastPrimaryViewType;
                    this.lastPrimaryViewType = viewType;
                    if (priorViewType && priorViewType !== viewType) {
                        this.plugin.rememberCalendarView(viewType);
                    }
                }
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
                this.scheduleWeekAnchor();
            },
            eventsSet: () => {
                if (this.navigationMode !== "insert") {
                    this.eventNavigator?.syncToView();
                }
            },
            diagnostic: (event, details) =>
                this.plugin.diagnostics.info(`fullcalendar.${event}`, {
                    surface: this.surface,
                    details,
                }),
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
                        await this.updateEventOccurrence("omit", e.id, date);
                    },
                    attend: async (date) => {
                        await this.updateEventOccurrence("attend", e.id, date);
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
            navigateWeeks: (delta) => this.navigateWeeks(delta),
            useGridNavigation: () =>
                this.fullCalendarView?.view.type === "dayGridMonth",
            requestOmitOccurrence: (eventId, date) =>
                this.requestEventOccurrenceAction("omit", eventId, date),
            requestAttendOccurrence: (eventId, date) =>
                this.requestEventOccurrenceAction("attend", eventId, date),
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
        this.scheduleWeekAnchor();
        if (this.pendingViewport) {
            this.restoreViewport(this.pendingViewport);
        }
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
        this.plugin.diagnostics.info("calendar-view.navigation.ready", {
            surface: this.surface,
            navigationMode: this.navigationMode,
        });
    }

    onResize(): void {
        if (this.fullCalendarView) {
            try {
                this.plugin.diagnostics.info("calendar-view.resize.started", {
                    surface: this.surface,
                    layout: this.calendarEl
                        ? collectCalendarRenderDiagnostics(
                              this.calendarEl,
                              this.fullCalendarView
                          )
                        : null,
                });
                this.fullCalendarView.render();
                if (this.navigationMode === "insert") {
                    this.cellNavigator?.renderSelection();
                } else {
                    this.eventNavigator?.syncToView();
                }
                this.scheduleWeekAnchor();
                this.plugin.diagnostics.info("calendar-view.resize.completed", {
                    surface: this.surface,
                    layout: this.calendarEl
                        ? collectCalendarRenderDiagnostics(
                              this.calendarEl,
                              this.fullCalendarView
                          )
                        : null,
                });
            } catch (error) {
                this.plugin.diagnostics.error(
                    "calendar-view.resize.failed",
                    error,
                    { surface: this.surface }
                );
                throw error;
            }
        }
    }

    async onunload() {
        this.plugin.diagnostics.info("calendar-view.unload.started", {
            surface: this.surface,
        });
        this.cancelWeekAnchor();
        this.cancelViewportRestore();
        this.deleteConfirmationModal?.close();
        this.deleteConfirmationModal = null;
        this.occurrenceConfirmationModal?.close();
        this.occurrenceConfirmationModal = null;
        this.creationModal?.close();
        this.creationModal = null;
        this.dayPeekModal?.close();
        this.dayPeekModal = null;
        this.detachPinchZoom?.();
        this.detachPinchZoom = null;
        this.cellNavigator?.destroy();
        this.cellNavigator = null;
        this.eventNavigator?.destroy();
        this.eventNavigator = null;
        this.modeChipEl?.remove();
        this.modeChipEl = null;
        this.calendarEl = null;
        this.contentEl.removeClass(
            "ofc-calendar-view-content",
            `ofc-calendar-view-content-${this.surface}`
        );
        if (this.fullCalendarView) {
            this.fullCalendarView.destroy();
            this.fullCalendarView = null;
        }
        if (this.callback) {
            this.plugin.cache.off("update", this.callback);
            this.callback = null;
        }
        this.plugin.diagnostics.info("calendar-view.unload.completed", {
            surface: this.surface,
        });
    }
}
