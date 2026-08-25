import type { WorkspaceLeaf } from "obsidian";
import {
    CALENDAR_CELL_MINUTES,
    CalendarCellDirection,
    CalendarScrollAlignment,
    getCalendarCellDirection,
} from "./cell_navigation";

export const CALENDAR_EVENT_NAVIGATION_SELECTOR = "[data-ofc-event-start]";
export const CALENDAR_KEYDOWN_CAPTURE_OPTIONS = Object.freeze({
    capture: true,
});

const MAX_OPERATION_COUNT = 9999;

export interface CalendarEventGrab {
    eventId: string;
    start: Date;
    end: Date;
}

export type CalendarEventTransformMode = "move" | "scale";

interface CalendarEventTransformState {
    mode: CalendarEventTransformMode;
    original: CalendarEventGrab;
    current: CalendarEventGrab;
}

interface CalendarEventMove {
    before: CalendarEventGrab;
    after: CalendarEventGrab;
}

const copyGrab = (grab: CalendarEventGrab): CalendarEventGrab => ({
    eventId: grab.eventId,
    start: new Date(grab.start),
    end: new Date(grab.end),
});

const copyMove = (move: CalendarEventMove): CalendarEventMove => ({
    before: copyGrab(move.before),
    after: copyGrab(move.after),
});

const grabsMatch = (
    left: CalendarEventGrab,
    right: CalendarEventGrab
): boolean =>
    left.eventId === right.eventId &&
    left.start.getTime() === right.start.getTime() &&
    left.end.getTime() === right.end.getTime();

export const isCalendarMoveRedoShortcut = (
    event: Pick<
        KeyboardEvent,
        "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey"
    >
): boolean =>
    event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    !event.shiftKey &&
    event.key.toLowerCase() === "r";

/** Moves a grabbed event while preserving both endpoints in local time. */
export const moveCalendarEventGrab = (
    grab: CalendarEventGrab,
    direction: CalendarCellDirection,
    count = 1
): CalendarEventGrab => {
    const next = copyGrab(grab);
    const distance = Math.max(1, Math.floor(count));

    if (direction === "left" || direction === "right") {
        const dayOffset = (direction === "left" ? -1 : 1) * distance;
        next.start.setDate(next.start.getDate() + dayOffset);
        next.end.setDate(next.end.getDate() + dayOffset);
        return next;
    }

    const minuteOffset =
        (direction === "up" ? -1 : 1) * CALENDAR_CELL_MINUTES * distance;
    next.start.setMinutes(next.start.getMinutes() + minuteOffset);
    next.end.setMinutes(next.end.getMinutes() + minuteOffset);
    return next;
};

/** Scales an event from its bottom edge, keeping its start fixed. */
export const scaleCalendarEventGrab = (
    grab: CalendarEventGrab,
    direction: "up" | "down",
    count = 1
): CalendarEventGrab => {
    const next = copyGrab(grab);
    const distance = Math.max(1, Math.floor(count));
    const candidateEnd = new Date(next.end);
    candidateEnd.setMinutes(
        candidateEnd.getMinutes() +
            (direction === "up" ? -1 : 1) * CALENDAR_CELL_MINUTES * distance
    );
    const minimumEnd = new Date(next.start);
    minimumEnd.setMinutes(minimumEnd.getMinutes() + CALENDAR_CELL_MINUTES);
    next.end = new Date(Math.max(candidateEnd.getTime(), minimumEnd.getTime()));
    return next;
};

