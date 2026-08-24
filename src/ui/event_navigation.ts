import type { WorkspaceLeaf } from "obsidian";
import {
    CalendarCellDirection,
    getCalendarCellDirection,
} from "./cell_navigation";

export const CALENDAR_EVENT_NAVIGATION_SELECTOR = "[data-ofc-event-start]";

const MAX_OPERATION_COUNT = 9999;

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
}

/** Owns event focus while the calendar is in normal mode. */
export class CalendarEventNavigator {
    private enabled = false;
    private focusedEvent: HTMLElement | null = null;
    private anchorDate: Date | null = null;
    private pendingCount = "";
    private readonly now: () => Date;

    constructor(
        private readonly containerEl: HTMLElement,
        options: CalendarEventNavigatorOptions = {}
    ) {
        this.now = options.now || (() => new Date());
    }

    activate(preferredDate: Date = this.now()): void {
        this.enabled = true;
        this.pendingCount = "";
        this.anchorDate = new Date(preferredDate);
        this.containerEl.classList.add("ofc-event-navigation-active");
        this.syncToView(preferredDate);
    }

    deactivate(): void {
        this.enabled = false;
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

    getFocusedEvent(): HTMLElement | null {
        return this.focusedEvent;
    }

    getFocusedDate(): Date | null {
        const date = this.focusedEvent
            ? parseEventDate(this.focusedEvent, "ofcEventStart")
            : this.anchorDate;
        return date ? new Date(date) : null;
    }

    syncToView(preferredDate?: Date): boolean {
        if (!this.enabled) {
            return false;
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

    handleKey(key: string, repeat = false): boolean {
        if (!this.enabled) {
            return false;
        }
        if (this.captureCount(key, repeat)) {
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

    private getEventElements(): HTMLElement[] {
        return Array.from(
            this.containerEl.querySelectorAll<HTMLElement>(
                CALENDAR_EVENT_NAVIGATION_SELECTOR
            )
        ).filter((element) => !!parseEventDate(element, "ofcEventStart"));
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
        const start = parseEventDate(element, "ofcEventStart");
        if (start) {
            this.anchorDate = start;
        }
        element.classList.add("ofc-focused-calendar-event");
        element.setAttribute("aria-current", "true");
        element.tabIndex = 0;
        element.focus?.({ preventScroll: true });
        element.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    }

    private clearFocus(): void {
        if (!this.focusedEvent) {
            return;
        }
        this.focusedEvent.classList.remove("ofc-focused-calendar-event");
        this.focusedEvent.removeAttribute("aria-current");
        this.focusedEvent.tabIndex = -1;
        this.focusedEvent = null;
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
