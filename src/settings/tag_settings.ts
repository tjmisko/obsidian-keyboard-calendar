export const DEFAULT_GHOST_EVENT_TAGS = ["ghost"] as const;

export interface EventTagColor {
    tag: string;
    color: string;
}

export const normalizeEventTag = (value: unknown): string | null => {
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

export const parseEventTagInput = (value: string): string | null =>
    normalizeEventTag(value);

const normalizeEventColor = (value: unknown): string | null =>
    typeof value === "string" && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value)
        ? value.toLowerCase()
        : null;

export function decodeEventTagColors(value: unknown): EventTagColor[] {
    if (!Array.isArray(value)) {
        return [];
    }
    const seen = new Set<string>();
    return value.flatMap((entry) => {
        if (typeof entry !== "object" || entry === null) {
            return [];
        }
        const tag = normalizeEventTag((entry as Record<string, unknown>).tag);
        const color = normalizeEventColor(
            (entry as Record<string, unknown>).color
        );
        if (!tag || !color || seen.has(tag)) {
            return [];
        }
        seen.add(tag);
        return [{ tag, color }];
    });
}

/** Resolves the first configured rule matching any event tag. */
export function resolveEventTagColor(
    eventTags: unknown,
    rules: readonly EventTagColor[]
): string | null {
    if (!Array.isArray(eventTags)) {
        return null;
    }
    const tags = new Set(normalizeEventTags(eventTags));
    return rules.find((rule) => tags.has(rule.tag))?.color || null;
}

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
