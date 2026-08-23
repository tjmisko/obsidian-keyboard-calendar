export const DEFAULT_GHOST_EVENT_TAGS = ["ghost"] as const;

const normalizeEventTag = (value: unknown): string | null => {
    if (typeof value !== "string") {
        return null;
    }
    const normalized = value.trim().replace(/^#+/, "").toLowerCase();
    return normalized || null;
};

export function normalizeEventTags(values: readonly unknown[]): string[] {
    const normalized = values.flatMap((value) => {
        const tag = normalizeEventTag(value);
        return tag ? [tag] : [];
    });
    return [...new Set(normalized)];
}

export function decodeGhostEventTags(value: unknown): string[] {
    return Array.isArray(value)
        ? normalizeEventTags(value)
        : [...DEFAULT_GHOST_EVENT_TAGS];
}

export const parseGhostEventTagsInput = (value: string): string[] =>
    normalizeEventTags(value.split(/[,\n]/));

export function eventHasGhostTag(
    eventTags: unknown,
    configuredTags: readonly string[]
): boolean {
    if (!Array.isArray(eventTags) || configuredTags.length === 0) {
        return false;
    }
    const configured = new Set(normalizeEventTags(configuredTags));
    return normalizeEventTags(eventTags).some((tag) => configured.has(tag));
}
