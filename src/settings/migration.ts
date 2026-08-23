import {
    CalendarInfo,
    fullNoteSourceId,
    parseCalendarInfo,
    resolveDefaultFullNoteCalendar,
} from "../types/calendar_settings";

export const CALDAV_REMOVAL_VERSION = 2;
export const SETTINGS_VERSION = CALDAV_REMOVAL_VERSION;

export type PersistedSourceType = "local" | "ical" | "caldav" | "dailynote";
export type SourceTypeBucket = PersistedSourceType | "unknown";

export interface FullCalendarSettings {
    calendarSources: CalendarInfo[];
    defaultCalendar: string;
    firstDay: number;
    initialView: {
        desktop: string;
        mobile: string;
    };
    timeFormat24h: boolean;
    clickToCreateEventFromMonthView: boolean;
}

export const DEFAULT_SETTINGS: FullCalendarSettings = {
    calendarSources: [],
    defaultCalendar: "",
    firstDay: 0,
    initialView: {
        desktop: "timeGridWeek",
        mobile: "timeGrid3Days",
    },
    timeFormat24h: false,
    clickToCreateEventFromMonthView: true,
};

export type SourceCounts = Record<
    SourceTypeBucket,
    { seen: number; accepted: number; rejected: number }
>;

export interface SettingsDecodeReport {
    rootWasObject: boolean;
    sourcesWereArray: boolean;
    sourceCounts: SourceCounts;
}

export interface RedactedLegacyEnvelope {
    legacyType: PersistedSourceType;
    removedAtVersion: number;
}

export interface MigratedSettings extends FullCalendarSettings {
    settingsVersion: number;
    redactedLegacySources: RedactedLegacyEnvelope[];
}

export interface MigrationResult {
    settings: MigratedSettings;
    report: SettingsDecodeReport;
    changed: boolean;
    saveRequested: boolean;
}

export interface SettingsSavePreparation {
    persisted: Record<string, unknown>;
    changed: boolean;
    runtimeBaseline: FullCalendarSettings;
}

const SOURCE_TYPES: readonly PersistedSourceType[] = [
    "local",
    "ical",
    "caldav",
    "dailynote",
];
const RUNTIME_SOURCE_TYPES: readonly PersistedSourceType[] = [
    "local",
    "ical",
    "dailynote",
];

