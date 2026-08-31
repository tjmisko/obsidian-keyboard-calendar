export const DEFAULT_GHOST_EVENT_TAGS = ["ghost"] as const;

export interface EventTagColor {
    tag: string;
    color: string;
}

const EVENT_DARK_TEXT_BRIGHTNESS_THRESHOLD = 150;

const parseHexColor = (color: string): [number, number, number] | null => {
    const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color);
    if (!match) {
        return null;
    }
    const hex =
        match[1].length === 3
            ? [...match[1]].map((digit) => `${digit}${digit}`).join("")
            : match[1];
    return [0, 2, 4].map((offset) =>
        Number.parseInt(hex.slice(offset, offset + 2), 16)
    ) as [number, number, number];
};

export const resolveEventTextColor = (
    backgroundColor: string | null | undefined,
    useDarkTextOnLightEventColors: boolean
): "black" | "white" => {
    if (!useDarkTextOnLightEventColors || !backgroundColor) {
        return "white";
    }
    const rgb = parseHexColor(backgroundColor);
    if (!rgb) {
        return "white";
    }
    const [red, green, blue] = rgb;
    const brightness = (red * 299 + green * 587 + blue * 114) / 1000;
    return brightness > EVENT_DARK_TEXT_BRIGHTNESS_THRESHOLD
        ? "black"
        : "white";
};

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
