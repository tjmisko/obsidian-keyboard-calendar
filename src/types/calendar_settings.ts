import { ZodError, z } from "zod";
import { OFCEvent } from "./schema";

const calendarOptionsSchema = z.object({
    type: z.literal("local"),
    directory: z.string(),
});

const colorValidator = z.object({ color: z.string() });

export type TestSource = {
    type: "FOR_TEST_ONLY";
    id: string;
    events?: OFCEvent[];
};

export type CalendarInfo = (
    | z.infer<typeof calendarOptionsSchema>
    | TestSource
) &
    z.infer<typeof colorValidator>;

export const fullNoteSourceId = (
    source: Extract<CalendarInfo, { type: "local" }>
): string => `local::${source.directory}`;

export function resolveDefaultFullNoteCalendar(
    defaultCalendar: unknown,
    sources: CalendarInfo[]
): string | null {
    const localSources = sources.filter(
        (source): source is Extract<CalendarInfo, { type: "local" }> =>
            source.type === "local"
    );
    if (localSources.length === 0) {
        return null;
    }

    const localIds = localSources.map(fullNoteSourceId);
    if (
        typeof defaultCalendar === "string" &&
        localIds.includes(defaultCalendar)
    ) {
        return defaultCalendar;
    }

    if (typeof defaultCalendar === "string") {
        const directoryMatch = localSources.find(
            (source) => source.directory === defaultCalendar
        );
        if (directoryMatch) {
            return fullNoteSourceId(directoryMatch);
        }
    }

    if (
        typeof defaultCalendar === "number" &&
        Number.isInteger(defaultCalendar)
    ) {
        const indexedSource = sources[defaultCalendar];
        if (indexedSource?.type === "local") {
            return fullNoteSourceId(indexedSource);
        }
    }

    return localIds[0];
}

export function parseCalendarInfo(obj: unknown): CalendarInfo {
    const options = calendarOptionsSchema.parse(obj);
    const color = colorValidator.parse(obj);

    return { ...options, ...color };
}

export function safeParseCalendarInfo(obj: unknown): CalendarInfo | null {
    try {
        return parseCalendarInfo(obj);
    } catch (e) {
        if (e instanceof ZodError) {
            console.debug("Parsing calendar info failed with errors", {
                sourceType:
                    typeof obj === "object" &&
                    obj !== null &&
                    !Array.isArray(obj) &&
                    ["local"].includes(String((obj as { type?: unknown }).type))
                        ? String((obj as { type?: unknown }).type)
                        : "unknown",
                issueCount: e.issues.length,
            });
        }
        return null;
    }
}

/**
 * Construct a partial calendar source of the specified type
 */
export function makeDefaultPartialCalendarSource(
    type: CalendarInfo["type"]
): Partial<CalendarInfo> {
    return {
        type: type,
        color: getComputedStyle(document.body)
            .getPropertyValue("--interactive-accent")
            .trim(),
    };
}