const DESKTOP_VIEWS = new Set([
    "timeGridDay",
    "timeGridWeek",
    "dayGridMonth",
    "listWeek",
]);
const MOBILE_VIEWS = new Set(["timeGrid3Days", "timeGridDay", "listWeek"]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

export const bucketSourceType = (value: unknown): SourceTypeBucket => {
    if (!isRecord(value) || typeof value.type !== "string") {
        return "unknown";
    }
    return SOURCE_TYPES.includes(value.type as PersistedSourceType)
        ? (value.type as PersistedSourceType)
        : "unknown";
};

const emptySourceCounts = (): SourceCounts => ({
    local: { seen: 0, accepted: 0, rejected: 0 },
    ical: { seen: 0, accepted: 0, rejected: 0 },
    caldav: { seen: 0, accepted: 0, rejected: 0 },
    dailynote: { seen: 0, accepted: 0, rejected: 0 },
    unknown: { seen: 0, accepted: 0, rejected: 0 },
});

const readInitialView = (
    value: unknown
): FullCalendarSettings["initialView"] => {
    if (!isRecord(value)) {
        return { ...DEFAULT_SETTINGS.initialView };
    }
    return {
        desktop:
            typeof value.desktop === "string" &&
            DESKTOP_VIEWS.has(value.desktop)
                ? value.desktop
                : DEFAULT_SETTINGS.initialView.desktop,
        mobile:
            typeof value.mobile === "string" && MOBILE_VIEWS.has(value.mobile)
                ? value.mobile
                : DEFAULT_SETTINGS.initialView.mobile,
    };
};

const readRedactedLegacySources = (
    value: unknown
): RedactedLegacyEnvelope[] => {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.flatMap((entry) => {
        if (
            !isRecord(entry) ||
            !SOURCE_TYPES.includes(entry.legacyType as PersistedSourceType) ||
            typeof entry.removedAtVersion !== "number" ||
            !Number.isInteger(entry.removedAtVersion)
        ) {
            return [];
        }
        return [
            {
                legacyType: entry.legacyType as PersistedSourceType,
                removedAtVersion: entry.removedAtVersion,
            },
        ];
    });
};

/**
 * Decode saved settings into the narrower set that the current runtime can
 * safely initialize. The input is never mutated and no persistence occurs.
 */
export function decodeSettings(
    input: unknown,
    supportedTypes: readonly PersistedSourceType[] = RUNTIME_SOURCE_TYPES,
    log: (message: string, details: unknown) => void = console.debug
): { settings: FullCalendarSettings; report: SettingsDecodeReport } {
    const rootWasObject = isRecord(input);
    const root = rootWasObject ? input : {};
    const sourcesWereArray = Array.isArray(root.calendarSources);
    const rawSources: unknown[] = sourcesWereArray
        ? (root.calendarSources as unknown[])
        : [];
    const sourceCounts = emptySourceCounts();
    const validatedSources: CalendarInfo[] = [];
    const validatedByOriginalPosition: Array<CalendarInfo | null> = [];

    for (const rawSource of rawSources) {
        const bucket = bucketSourceType(rawSource);
        sourceCounts[bucket].seen += 1;
        try {
            const source = parseCalendarInfo(rawSource);
            sourceCounts[bucket].accepted += 1;
            validatedSources.push(source);
            validatedByOriginalPosition.push(source);
        } catch {
            sourceCounts[bucket].rejected += 1;
            validatedByOriginalPosition.push(null);
        }
    }

    // Numeric defaults refer to the original validated ordering. Resolve them
    // before unsupported sources are removed from the runtime set.
    const indexedDefault =
        typeof root.defaultCalendar === "number" &&
        Number.isInteger(root.defaultCalendar)
            ? validatedByOriginalPosition[root.defaultCalendar]
            : null;
    const resolvedBeforeFiltering =
        (indexedDefault?.type === "local"
            ? fullNoteSourceId(indexedDefault)
            : resolveDefaultFullNoteCalendar(
                  typeof root.defaultCalendar === "number"
                      ? undefined
                      : root.defaultCalendar,
                  validatedSources
              )) || "";
    const supported = new Set(supportedTypes);
    const calendarSources = validatedSources.filter(
        (source) =>
            source.type !== "FOR_TEST_ONLY" && supported.has(source.type)
    );
    const supportedLocalIds = calendarSources.flatMap((source) =>
        source.type === "local" ? [fullNoteSourceId(source)] : []
    );
    const defaultCalendar = supportedLocalIds.includes(resolvedBeforeFiltering)
        ? resolvedBeforeFiltering
        : supportedLocalIds[0] || "";

    const settings: FullCalendarSettings = {
        calendarSources,
        defaultCalendar,
        firstDay:
            typeof root.firstDay === "number" &&
            Number.isInteger(root.firstDay) &&
            root.firstDay >= 0 &&
            root.firstDay <= 6
                ? root.firstDay
                : DEFAULT_SETTINGS.firstDay,
        initialView: readInitialView(root.initialView),
        timeFormat24h:
            typeof root.timeFormat24h === "boolean"
                ? root.timeFormat24h
                : DEFAULT_SETTINGS.timeFormat24h,
        clickToCreateEventFromMonthView:
            typeof root.clickToCreateEventFromMonthView === "boolean"
                ? root.clickToCreateEventFromMonthView
                : DEFAULT_SETTINGS.clickToCreateEventFromMonthView,
    };
    const report = { rootWasObject, sourcesWereArray, sourceCounts };
    log("Decoded calendar settings", report);
    return { settings, report };
}

const canonicalJson = (value: unknown): string | undefined =>
    JSON.stringify(value);

const cloneJsonValue = <T>(value: T): T =>
    JSON.parse(JSON.stringify(value)) as T;

const cloneRuntimeSettings = (
    settings: FullCalendarSettings
): FullCalendarSettings => cloneJsonValue(settings);

const RUNTIME_SETTING_KEYS = [
    "calendarSources",
    "defaultCalendar",
    "firstDay",
    "initialView",
    "timeFormat24h",
    "clickToCreateEventFromMonthView",
] as const;

/**
 * Merge explicit runtime setting changes back into the untouched persisted
 * object. Decoder normalization alone must never rewrite a malformed root,
 * numeric default, unsupported source, or credential-bearing current source.
 */
export function prepareSettingsSave(
    input: unknown,
    runtimeBaseline: FullCalendarSettings,
    current: FullCalendarSettings
): SettingsSavePreparation {
    const persisted: Record<string, unknown> = isRecord(input)
        ? cloneJsonValue(input)
        : {};

    for (const key of RUNTIME_SETTING_KEYS) {
        if (
            canonicalJson(runtimeBaseline[key]) !== canonicalJson(current[key])
        ) {
            persisted[key] = cloneJsonValue(current[key]);
        }
    }

    return {
        persisted,
        changed: canonicalJson(input) !== canonicalJson(persisted),
        runtimeBaseline: cloneRuntimeSettings(current),
    };
}

export const captureRuntimeSettingsBaseline = cloneRuntimeSettings;
export const capturePersistedSettings = <T>(settings: T): T =>
    cloneJsonValue(settings);

/**
 * Apply a source-removal migration. Only generated enum/version metadata
 * survives for removed sources.
 */
export function migrateSettings(
    input: unknown,
    removedTypes: readonly PersistedSourceType[],
    targetVersion: number,
    log: (message: string, details: unknown) => void = console.debug
): MigrationResult {
    const { settings: decoded, report } = decodeSettings(
        input,
        RUNTIME_SOURCE_TYPES,
        log
    );
    const removed = new Set(removedTypes);
    const retainedSources = decoded.calendarSources.filter(
        (source) => source.type === "FOR_TEST_ONLY" || !removed.has(source.type)
    );
    const existingEnvelopes = isRecord(input)
        ? readRedactedLegacySources(input.redactedLegacySources)
        : [];
    const rawSources =
        isRecord(input) && Array.isArray(input.calendarSources)
            ? input.calendarSources
            : [];
    // Removed source types no longer exist in CalendarInfo, so recognize them
    // only by their fixed legacy type bucket. No source-provided field is read
    // into the envelope or serialized to diagnostics.
    const newEnvelopes = rawSources.flatMap((source) => {
        const legacyType = bucketSourceType(source);
        return legacyType !== "unknown" && removed.has(legacyType)
            ? [
                  {
                      legacyType,
                      removedAtVersion: targetVersion,
                  } as RedactedLegacyEnvelope,
              ]
            : [];
    });
    const envelopeKeys = new Set<string>();
    const redactedLegacySources = [
        ...existingEnvelopes,
        ...newEnvelopes,
    ].filter((envelope) => {
        const key = `${envelope.legacyType}:${envelope.removedAtVersion}`;
        if (envelopeKeys.has(key)) {
            return false;
        }
        envelopeKeys.add(key);
        return true;
    });
    const retainedDefault = resolveDefaultFullNoteCalendar(
        decoded.defaultCalendar,
        retainedSources
    );
    const existingVersion =
        isRecord(input) &&
        typeof input.settingsVersion === "number" &&
        Number.isInteger(input.settingsVersion)
            ? input.settingsVersion
            : 0;
    const preservedRoot = isRecord(input) ? cloneJsonValue(input) : {};
    const settings: MigratedSettings = {
        ...preservedRoot,
        ...decoded,
        settingsVersion: Math.max(existingVersion, targetVersion),
        calendarSources: retainedSources,
        defaultCalendar: retainedDefault || "",
        redactedLegacySources,
    };
    const changed = canonicalJson(input) !== canonicalJson(settings);
    return { settings, report, changed, saveRequested: changed };
}

/**
 * Load, scrub, and (only when changed) persist settings before callers hand
 * any source list to the runtime cache.
 */
export async function loadMigratedSettings(
    load: () => Promise<unknown>,
    persist: (settings: MigratedSettings) => Promise<void>,
    log: (message: string, details: unknown) => void = console.debug
): Promise<MigrationResult> {
    const loaded = await load();
    const migrated = migrateSettings(
        loaded,
        ["caldav"],
        CALDAV_REMOVAL_VERSION,
        log
    );
    if (migrated.saveRequested) {
        await persist(migrated.settings);
    }
    return migrated;
}

/**
 * Sequence the active settings scrub ahead of runtime initialization. A failed
 * settings write rejects before initialize can run.
 */
export async function loadMigratedSettingsBeforeRuntime(
    load: () => Promise<unknown>,
    persist: (settings: MigratedSettings) => Promise<void>,
    initialize: (settings: MigratedSettings) => void | Promise<void>,
    log: (message: string, details: unknown) => void = console.debug
): Promise<MigrationResult> {
    const migrated = await loadMigratedSettings(load, persist, log);
    await initialize(migrated.settings);
    return migrated;
}