const parseEventDate = (
    element: HTMLElement,
    field: "ofcEventStart" | "ofcEventEnd"
): Date | null => {
    const value = element.dataset[field];
    if (!value) {
        return null;
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
};

const intervalGap = (
    firstStart: number,
    firstEnd: number,
    secondStart: number,
    secondEnd: number
): number => {
    if (firstEnd < secondStart) {
        return secondStart - firstEnd;
    }
    if (secondEnd < firstStart) {
        return firstStart - secondEnd;
    }
    return 0;
};

const center = (start: number, size: number): number => start + size / 2;

/** Selects the visually nearest event strictly in the requested direction. */
export const getDirectionalEventIndex = (
    rects: readonly Pick<DOMRect, "top" | "left" | "width" | "height">[],
    currentIndex: number,
    direction: CalendarCellDirection
): number => {
    const current = rects[currentIndex];
    if (!current) {
        return currentIndex;
    }

    const currentX = center(current.left, current.width);
    const currentY = center(current.top, current.height);
    let bestIndex = currentIndex;
    let bestScore = Number.POSITIVE_INFINITY;

    rects.forEach((candidate, index) => {
        if (index === currentIndex) {
            return;
        }
        const candidateX = center(candidate.left, candidate.width);
        const candidateY = center(candidate.top, candidate.height);
        const primaryDelta =
            direction === "left" || direction === "right"
                ? candidateX - currentX
                : candidateY - currentY;
        const isForward = direction === "right" || direction === "down";
        if (
            (isForward && primaryDelta <= 1) ||
            (!isForward && primaryDelta >= -1)
        ) {
            return;
        }

        const crossGap =
            direction === "left" || direction === "right"
                ? intervalGap(
                      current.top,
                      current.top + current.height,
                      candidate.top,
                      candidate.top + candidate.height
                  )
                : intervalGap(
                      current.left,
                      current.left + current.width,
                      candidate.left,
                      candidate.left + candidate.width
                  );
        const crossCenterDistance =
            direction === "left" || direction === "right"
                ? Math.abs(candidateY - currentY)
                : Math.abs(candidateX - currentX);
        const score =
            Math.abs(primaryDelta) + crossGap * 4 + crossCenterDistance * 0.01;
        if (score < bestScore) {
            bestIndex = index;
            bestScore = score;
        }
    });

    return bestIndex;
};

export interface CalendarEventNavigatorOptions {
    now?: () => Date;
    canGrabEvent?: (eventId: string) => boolean;
    previewGrabbedEvent?: (grab: CalendarEventGrab) => void;
    commitGrabbedEvent?: (grab: CalendarEventGrab) => Promise<boolean>;
    requestDeleteEvent?: (eventId: string) => void;
    yankEvent?: (event: CalendarEventGrab) => void;
    pasteEvent?: (start: Date) => Promise<void>;
    canScaleEvent?: (eventId: string) => boolean;
    onGrabModeChange?: (active: boolean) => void;
    onGrabUnavailable?: () => void;
    onScaleModeChange?: (active: boolean) => void;
    onScaleUnavailable?: () => void;
}

/** Owns event focus while the calendar is in normal mode. */
export class CalendarEventNavigator {
    private enabled = false;
    private focusedEvent: HTMLElement | null = null;
    private anchorDate: Date | null = null;
    private pendingPrefix: "y" | "z" | null = null;
    private pendingCount = "";
    private transformState: CalendarEventTransformState | null = null;
    private persistingMove = false;
    private pastingEvent = false;
    private readonly moveUndoStack: CalendarEventMove[] = [];
    private readonly moveRedoStack: CalendarEventMove[] = [];
    private readonly now: () => Date;
    private readonly canGrabEvent?: (eventId: string) => boolean;
    private readonly previewGrabbedEvent?: (grab: CalendarEventGrab) => void;
    private readonly commitGrabbedEvent?: (
        grab: CalendarEventGrab
    ) => Promise<boolean>;
    private readonly requestDeleteEvent?: (eventId: string) => void;
    private readonly yankEvent?: (event: CalendarEventGrab) => void;
    private readonly pasteEvent?: (start: Date) => Promise<void>;
    private readonly canScaleEvent?: (eventId: string) => boolean;
    private readonly onGrabModeChange?: (active: boolean) => void;
    private readonly onGrabUnavailable?: () => void;
    private readonly onScaleModeChange?: (active: boolean) => void;
    private readonly onScaleUnavailable?: () => void;

    constructor(
        private readonly containerEl: HTMLElement,
        options: CalendarEventNavigatorOptions = {}
    ) {
        this.now = options.now || (() => new Date());
        this.canGrabEvent = options.canGrabEvent;
        this.previewGrabbedEvent = options.previewGrabbedEvent;
        this.commitGrabbedEvent = options.commitGrabbedEvent;
        this.requestDeleteEvent = options.requestDeleteEvent;
        this.yankEvent = options.yankEvent;
        this.pasteEvent = options.pasteEvent;
        this.canScaleEvent = options.canScaleEvent;
        this.onGrabModeChange = options.onGrabModeChange;
        this.onGrabUnavailable = options.onGrabUnavailable;
        this.onScaleModeChange = options.onScaleModeChange;
        this.onScaleUnavailable = options.onScaleUnavailable;
    }

    activate(
        preferredDate: Date = this.now(),
        preferredEventId?: string
    ): void {
        this.enabled = true;
        this.pendingPrefix = null;
        this.pendingCount = "";
        this.anchorDate = new Date(preferredDate);
        this.containerEl.classList.add("ofc-event-navigation-active");
        if (preferredEventId && this.focusEventById(preferredEventId)) {
            return;
        }
        this.syncToView(preferredDate);
    }

    deactivate(): void {
        this.restoreTransformedEvent();
        this.enabled = false;
        this.pendingPrefix = null;
        this.pendingCount = "";
        this.clearFocus();
        this.containerEl.classList.remove("ofc-event-navigation-active");
    }

    destroy(): void {
        this.deactivate();
        this.anchorDate = null;
    }

    isActive(): boolean {
        return this.enabled;
    }

    isGrabbing(): boolean {
        return this.transformState?.mode === "move";
    }

    isScaling(): boolean {
        return this.transformState?.mode === "scale";
    }

    canUndoMove(): boolean {
        return this.moveUndoStack.length > 0;
    }

    canRedoMove(): boolean {
        return this.moveRedoStack.length > 0;
    }

    forgetEvent(eventId: string): void {
        for (const stack of [this.moveUndoStack, this.moveRedoStack]) {
            for (let index = stack.length - 1; index >= 0; index -= 1) {
                if (stack[index].before.eventId === eventId) {
                    stack.splice(index, 1);
                }
            }
        }
    }

    getGrabbedEvent(): CalendarEventGrab | null {
        return this.isGrabbing() && this.transformState
            ? copyGrab(this.transformState.current)
            : null;
    }

    getScaledEvent(): CalendarEventGrab | null {
        return this.isScaling() && this.transformState
            ? copyGrab(this.transformState.current)
            : null;
    }

    getFocusedEvent(): HTMLElement | null {
        return this.focusedEvent;
    }

    getFocusedDate(): Date | null {
        const date =
            this.transformState?.current.start ||
            (this.focusedEvent
                ? parseEventDate(this.focusedEvent, "ofcEventStart")
                : this.anchorDate);
        return date ? new Date(date) : null;
    }

    syncToView(preferredDate?: Date): boolean {
        if (!this.enabled) {
            return false;
        }
        if (
            this.transformState &&
            this.focusEventById(this.transformState.current.eventId)
        ) {
            return true;
        }
        const events = this.getEventElements();
        if (
            !preferredDate &&
            this.focusedEvent &&
            events.includes(this.focusedEvent)
        ) {
            return true;
        }

        const reference = preferredDate || this.anchorDate || this.now();
        this.anchorDate = new Date(reference);
        const nearest = this.getNearestEvent(events, reference);
        if (!nearest) {
            this.clearFocus();
            return false;
        }
        this.focus(nearest);
        return true;
    }

    move(direction: CalendarCellDirection, count = 1): boolean {
        if (!this.enabled) {
            return false;
        }
        const events = this.getEventElements();
        if (events.length === 0) {
            this.clearFocus();
            return true;
        }
        if (!this.focusedEvent || !events.includes(this.focusedEvent)) {
            this.syncToView();
        }
        if (direction === "up" || direction === "down") {
            const orderedEvents = events
                .map((event, domIndex) => ({
                    event,
                    domIndex,
                    start:
                        parseEventDate(event, "ofcEventStart")?.getTime() || 0,
                }))
                .sort(
                    (left, right) =>
                        left.start - right.start ||
                        left.domIndex - right.domIndex
                )
                .map(({ event }) => event);
            const currentIndex = this.focusedEvent
                ? orderedEvents.indexOf(this.focusedEvent)
                : -1;
            if (currentIndex < 0) {
                return true;
            }
            const offset = (direction === "down" ? 1 : -1) * count;
            const nextIndex = Math.max(
                0,
                Math.min(orderedEvents.length - 1, currentIndex + offset)
            );
            this.focus(orderedEvents[nextIndex]);
            return true;
        }

        let currentIndex = this.focusedEvent
            ? events.indexOf(this.focusedEvent)
            : -1;
        if (currentIndex < 0) {
            return true;
        }

        const rects = events.map((event) => event.getBoundingClientRect());
        for (let step = 0; step < count; step += 1) {
            const nextIndex = getDirectionalEventIndex(
                rects,
                currentIndex,
                direction
            );
            if (nextIndex === currentIndex) {
                break;
            }
            currentIndex = nextIndex;
        }
        this.focus(events[currentIndex]);
        return true;
    }

    openFocusedEvent(repeat = false): boolean {
        if (!this.enabled || !this.focusedEvent) {
            return false;
        }
        if (!repeat) {
            this.focusedEvent.click();
        }
        return true;
    }

    alignFocusedEvent(alignment: CalendarScrollAlignment): boolean {
        if (!this.enabled) {
            return false;
        }
        const events = this.getEventElements();
        if (!this.focusedEvent || !events.includes(this.focusedEvent)) {
            this.syncToView();
        }
        if (!this.focusedEvent) {
            return false;
        }
        this.focusedEvent.scrollIntoView?.({
            block: alignment,
            inline: "nearest",
        });
        return true;
    }

    requestFocusedEventDeletion(repeat = false): boolean {
        if (!this.enabled || !this.focusedEvent) {
            return false;
        }
        const eventId = this.focusedEvent.dataset.ofcEventId;
        if (!eventId) {
            return false;
        }
        if (!repeat) {
            this.requestDeleteEvent?.(eventId);
        }
        return true;
    }

    yankFocusedEvent(repeat = false): boolean {
        if (!this.enabled || !this.focusedEvent) {
            return false;
        }
        const eventId = this.focusedEvent.dataset.ofcEventId;
        const start = parseEventDate(this.focusedEvent, "ofcEventStart");
        const end = parseEventDate(this.focusedEvent, "ofcEventEnd");
        if (!eventId || !start || !end) {
            return false;
        }
        if (!repeat) {
            this.yankEvent?.({ eventId, start, end });
        }
        return true;
    }

    async pasteAtFocusedEvent(): Promise<boolean> {
        const start = this.getFocusedDate();
        if (!this.enabled || !start || this.pastingEvent) {
            return false;
        }
        this.pastingEvent = true;
        try {
            await this.pasteEvent?.(start);
        } catch (error) {
            console.error(error);
        } finally {
            this.pastingEvent = false;
        }
        return true;
    }

    beginGrab(): boolean {
        return this.beginTransform("move");
    }

    beginScale(): boolean {
        return this.beginTransform("scale");
    }

    private beginTransform(mode: CalendarEventTransformMode): boolean {
        if (
            !this.enabled ||
            !this.focusedEvent ||
            this.transformState ||
            this.persistingMove
        ) {
            return false;
        }
        const eventId = this.focusedEvent.dataset.ofcEventId;
        const start = parseEventDate(this.focusedEvent, "ofcEventStart");
        const end = parseEventDate(this.focusedEvent, "ofcEventEnd");
        if (!eventId || !start || !end) {
            return false;
        }
        const canTransform =
            mode === "move"
                ? this.canGrabEvent
                : this.canScaleEvent || this.canGrabEvent;
        if (canTransform && !canTransform(eventId)) {
            if (mode === "move") {
                this.onGrabUnavailable?.();
            } else {
                this.onScaleUnavailable?.();
            }
            return false;
        }

        const original = { eventId, start, end };
        this.transformState = {
            mode,
            original: copyGrab(original),
            current: copyGrab(original),
        };
        this.pendingCount = "";
        this.containerEl.classList.add(
            mode === "move" ? "ofc-event-grab-active" : "ofc-event-scale-active"
        );
        this.markFocusedEventAsTransformed();
        if (mode === "move") {
            this.onGrabModeChange?.(true);
        } else {
            this.onScaleModeChange?.(true);
        }
        return true;
    }

    moveGrabbedEvent(direction: CalendarCellDirection, count = 1): boolean {
        if (!this.isGrabbing() || !this.transformState || this.persistingMove) {
            return false;
        }
        this.transformState.current = moveCalendarEventGrab(
            this.transformState.current,
            direction,
            count
        );
        this.previewTransformedEvent();
        return true;
    }

    scaleGrabbedEvent(direction: CalendarCellDirection, count = 1): boolean {
        if (
            !this.isScaling() ||
            !this.transformState ||
            this.persistingMove ||
            (direction !== "up" && direction !== "down")
        ) {
            return false;
        }
        this.transformState.current = scaleCalendarEventGrab(
            this.transformState.current,
            direction,
            count
        );
        this.previewTransformedEvent();
        return true;
    }

    private previewTransformedEvent(): void {
        if (!this.transformState) {
            return;
        }
        this.anchorDate = new Date(this.transformState.current.start);
        this.previewGrabbedEvent?.(copyGrab(this.transformState.current));
        this.focusEventById(this.transformState.current.eventId);
    }

    private restoreTransformedEvent(): boolean {
        if (!this.transformState || this.persistingMove) {
            return false;
        }
        const original = copyGrab(this.transformState.original);
        this.previewGrabbedEvent?.(original);
        this.finishTransform(original);
        return true;
    }

    async confirmGrabbedEvent(): Promise<boolean> {
        if (!this.isGrabbing()) {
            return false;
        }
        return this.confirmTransformedEvent();
    }

    async confirmScaledEvent(): Promise<boolean> {
        if (!this.isScaling()) {
            return false;
        }
        return this.confirmTransformedEvent();
    }

    private async confirmTransformedEvent(): Promise<boolean> {
        if (!this.transformState || this.persistingMove) {
            return false;
        }
        const current = copyGrab(this.transformState.current);
        const original = copyGrab(this.transformState.original);
        if (grabsMatch(original, current)) {
            this.finishTransform(current);
            return true;
        }

        this.persistingMove = true;
        const didCommit = await this.persistGrab(current);
        this.persistingMove = false;

        if (!didCommit) {
            this.previewGrabbedEvent?.(original);
        } else {
            this.moveUndoStack.push({ before: original, after: current });
            this.moveRedoStack.length = 0;
        }
        this.finishTransform(didCommit ? current : original);
        return true;
    }

    async undoMove(count = 1): Promise<boolean> {
        return this.applyMoveHistory("undo", count);
    }

    async redoMove(count = 1): Promise<boolean> {
        return this.applyMoveHistory("redo", count);
    }

    handleKey(key: string, repeat = false): boolean {
        if (!this.enabled) {
            return false;
        }
        if (this.persistingMove || this.pastingEvent) {
            return true;
        }
        if (this.pendingPrefix) {
            return this.handlePrefixKey(key, repeat);
        }
        if (this.transformState) {
            return this.handleTransformKey(key, repeat);
        }
        if (this.captureCount(key, repeat)) {
            return true;
        }
        if (key === "m") {
            this.pendingCount = "";
            if (!repeat) {
                this.beginGrab();
            }
            return true;
        }
        if (key === "s") {
            this.pendingCount = "";
            if (!repeat) {
                this.beginScale();
            }
            return true;
        }
        if (key === "u" || key === "U") {
            const count = this.takeCount();
            if (!repeat) {
                void (key === "u"
                    ? this.undoMove(count)
                    : this.redoMove(count));
            }
            return true;
        }
        if (key === "Delete" || key === "x") {
            this.pendingCount = "";
            this.requestFocusedEventDeletion(repeat);
            return true;
        }
        if (key === "y") {
            this.pendingCount = "";
            if (!repeat) {
                this.pendingPrefix = "y";
            }
            return true;
        }
        if (key === "p") {
            this.pendingCount = "";
            if (!repeat) {
                void this.pasteAtFocusedEvent();
            }
            return true;
        }
        if (key.toLowerCase() === "z") {
            this.pendingCount = "";
            if (!repeat) {
                this.pendingPrefix = "z";
            }
            return true;
        }
        const direction = getCalendarCellDirection(key);
        if (direction) {
            return this.move(direction, this.takeCount());
        }
        if (key === "Enter") {
            this.pendingCount = "";
            return this.openFocusedEvent(repeat);
        }
        return this.discardCount();
    }

    private handleTransformKey(key: string, repeat: boolean): boolean {
        if (this.persistingMove) {
            return true;
        }
        if (this.captureCount(key, repeat)) {
            return true;
        }
        if (key === "Escape") {
            this.pendingCount = "";
            if (!repeat) {
                void this.confirmActiveTransform();
            }
            return true;
        }
        if (key === "Enter") {
            this.pendingCount = "";
            if (!repeat) {
                void this.confirmActiveTransform();
            }
            return true;
        }
        if (key.toLowerCase() === "z") {
            this.pendingCount = "";
            if (!repeat) {
                this.pendingPrefix = "z";
            }
            return true;
        }
        const direction = getCalendarCellDirection(key);
        if (direction) {
            const count = this.takeCount();
            if (this.isGrabbing()) {
                return this.moveGrabbedEvent(direction, count);
            }
            if (direction === "up" || direction === "down") {
                return this.scaleGrabbedEvent(direction, count);
            }
            // Scaling is anchored at the top edge, so horizontal movement is
            // intentionally consumed without changing the event.
            return true;
        }

        // Transform modes are modal: unrelated unmodified keys must not
        // trigger normal-mode commands such as insert, today, or view cycling.
        this.pendingCount = "";
        return true;
    }

    private confirmActiveTransform(): Promise<boolean> {
        return this.isScaling()
            ? this.confirmScaledEvent()
            : this.confirmGrabbedEvent();
    }

    private handlePrefixKey(key: string, repeat: boolean): boolean {
        if (repeat) {
            return true;
        }
        const prefix = this.pendingPrefix;
        this.pendingPrefix = null;
        this.pendingCount = "";
        if (prefix === "y") {
            if (key === "y") {
                this.yankFocusedEvent();
            }
            return true;
        }
        switch (key.toLowerCase()) {
            case "z":
                this.alignFocusedEvent("center");
                return true;
            case "t":
                this.alignFocusedEvent("start");
                return true;
            case "b":
                this.alignFocusedEvent("end");
                return true;
            default:
                return true;
        }
    }

    private async persistGrab(grab: CalendarEventGrab): Promise<boolean> {
        try {
            return this.commitGrabbedEvent
                ? await this.commitGrabbedEvent(copyGrab(grab))
                : true;
        } catch (error) {
            console.error(error);
            return false;
        }
    }

    private async applyMoveHistory(
        direction: "undo" | "redo",
        count: number
    ): Promise<boolean> {
        if (!this.enabled || this.transformState || this.persistingMove) {
            return false;
        }
        const source =
            direction === "undo" ? this.moveUndoStack : this.moveRedoStack;
        const destination =
            direction === "undo" ? this.moveRedoStack : this.moveUndoStack;
        const operationCount = Math.max(1, Math.floor(count));
        let focusTarget: CalendarEventGrab | null = null;

        this.persistingMove = true;
        try {
            for (let index = 0; index < operationCount; index += 1) {
                const move = source[source.length - 1];
                if (!move) {
                    break;
                }
                const target = copyGrab(
                    direction === "undo" ? move.before : move.after
                );
                const fallback = copyGrab(
                    direction === "undo" ? move.after : move.before
                );
                this.previewGrabbedEvent?.(target);
                if (!(await this.persistGrab(target))) {
                    this.previewGrabbedEvent?.(fallback);
                    break;
                }
                source.pop();
                destination.push(copyMove(move));
                focusTarget = target;
            }
        } finally {
            this.persistingMove = false;
        }

        if (focusTarget) {
            this.focusMoveTarget(focusTarget);
        }
        return focusTarget !== null;
    }

    private getEventElements(): HTMLElement[] {
        return Array.from(
            this.containerEl.querySelectorAll<HTMLElement>(
                CALENDAR_EVENT_NAVIGATION_SELECTOR
            )
        ).filter((element) => !!parseEventDate(element, "ofcEventStart"));
    }

    private focusEventById(eventId: string): boolean {
        const event = this.getEventElements().find(
            (element) => element.dataset.ofcEventId === eventId
        );
        if (!event) {
            return false;
        }
        this.focus(event);
        return true;
    }

    private getNearestEvent(
        events: readonly HTMLElement[],
        reference: Date
    ): HTMLElement | null {
        const referenceTime = reference.getTime();
        let nearest: HTMLElement | null = null;
        let nearestDistance = Number.POSITIVE_INFINITY;
        let nearestStartDistance = Number.POSITIVE_INFINITY;

        events.forEach((element) => {
            const start = parseEventDate(element, "ofcEventStart");
            if (!start) {
                return;
            }
            const end = parseEventDate(element, "ofcEventEnd") || start;
            const startTime = start.getTime();
            const endTime = Math.max(startTime, end.getTime());
            const distance =
                referenceTime < startTime
                    ? startTime - referenceTime
                    : referenceTime > endTime
                    ? referenceTime - endTime
                    : 0;
            const startDistance = Math.abs(startTime - referenceTime);
            if (
                distance < nearestDistance ||
                (distance === nearestDistance &&
                    startDistance < nearestStartDistance)
            ) {
                nearest = element;
                nearestDistance = distance;
                nearestStartDistance = startDistance;
            }
        });

        return nearest;
    }

    private focus(element: HTMLElement): void {
        if (this.focusedEvent !== element) {
            this.clearFocus();
        }
        this.focusedEvent = element;
        const transformedStart =
            this.transformState &&
            element.dataset.ofcEventId === this.transformState.current.eventId
                ? this.transformState.current.start
                : null;
        const start =
            transformedStart || parseEventDate(element, "ofcEventStart");
        if (start) {
            this.anchorDate = start;
        }
        element.classList.add("ofc-focused-calendar-event");
        element.setAttribute("aria-current", "true");
        element.tabIndex = 0;
        this.markFocusedEventAsTransformed();
        element.focus?.({ preventScroll: true });
        element.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    }

    private clearFocus(): void {
        if (!this.focusedEvent) {
            return;
        }
        const focusedEvent = this.focusedEvent;
        this.focusedEvent = null;
        focusedEvent.classList.remove("ofc-focused-calendar-event");
        focusedEvent.classList.remove("ofc-grabbed-calendar-event");
        focusedEvent.classList.remove("ofc-scaled-calendar-event");
        focusedEvent.removeAttribute("aria-current");
        focusedEvent.removeAttribute("aria-grabbed");
        focusedEvent.tabIndex = -1;
        focusedEvent.blur();
    }

    private markFocusedEventAsTransformed(): void {
        const transformState = this.transformState;
        if (
            !this.focusedEvent ||
            !transformState ||
            this.focusedEvent.dataset.ofcEventId !==
                transformState.current.eventId
        ) {
            return;
        }
        if (transformState.mode === "move") {
            this.focusedEvent.classList.add("ofc-grabbed-calendar-event");
            this.focusedEvent.setAttribute("aria-grabbed", "true");
        } else {
            this.focusedEvent.classList.add("ofc-scaled-calendar-event");
        }
    }

    private finishTransform(focusTarget: CalendarEventGrab): void {
        const mode = this.transformState?.mode;
        this.transformState = null;
        this.pendingPrefix = null;
        this.pendingCount = "";
        this.containerEl.classList.remove("ofc-event-grab-active");
        this.containerEl.classList.remove("ofc-event-scale-active");
        this.focusedEvent?.classList.remove("ofc-grabbed-calendar-event");
        this.focusedEvent?.classList.remove("ofc-scaled-calendar-event");
        this.focusedEvent?.removeAttribute("aria-grabbed");
        this.focusMoveTarget(focusTarget);
        if (mode === "move") {
            this.onGrabModeChange?.(false);
        } else if (mode === "scale") {
            this.onScaleModeChange?.(false);
        }
    }

    private focusMoveTarget(focusTarget: CalendarEventGrab): void {
        if (this.enabled && !this.focusEventById(focusTarget.eventId)) {
            this.syncToView(focusTarget.start);
        }
        // A reused FullCalendar element can briefly retain its old dataset
        // during a render, so keep the persisted target authoritative.
        this.anchorDate = new Date(focusTarget.start);
    }

    private captureCount(key: string, repeat: boolean): boolean {
        if (!/^\d$/.test(key) || (key === "0" && !this.pendingCount)) {
            return false;
        }
        if (!repeat && this.pendingCount.length < 4) {
            this.pendingCount += key;
        }
        return true;
    }

    private takeCount(): number {
        const count = this.pendingCount
            ? Math.min(MAX_OPERATION_COUNT, Number(this.pendingCount))
            : 1;
        this.pendingCount = "";
        return count;
    }

    private discardCount(): boolean {
        if (!this.pendingCount) {
            return false;
        }
        this.pendingCount = "";
        return true;
    }
}

interface CalendarEventNavigation {
    eventId: string;
    originatingLeaf: WorkspaceLeaf;
    modified: boolean;
    openModified: (eventId: string) => Promise<boolean>;
    openInOriginatingLeaf: (
        eventId: string,
        leaf: WorkspaceLeaf
    ) => Promise<boolean>;
}

/** Test seam for the distinct modifier-click and same-leaf navigation paths. */
export async function navigateFromCalendarEvent({
    eventId,
    originatingLeaf,
    modified,
    openModified,
    openInOriginatingLeaf,
}: CalendarEventNavigation): Promise<boolean> {
    if (modified) {
        return openModified(eventId);
    }
    return openInOriginatingLeaf(eventId, originatingLeaf);
}
