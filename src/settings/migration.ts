import {
    CalendarInfo,
    fullNoteSourceId,
    parseCalendarInfo,
    resolveDefaultFullNoteCalendar,
} from "../types/calendar_settings";

export type PersistedSourceType = "local" | "ical" | "caldav" | "dailynote";
export type SourceTypeBucket = PersistedSourceType | "unknown";

export const CALDAV_REMOVAL_VERSION = 2;
export const ICS_REMOVAL_VERSION = 3;
export const DAILY_NOTE_REMOVAL_VERSION = 4;
export const SINGLE_LOCAL_SOURCE_VERSION = 5;
export const DESKTOP_ONLY_SETTINGS_VERSION = 6;
export const SETTINGS_VERSION = DESKTOP_ONLY_SETTINGS_VERSION;

export const REMOVED_SOURCE_VERSIONS: Readonly<
    Partial<Record<PersistedSourceType, number>>
> = {
    caldav: CALDAV_REMOVAL_VERSION,
    ical: ICS_REMOVAL_VERSION,
    dailynote: DAILY_NOTE_REMOVAL_VERSION,
};

export interface FullCalendarSettings {
    calendarSources: CalendarInfo[];
    firstDay: number;
    initialView: string;
    timeFormat24h: boolean;
    legacySidebarMigrationVersion?: number;
}

export const DEFAULT_SETTINGS: FullCalendarSettings = {
    calendarSources: [],
    firstDay: 0,
    initialView: "timeGridWeek",
    timeFormat24h: false,
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

export const SETTINGS_REFRESH_FAILED_NOTICE =
    "Settings were saved, but the event cache could not refresh. Restart Obsidian or reset the event cache.";

const SOURCE_TYPES: readonly PersistedSourceType[] = [
    "local",
    "ical",
    "caldav",
    "dailynote",
];
const RUNTIME_SOURCE_TYPES: readonly PersistedSourceType[] = ["local"];

const DESKTOP_VIEWS = new Set([
    "timeGridDay",
    "timeGridWeek",
    "dayGridMonth",
    "listWeek",
]);
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
    const desktop = isRecord(value) ? value.desktop : value;
    return typeof desktop === "string" && DESKTOP_VIEWS.has(desktop)
        ? desktop
        : DEFAULT_SETTINGS.initialView;
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
        const legacyType = entry.legacyType as PersistedSourceType;
        return [
            {
                legacyType,
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
    const supportedSources = validatedSources.filter((source) =>
        supported.has(source.type)
    );
    const selectedLocal = supportedSources.find(
        (source) =>
            source.type === "local" &&
            fullNoteSourceId(source) === resolvedBeforeFiltering
    );
    const fallbackLocal = supportedSources.find(
        (source) => source.type === "local"
    );
    const calendarSources = selectedLocal
        ? [selectedLocal]
        : fallbackLocal
        ? [fallbackLocal]
        : [];

    const legacySidebarMigrationVersion =
        typeof root.legacySidebarMigrationVersion === "number" &&
        Number.isInteger(root.legacySidebarMigrationVersion) &&
        root.legacySidebarMigrationVersion >= 1
            ? root.legacySidebarMigrationVersion
            : undefined;
    const settings: FullCalendarSettings = {
        calendarSources,
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
        ...(legacySidebarMigrationVersion !== undefined && {
            legacySidebarMigrationVersion,
        }),
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
    "firstDay",
    "initialView",
    "timeFormat24h",
    "legacySidebarMigrationVersion",
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
    delete persisted.defaultCalendar;

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

/**
 * Persist an immutable settings candidate before publishing it to runtime.
 * Refresh failures occur after the commit boundary and are reported without
 * rolling memory back away from the saved representation.
 */
export async function commitSettingsBeforeRuntime(
    persistedSettings: unknown,
    runtimeBaseline: FullCalendarSettings,
    nextSettings: FullCalendarSettings,
    persist: (settings: Record<string, unknown>) => Promise<void>,
    commit: (
        settings: FullCalendarSettings,
        persisted: Record<string, unknown>,
        baseline: FullCalendarSettings
    ) => void,
    refresh: (settings: FullCalendarSettings) => void | Promise<void>,
    log: (error: unknown) => void = console.error,
    notify: (message: string) => void = () => undefined
): Promise<SettingsSavePreparation> {
    const candidate = captureRuntimeSettingsBaseline(nextSettings);
    const prepared = prepareSettingsSave(
        persistedSettings,
        runtimeBaseline,
        candidate
    );
    if (prepared.changed) {
        await persist(prepared.persisted);
    }
    commit(candidate, prepared.persisted, prepared.runtimeBaseline);
    try {
        await refresh(candidate);
    } catch (error) {
        log(error);
        notify(SETTINGS_REFRESH_FAILED_NOTICE);
    }
    return prepared;
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
    log: (message: string, details: unknown) => void = console.debug
): MigrationResult {
    const removalVersions = REMOVED_SOURCE_VERSIONS;
    const targetVersion = SETTINGS_VERSION;
    const { settings: decoded, report } = decodeSettings(
        input,
        RUNTIME_SOURCE_TYPES,
        log
    );
    const removed = new Set(
        Object.keys(removalVersions) as PersistedSourceType[]
    );
    const retainedSources = decoded.calendarSources.filter(
        (source) => !removed.has(source.type)
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
        const removedAtVersion =
            legacyType === "unknown" ? undefined : removalVersions[legacyType];
        return removedAtVersion !== undefined
            ? [
                  {
                      legacyType,
                      removedAtVersion,
                  } as RedactedLegacyEnvelope,
              ]
            : [];
    });
    if (report.sourceCounts.local.accepted > 1) {
        newEnvelopes.push({
            legacyType: "local",
            removedAtVersion: SINGLE_LOCAL_SOURCE_VERSION,
        });
    }
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
    const existingVersion =
        isRecord(input) &&
        typeof input.settingsVersion === "number" &&
        Number.isInteger(input.settingsVersion)
            ? input.settingsVersion
            : 0;
    const preservedRoot = isRecord(input) ? cloneJsonValue(input) : {};
    delete preservedRoot.defaultCalendar;
    if (decoded.legacySidebarMigrationVersion === undefined) {
        delete preservedRoot.legacySidebarMigrationVersion;
    }
    const settings: MigratedSettings = {
        ...preservedRoot,
        ...decoded,
        settingsVersion: Math.max(existingVersion, targetVersion),
        calendarSources: retainedSources,
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
    const migrated = migrateSettings(loaded, log);
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
    log: (message: string, details: unknown) => void = console.debug,
    notify: (message: string) => void = () => undefined
): Promise<MigrationResult> {
    const migrated = await loadMigratedSettings(load, persist, log);
    if (migrated.report.sourceCounts.dailynote.seen > 0) {
        notify(
            "A saved daily-note calendar source was removed. Existing daily notes were not changed."
        );
    }
    if (migrated.report.sourceCounts.local.accepted > 1) {
        notify(
            "Multiple local calendar sources were reduced to one. Event notes were not changed."
        );
    }
    await initialize(migrated.settings);
    return migrated;
}
