/**
 * Coordinates the `T` shortcut: bring today on screen without a re-render when
 * it is already visible, then focus the next event that has not passed yet.
 */

export const isDateInCalendarRange = (
    date: Date,
    activeStart: Date,
    activeEnd: Date
): boolean => date >= activeStart && date < activeEnd;

export interface TodayFocusDeps {
    now: () => Date;
    /** Whether today already falls inside the calendar's rendered range. */
    isTodayVisible: () => boolean;
    navigateToToday: () => void;
    /** Focus the next non-passed event; returns false when none exist. */
    focusUpcoming: (now: Date) => boolean;
    /** Horizontal reveal fallback when there is no event to focus. */
    revealToday: (now: Date) => void;
    /**
     * Subscribe to the next calendar render settling. The callback must run
     * asynchronously, never during this call, and the returned function
     * cancels a pending callback.
     */
    afterNavigationSettles: (done: () => void) => () => void;
}

/**
 * Owns the single in-flight `T` request. A newer request or an explicit
 * `cancel` supersedes an older one so a slow render cannot steal focus after
 * the reader has moved on.
 */
export class TodayFocusController {
    private token = 0;
    private cancelSettle: (() => void) | null = null;

    constructor(private readonly deps: TodayFocusDeps) {}

    /** True while a navigation-triggered focus is waiting on the render. */
    isPending(): boolean {
        return this.cancelSettle !== null;
    }

    request(): void {
        const token = ++this.token;
        this.cancelSettle?.();
        this.cancelSettle = null;

        // Today is already rendered: focus without a calendar re-render.
        if (this.deps.isTodayVisible()) {
            this.settle(token);
            return;
        }

        this.cancelSettle = this.deps.afterNavigationSettles(() =>
            this.settle(token)
        );
        this.deps.navigateToToday();
    }

    cancel(): void {
        this.token += 1;
        this.cancelSettle?.();
        this.cancelSettle = null;
    }

    private settle(token: number): void {
        if (token !== this.token) {
            return;
        }
        this.cancelSettle = null;
        const now = this.deps.now();
        if (!this.deps.focusUpcoming(now)) {
            this.deps.revealToday(now);
        }
    }
}
