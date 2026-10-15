import {
    isDateInCalendarRange,
    TodayFocusController,
} from "./today_navigation";

interface Harness {
    controller: TodayFocusController;
    navigateToToday: jest.Mock;
    focusUpcoming: jest.Mock;
    revealToday: jest.Mock;
    settleCallbacks: Array<() => void>;
    cancels: jest.Mock[];
    setVisible: (visible: boolean) => void;
}

const createHarness = (): Harness => {
    let visible = false;
    const settleCallbacks: Array<() => void> = [];
    const cancels: jest.Mock[] = [];
    let navigateToToday: jest.Mock;
    let focusUpcoming: jest.Mock;
    let revealToday: jest.Mock;

    navigateToToday = jest.fn();
    focusUpcoming = jest.fn(() => true);
    revealToday = jest.fn();

    const controller = new TodayFocusController({
        now: () => new Date(2026, 7, 20, 12, 0),
        isTodayVisible: () => visible,
        navigateToToday,
        focusUpcoming,
        revealToday,
        afterNavigationSettles: (done) => {
            settleCallbacks.push(done);
            const cancel = jest.fn();
            cancels.push(cancel);
            return cancel;
        },
    });

    return {
        controller,
        navigateToToday,
        focusUpcoming,
        revealToday,
        settleCallbacks,
        cancels,
        setVisible: (value) => {
            visible = value;
        },
    };
};

describe("isDateInCalendarRange", () => {
    it("includes the start and excludes the end of the range", () => {
        const start = new Date(2026, 7, 17);
        const end = new Date(2026, 7, 24);

        expect(isDateInCalendarRange(new Date(2026, 7, 17), start, end)).toBe(
            true
        );
        expect(
            isDateInCalendarRange(new Date(2026, 7, 23, 23, 59), start, end)
        ).toBe(true);
        expect(isDateInCalendarRange(new Date(2026, 7, 24), start, end)).toBe(
            false
        );
        expect(isDateInCalendarRange(new Date(2026, 7, 16), start, end)).toBe(
            false
        );
    });
});

describe("TodayFocusController", () => {
    it("skips navigation and focuses when today is already visible", () => {
        const harness = createHarness();
        harness.setVisible(true);

        harness.controller.request();

        expect(harness.navigateToToday).not.toHaveBeenCalled();
        expect(harness.focusUpcoming).toHaveBeenCalledWith(
            new Date(2026, 7, 20, 12, 0)
        );
        expect(harness.revealToday).not.toHaveBeenCalled();
        expect(harness.controller.isPending()).toBe(false);
    });

    it("navigates first and waits for the render before focusing", () => {
        const harness = createHarness();

        harness.controller.request();

        expect(harness.navigateToToday).toHaveBeenCalledTimes(1);
        expect(harness.focusUpcoming).not.toHaveBeenCalled();
        expect(harness.controller.isPending()).toBe(true);

        harness.settleCallbacks[harness.settleCallbacks.length - 1]();

        expect(harness.focusUpcoming).toHaveBeenCalledTimes(1);
        expect(harness.controller.isPending()).toBe(false);
    });

    it("reveals today when no event can be focused", () => {
        const harness = createHarness();
        harness.focusUpcoming.mockReturnValue(false);

        harness.controller.request();
        harness.settleCallbacks[0]();

        expect(harness.revealToday).toHaveBeenCalledWith(
            new Date(2026, 7, 20, 12, 0)
        );
    });

    it("ignores a superseded settle and only focuses the latest request", () => {
        const harness = createHarness();

        harness.controller.request();
        const firstSettle = harness.settleCallbacks[0];
        harness.controller.request();
        const secondSettle = harness.settleCallbacks[1];

        firstSettle();
        secondSettle();

        expect(harness.focusUpcoming).toHaveBeenCalledTimes(1);
        expect(harness.cancels[0]).toHaveBeenCalledTimes(1);
    });

    it("cancels a pending reveal", () => {
        const harness = createHarness();

        harness.controller.request();
        harness.controller.cancel();
        harness.settleCallbacks[0]();

        expect(harness.focusUpcoming).not.toHaveBeenCalled();
        expect(harness.revealToday).not.toHaveBeenCalled();
        expect(harness.controller.isPending()).toBe(false);
        expect(harness.cancels[0]).toHaveBeenCalledTimes(1);
    });
});
