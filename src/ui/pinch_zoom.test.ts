import {
    attachPinchZoom,
    getTouchDistance,
    getTouchMidpointY,
    PinchZoomTracker,
} from "./pinch_zoom";

type Listener = (event: unknown) => void;

const makeElement = () => {
    const listeners = new Map<string, Listener>();
    return {
        listeners,
        addEventListener: jest.fn((type: string, listener: Listener) =>
            listeners.set(type, listener)
        ),
        removeEventListener: jest.fn((type: string) => listeners.delete(type)),
        fire(type: string, event: unknown) {
            listeners.get(type)?.(event);
        },
    };
};

const touch = (clientX: number, clientY: number, target?: unknown) => ({
    clientX,
    clientY,
    target,
});

describe("pinch zoom tracker", () => {
    it("should step in once the spread passes the step ratio", () => {
        const tracker = new PinchZoomTracker(1.25);
        tracker.start(100);

        expect(tracker.move(120)).toBe(0);
        expect(tracker.move(126)).toBe(1);
        expect(tracker.move(130)).toBe(0);
    });

    it("should step out when fingers squeeze together", () => {
        const tracker = new PinchZoomTracker(1.25);
        tracker.start(100);

        expect(tracker.move(79)).toBe(-1);
    });

    it("should report several levels for a fast pinch in one frame", () => {
        const tracker = new PinchZoomTracker(1.25);
        tracker.start(100);

        expect(tracker.move(100 * 1.25 * 1.25 * 1.25 + 1)).toBe(3);
    });

    it("should re-base after a step so reversing responds immediately", () => {
        const tracker = new PinchZoomTracker(1.25);
        tracker.start(100);
        expect(tracker.move(126)).toBe(1);

        expect(tracker.move(99)).toBe(-1);
    });

    it("should ignore movement before start, after end, and degenerate distances", () => {
        const tracker = new PinchZoomTracker(1.25);
        expect(tracker.move(500)).toBe(0);

        tracker.start(0);
        expect(tracker.active).toBe(false);
        tracker.start(100);
        expect(tracker.move(0)).toBe(0);
        expect(tracker.move(NaN)).toBe(0);
        tracker.end();
        expect(tracker.move(500)).toBe(0);
    });

    it("should measure touch distance and vertical midpoint", () => {
        expect(getTouchDistance(touch(0, 0), touch(3, 4))).toBe(5);
        expect(getTouchMidpointY(touch(0, 100), touch(0, 300))).toBe(200);
    });
});

describe("pinch zoom gesture", () => {
    it("should cancel FullCalendar's pending touch and step at the midpoint", () => {
        const element = makeElement();
        const onStep = jest.fn();
        attachPinchZoom(element as unknown as HTMLElement, {
            isEnabled: () => true,
            onStep,
        });
        const firstTarget = { dispatchEvent: jest.fn() };

        element.fire("touchstart", {
            touches: [touch(100, 100, firstTarget), touch(100, 200)],
        });
        const preventDefault = jest.fn();
        element.fire("touchmove", {
            touches: [touch(100, 60), touch(100, 240)],
            preventDefault,
        });

        expect(firstTarget.dispatchEvent).toHaveBeenCalledWith(
            expect.objectContaining({ type: "touchcancel", bubbles: false })
        );
        expect(preventDefault).toHaveBeenCalled();
        expect(onStep).toHaveBeenCalledTimes(2);
        expect(onStep).toHaveBeenCalledWith("in", 150);
    });

    it("should leave one-finger scrolling and disabled views alone", () => {
        const element = makeElement();
        const onStep = jest.fn();
        let enabled = true;
        attachPinchZoom(element as unknown as HTMLElement, {
            isEnabled: () => enabled,
            onStep,
        });
        const preventDefault = jest.fn();

        element.fire("touchstart", { touches: [touch(0, 0)] });
        element.fire("touchmove", {
            touches: [touch(0, 300)],
            preventDefault,
        });
        enabled = false;
        element.fire("touchstart", {
            touches: [touch(0, 0), touch(0, 100)],
        });
        element.fire("touchmove", {
            touches: [touch(0, 0), touch(0, 400)],
            preventDefault,
        });

        expect(preventDefault).not.toHaveBeenCalled();
        expect(onStep).not.toHaveBeenCalled();
    });

    it("should stop tracking when a finger lifts mid-pinch", () => {
        const element = makeElement();
        const onStep = jest.fn();
        attachPinchZoom(element as unknown as HTMLElement, {
            isEnabled: () => true,
            onStep,
        });

        element.fire("touchstart", {
            touches: [touch(0, 0, { dispatchEvent: jest.fn() }), touch(0, 100)],
        });
        element.fire("touchend", { touches: [touch(0, 0)] });
        element.fire("touchmove", {
            touches: [touch(0, 0), touch(0, 400)],
            preventDefault: jest.fn(),
        });

        expect(onStep).not.toHaveBeenCalled();
    });

    it("should remove every listener on detach", () => {
        const element = makeElement();
        const detach = attachPinchZoom(element as unknown as HTMLElement, {
            isEnabled: () => true,
            onStep: jest.fn(),
        });

        detach();

        expect(element.listeners.size).toBe(0);
    });
});
