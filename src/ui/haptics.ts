/** Same pulse Obsidian core fires when its own long presses engage. */
export const LONG_PRESS_HAPTIC_MS = 200;
/** A light tick for stepping through discrete levels, such as zoom. */
export const STEP_HAPTIC_MS = 10;

/**
 * Haptic tick. Obsidian's iOS app backs navigator.vibrate with the native
 * haptic engine (core calls it for its own long presses), Android vibrates,
 * and desktop has no motor, so feature-detect and never let it throw.
 */
export function haptic(
    durationMs: number = LONG_PRESS_HAPTIC_MS,
    target: Pick<Navigator, "vibrate"> | undefined = typeof navigator ===
    "undefined"
        ? undefined
        : navigator
): boolean {
    if (typeof target?.vibrate !== "function") {
        return false;
    }
    try {
        return target.vibrate(durationMs);
    } catch (_error) {
        return false;
    }
}
