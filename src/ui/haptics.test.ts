import { haptic, LONG_PRESS_HAPTIC_MS } from "./haptics";

describe("haptics", () => {
    it("should pulse through navigator.vibrate when the platform has it", () => {
        const vibrate = jest.fn(() => true);

        expect(haptic(undefined, { vibrate })).toBe(true);
        expect(vibrate).toHaveBeenCalledWith(LONG_PRESS_HAPTIC_MS);
    });

    it("should no-op when the platform has no vibration motor", () => {
        expect(haptic(10, undefined)).toBe(false);
        expect(haptic(10, {} as unknown as Pick<Navigator, "vibrate">)).toBe(
            false
        );
    });

    it("should swallow a throwing vibrate implementation", () => {
        const vibrate = jest.fn(() => {
            throw new Error("blocked by user gesture policy");
        });

        expect(haptic(10, { vibrate })).toBe(false);
    });
});
