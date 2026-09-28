import type { TimeGridZoomDirection } from "./calendar_zoom";

/** Finger spread (or squeeze) that moves the grid one zoom level. */
export const PINCH_STEP_RATIO = 1.25;

/**
 * Converts a continuous two-finger spread into discrete zoom steps. Each step
 * re-bases on the distance where it fired, so a slow pinch walks the levels
 * one at a time and reversing direction responds at once.
 */
export class PinchZoomTracker {
    private baseline: number | null = null;

    constructor(private readonly stepRatio = PINCH_STEP_RATIO) {}

    get active(): boolean {
        return this.baseline !== null;
    }

    start(distance: number): void {
        this.baseline =
            Number.isFinite(distance) && distance > 0 ? distance : null;
    }

    /** Signed steps crossed since the last one: positive zooms in. */
    move(distance: number): number {
        if (
            this.baseline === null ||
            !Number.isFinite(distance) ||
            distance <= 0
        ) {
            return 0;
        }
        const levels =
            Math.log(distance / this.baseline) / Math.log(this.stepRatio);
        const steps = levels >= 0 ? Math.floor(levels) : Math.ceil(levels);
        if (steps !== 0) {
            this.baseline *= Math.pow(this.stepRatio, steps);
        }
        return steps;
    }

    end(): void {
        this.baseline = null;
    }
}

interface TouchPoint {
    clientX: number;
    clientY: number;
}

export const getTouchDistance = (a: TouchPoint, b: TouchPoint): number =>
    Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);

export const getTouchMidpointY = (a: TouchPoint, b: TouchPoint): number =>
    (a.clientY + b.clientY) / 2;

export interface PinchZoomOptions {
    /** Whether the current view zooms at all (time grids only). */
    isEnabled: () => boolean;
    /** One level in or out, anchored at the pinch's vertical midpoint. */
    onStep: (direction: TimeGridZoomDirection, focalClientY: number) => void;
}

/**
 * Two-finger pinch on the time grid steps the zoom. Returns a detach function.
 *
 * FullCalendar starts a touch selection once its long-press delay passes
 * whether or not the finger moved, so a pinch held past it would select a
 * slot. When the second finger lands, the first touch's FullCalendar gesture
 * is cancelled through the touchcancel it listens for on the touched element.
 */
export function attachPinchZoom(
    element: HTMLElement,
    options: PinchZoomOptions
): () => void {
    const tracker = new PinchZoomTracker();

    const onTouchStart = (event: TouchEvent) => {
        if (event.touches.length !== 2 || !options.isEnabled()) {
            tracker.end();
            return;
        }
        const [first, second] = [event.touches[0], event.touches[1]];
        first.target?.dispatchEvent(
            new Event("touchcancel", { bubbles: false })
        );
        tracker.start(getTouchDistance(first, second));
    };

    const onTouchMove = (event: TouchEvent) => {
        if (!tracker.active) {
            return;
        }
        if (event.touches.length !== 2) {
            tracker.end();
            return;
        }
        // Own the gesture: no native scroll or page zoom while pinching.
        event.preventDefault();
        const [first, second] = [event.touches[0], event.touches[1]];
        const steps = tracker.move(getTouchDistance(first, second));
        const focalClientY = getTouchMidpointY(first, second);
        for (let index = 0; index < Math.abs(steps); index += 1) {
            options.onStep(steps > 0 ? "in" : "out", focalClientY);
        }
    };

    const onTouchEnd = (event: TouchEvent) => {
        // The synthetic touchcancel above carries no touch list.
        if ((event.touches?.length ?? 0) < 2) {
            tracker.end();
        }
    };

    // WebKit's proprietary gesture events would otherwise zoom the page.
    const onGesture = (event: Event) => {
        if (tracker.active) {
            event.preventDefault();
        }
    };

    element.addEventListener("touchstart", onTouchStart, { passive: true });
    element.addEventListener("touchmove", onTouchMove, { passive: false });
    element.addEventListener("touchend", onTouchEnd, { passive: true });
    element.addEventListener("touchcancel", onTouchEnd, { passive: true });
    element.addEventListener("gesturestart", onGesture);
    element.addEventListener("gesturechange", onGesture);
    return () => {
        tracker.end();
        element.removeEventListener("touchstart", onTouchStart);
        element.removeEventListener("touchmove", onTouchMove);
        element.removeEventListener("touchend", onTouchEnd);
        element.removeEventListener("touchcancel", onTouchEnd);
        element.removeEventListener("gesturestart", onGesture);
        element.removeEventListener("gesturechange", onGesture);
    };
}
