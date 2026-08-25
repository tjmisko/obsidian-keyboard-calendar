import { Notice } from "obsidian";
import EventCache from "../core/EventCache";
import {
    CalendarInfo,
    safeParseCalendarInfo,
} from "../types/calendar_settings";
import {
    CALDAV_REMOVAL_VERSION,
    capturePersistedSettings,
    captureRuntimeSettingsBaseline,
    commitSettingsBeforeRuntime,
    DAILY_NOTE_REMOVAL_VERSION,
    decodeSettings,
    DESKTOP_ONLY_SETTINGS_VERSION,
    ICS_REMOVAL_VERSION,
    loadMigratedSettings,
    loadMigratedSettingsBeforeRuntime,
    migrateSettings,
    prepareSettingsSave,
    SETTINGS_VERSION,
    SETTINGS_REFRESH_FAILED_NOTICE,
    SINGLE_LOCAL_SOURCE_VERSION,
} from "./migration";
import {
    PHASE4_DAILY_NOTE_EVENTS,
    PHASE4_DAILY_NOTE_FIXTURE,
    PHASE4_FULL_NOTE_EVENTS,
} from "./phase4_dailynote_fixture";

const SENTINELS = {
    name: "SENTINEL_CALDAV_NAME_user@example.test",
    url: "https://sentinel-url.example.test/caldav?token=SENTINEL_URL_TOKEN",
    homeUrl: "https://sentinel-home.example.test/SENTINEL_HOME_TOKEN/",
    username: "SENTINEL_CALDAV_USERNAME",
    password: "SENTINEL_CALDAV_PASSWORD",
    icsUrl: "https://sentinel-ics.example.test/private.ics?token=SENTINEL_ICS_BEARER_TOKEN",
    dailyHeading: "SENTINEL_DAILY_HEADING_user@example.test",
    dailyPath: "Daily/SENTINEL_DAILY_PATH.md",
    dailyBody: "SENTINEL_DAILY_BODY_PRIVATE",
};

const local = (directory = "Events"): CalendarInfo => ({
    type: "local",
    directory,
    color: "#123456",
});
const legacyIcs = {
    type: "ical",
    url: SENTINELS.icsUrl,
    color: "#234567",
};
const legacyCalDav = {
    type: "caldav",
    name: SENTINELS.name,
    url: SENTINELS.url,
    homeUrl: SENTINELS.homeUrl,
    username: SENTINELS.username,
    password: SENTINELS.password,
    color: "#345678",
};
const dailynote = {
    type: "dailynote",
    heading: SENTINELS.dailyHeading,
    color: "#456789",
    path: SENTINELS.dailyPath,
    body: SENTINELS.dailyBody,
};

const serializedLog = (log: { mock: { calls: unknown[][] } }): string =>
    JSON.stringify(log.mock.calls);

const expectNoSentinels = (value: unknown): void => {
    const serialized = JSON.stringify(value);
    for (const sentinel of Object.values(SENTINELS)) {
        expect(serialized).not.toContain(sentinel);
    }
};

const normalizedEventSet = (events: readonly unknown[]): string[] =>
    events.map((event) => JSON.stringify(event)).sort();

describe("settings decoder", () => {
    it.each([
        ["local-only", { calendarSources: [local()] }, ["local"]],
        ["ICS-only", { calendarSources: [legacyIcs] }, []],
        [
            "mixed local/ICS/CalDAV/daily-note",
            {
                calendarSources: [local(), legacyIcs, legacyCalDav, dailynote],
            },
            ["local"],
        ],
        ["CalDAV-only", { calendarSources: [legacyCalDav] }, []],
    ])("loads the %s legacy fixture", (_name, input, expectedTypes) => {
        const original = JSON.stringify(input);
        const result = decodeSettings(input, undefined, jest.fn());
        expect(
            result.settings.calendarSources.map((source) => source.type)
        ).toEqual(expectedTypes);
        expect(JSON.stringify(input)).toBe(original);
    });

    it.each([
        ["missing source list", {}],
        ["null root", null],
        ["array root", []],
        ["primitive root", "invalid"],
        ["null source list", { calendarSources: null }],
        ["object source list", { calendarSources: {} }],
        [
            "malformed members and unknown types",
            {
                calendarSources: [
                    null,
                    [],
                    17,
                    "source",
                    { type: "future-secret-type", token: "discard-me" },
                    { type: "local", directory: 42, color: "red" },
                    local(),
                ],
            },
        ],
    ])("loads the %s fixture without throwing", (_name, input) => {
        const log = jest.fn();
        expect(() => decodeSettings(input, undefined, log)).not.toThrow();
        const { settings, report } = decodeSettings(input, undefined, log);
        expect(Array.isArray(settings.calendarSources)).toBe(true);
        expect(Object.keys(report.sourceCounts).sort()).toEqual(
            ["local", "ical", "caldav", "dailynote", "unknown"].sort()
        );
        expect(serializedLog(log)).not.toContain("future-secret-type");
        expect(serializedLog(log)).not.toContain("discard-me");
    });

    it("classifies a legacy CalDAV source without admitting it to runtime", () => {
        const result = decodeSettings(
            { calendarSources: [legacyCalDav] },
            undefined,
            jest.fn()
        );
        expect(result.settings.calendarSources).toEqual([]);
        expect(result.report.sourceCounts.caldav).toEqual({
            seen: 1,
            accepted: 0,
            rejected: 1,
        });
    });

    it("classifies a legacy ICS source without admitting it to runtime", () => {
        const result = decodeSettings(
            { calendarSources: [legacyIcs] },
            undefined,
            jest.fn()
        );
        expect(result.settings.calendarSources).toEqual([]);
        expect(result.report.sourceCounts.ical).toEqual({
            seen: 1,
            accepted: 0,
            rejected: 1,
        });
    });

    it("classifies a legacy daily-note source without admitting it to runtime", () => {
        const result = decodeSettings(
            { calendarSources: [dailynote] },
            undefined,
            jest.fn()
        );
        expect(result.settings.calendarSources).toEqual([]);
        expect(result.report.sourceCounts.dailynote).toEqual({
            seen: 1,
            accepted: 0,
            rejected: 1,
        });
    });

    it("migrates nested initial-view state to one validated desktop view", () => {
        expect(
            decodeSettings(
                {
                    initialView: {
                        desktop: "dayGridMonth",
                        mobile: "listWeek",
                    },
                },
                undefined,
                jest.fn()
            ).settings.initialView
        ).toBe("dayGridMonth");
        expect(
            decodeSettings(
                {
                    initialView: {
                        desktop: { malicious: true },
                        mobile: "user-controlled-view",
                    },
                },
                undefined,
                jest.fn()
            ).settings.initialView
        ).toBe("timeGridWeek");
        for (const retiredView of ["timeGridDay", "listWeek"]) {
            expect(
                decodeSettings(
                    { initialView: retiredView },
                    undefined,
                    jest.fn()
                ).settings.initialView
            ).toBe("timeGridWeek");
        }
    });

    it("defaults and normalizes the ghost-event tag list", () => {
        expect(
            decodeSettings({}, undefined, jest.fn()).settings.ghostEventTags
        ).toEqual(["ghost"]);
        expect(
            decodeSettings(
                { ghostEventTags: [" Jen ", "#SKIP", "jen", 42] },
                undefined,
                jest.fn()
            ).settings.ghostEventTags
        ).toEqual(["jen", "skip"]);
        expect(
            decodeSettings({ ghostEventTags: [] }, undefined, jest.fn())
                .settings.ghostEventTags
        ).toEqual([]);
    });

    it("defaults and normalizes event tag color rules", () => {
        expect(
            decodeSettings({}, undefined, jest.fn()).settings.eventTagColors
        ).toEqual([]);
        expect(
            decodeSettings(
                {
                    eventTagColors: [
                        { tag: " #Work ", color: "#AABBCC" },
                        { tag: "work", color: "#000000" },
                        { tag: "broken", color: "red" },
                    ],
                },
                undefined,
                jest.fn()
            ).settings.eventTagColors
        ).toEqual([{ tag: "work", color: "#aabbcc" }]);
    });

    it("resolves old string and numeric local defaults", () => {
        const calendarSources = [legacyIcs, local("Work"), local("Home")];
        expect(
            decodeSettings(
                { calendarSources, defaultCalendar: 2 },
                undefined,
                jest.fn()
            ).settings.calendarSources
        ).toEqual([local("Home")]);
        expect(
            decodeSettings(
                { calendarSources, defaultCalendar: "Work" },
                undefined,
                jest.fn()
            ).settings.calendarSources
        ).toEqual([local("Work")]);
    });

    it("keeps numeric defaults tied to the original raw source slot", () => {
        const calendarSources = [
            legacyCalDav,
            { type: "local", directory: 42, color: "red" },
            legacyIcs,
            { type: "removed-source", token: "discard-me" },
            local("Indexed"),
            local("Fallback"),
        ];
        expect(
            decodeSettings(
                { calendarSources, defaultCalendar: 4 },
                undefined,
                jest.fn()
            ).settings.calendarSources
        ).toEqual([local("Indexed")]);
    });

    it("filters removed sources before runtime initialization", () => {
        const settings = decodeSettings(
            {
                calendarSources: [legacyCalDav, dailynote, local(), legacyIcs],
            },
            undefined,
            jest.fn()
        ).settings;
        expect(settings.calendarSources.map((source) => source.type)).toEqual([
            "local",
        ]);
    });

    it("uses a deterministic local fallback", () => {
        const input = {
            calendarSources: [local("First"), local("Second")],
            defaultCalendar: 99,
        };
        expect(
            decodeSettings(input, undefined, jest.fn()).settings.calendarSources
        ).toEqual([local("First")]);
    });
});

describe("active removed-source migration", () => {
    it("adds current tag defaults and remains idempotent", () => {
        const input = {
            settingsVersion: DESKTOP_ONLY_SETTINGS_VERSION,
            calendarSources: [local("Events")],
            initialView: "timeGridWeek",
        };

        const first = migrateSettings(input, jest.fn());

        expect(first.settings.settingsVersion).toBe(SETTINGS_VERSION);
        expect(first.settings.ghostEventTags).toEqual(["ghost"]);
        expect(first.settings.eventTagColors).toEqual([]);
        expect(first.saveRequested).toBe(true);

        const second = migrateSettings(first.settings, jest.fn());
        expect(second.settings).toEqual(first.settings);
        expect(second.saveRequested).toBe(false);
    });

    it("upgrades v5 nested views to one desktop-only value and is idempotent", () => {
        const input = {
            settingsVersion: SINGLE_LOCAL_SOURCE_VERSION,
            calendarSources: [local("Events")],
            initialView: { desktop: "dayGridMonth", mobile: "listWeek" },
            unrelated: { retained: true },
        };
        const original = JSON.stringify(input);

        const first = migrateSettings(input, jest.fn());

        expect(JSON.stringify(input)).toBe(original);
        expect(first.settings.settingsVersion).toBe(SETTINGS_VERSION);
        expect(first.settings.initialView).toBe("dayGridMonth");
        expect(JSON.stringify(first.settings)).not.toContain("mobile");
        expect((first.settings as any).unrelated).toEqual({ retained: true });
        expect(first.saveRequested).toBe(true);

        const second = migrateSettings(first.settings, jest.fn());
        expect(second.settings).toEqual(first.settings);
        expect(second.saveRequested).toBe(false);
    });

    it("scrubs stale nested views at current and future versions without downgrading", () => {
        for (const settingsVersion of [SETTINGS_VERSION, 17]) {
            const migrated = migrateSettings(
                {
                    settingsVersion,
                    calendarSources: [local("Events")],
                    initialView: {
                        desktop: "listWeek",
                        mobile: "timeGrid3Days",
                    },
                    legacySidebarMigrationVersion: 17,
                    redactedLegacySources: [
                        { legacyType: "ical", removedAtVersion: 12 },
                    ],
                    unrelated: { future: true },
                },
                jest.fn()
            );

            expect(migrated.settings.settingsVersion).toBe(settingsVersion);
            expect(migrated.settings.initialView).toBe("timeGridWeek");
            expect(migrated.settings.legacySidebarMigrationVersion).toBe(17);
            expect(migrated.settings.redactedLegacySources).toEqual([
                { legacyType: "ical", removedAtVersion: 12 },
            ]);
            expect((migrated.settings as any).unrelated).toEqual({
                future: true,
            });
            expect(JSON.stringify(migrated.settings)).not.toContain("mobile");
            expect(migrated.saveRequested).toBe(true);
        }
    });

    it("normalizes an invalid bridge marker without treating it as completion", () => {
        const migrated = migrateSettings(
            {
                settingsVersion: SETTINGS_VERSION,
                calendarSources: [local("Events")],
                initialView: "timeGridWeek",
                legacySidebarMigrationVersion: "not-a-version",
            },
            jest.fn()
        );

        expect(migrated.settings).not.toHaveProperty(
            "legacySidebarMigrationVersion"
        );
        expect(migrated.saveRequested).toBe(true);
    });

    it("selects the legacy default local and redacts only discarded local configuration", () => {
        const input = {
            settingsVersion: DAILY_NOTE_REMOVAL_VERSION,
            calendarSources: [local("DiscardedFolderSentinel"), local("Keep")],
            defaultCalendar: "local::Keep",
            initialView: { desktop: "dayGridMonth", mobile: "listWeek" },
            unrelated: { retained: true },
        };

        const migrated = migrateSettings(input, jest.fn());

        expect(migrated.settings.calendarSources).toEqual([local("Keep")]);
        expect(migrated.settings).not.toHaveProperty("defaultCalendar");
        expect(migrated.settings.initialView).toBe("dayGridMonth");
        expect((migrated.settings as any).unrelated).toEqual({
            retained: true,
        });
        expect(migrated.settings.redactedLegacySources).toEqual([
            {
                legacyType: "local",
                removedAtVersion: SINGLE_LOCAL_SOURCE_VERSION,
            },
        ]);
        expect(JSON.stringify(migrated.settings)).not.toContain(
            "DiscardedFolderSentinel"
        );
    });

    it("uses the numeric default's original mixed raw slot", () => {
        const migrated = migrateSettings(
            {
                calendarSources: [
                    legacyCalDav,
                    { type: "local", directory: 42, color: "red" },
                    legacyIcs,
                    { type: "unknown" },
                    local("Indexed"),
                    local("Fallback"),
                ],
                defaultCalendar: 4,
            },
            jest.fn()
        );

        expect(migrated.settings.calendarSources).toEqual([local("Indexed")]);
        expect(migrated.settings.redactedLegacySources).toEqual([
            { legacyType: "caldav", removedAtVersion: CALDAV_REMOVAL_VERSION },
            { legacyType: "ical", removedAtVersion: ICS_REMOVAL_VERSION },
            {
                legacyType: "local",
                removedAtVersion: SINGLE_LOCAL_SOURCE_VERSION,
            },
        ]);
        expect(migrated.settings).not.toHaveProperty("defaultCalendar");
    });

    it("retains a single legacy vault-root source", () => {
        const migrated = migrateSettings(
            { calendarSources: [local("")], defaultCalendar: "" },
            jest.fn()
        );

        expect(migrated.settings.calendarSources).toEqual([local("")]);
        expect(migrated.settings.redactedLegacySources).toEqual([]);
        expect(migrated.settings).not.toHaveProperty("defaultCalendar");
    });

    it("collapses stale current and future multi-local settings without downgrading", () => {
        const current = migrateSettings(
            {
                settingsVersion: SETTINGS_VERSION,
                calendarSources: [local("First"), local("Second")],
                defaultCalendar: "Second",
            },
            jest.fn()
        );
        const future = migrateSettings(
            {
                settingsVersion: 17,
                calendarSources: [local("First"), local("Second")],
                defaultCalendar: "local::Second",
            },
            jest.fn()
        );

        expect(current.settings.calendarSources).toEqual([local("Second")]);
        expect(current.settings.settingsVersion).toBe(SETTINGS_VERSION);
        expect(future.settings.calendarSources).toEqual([local("Second")]);
        expect(future.settings.settingsVersion).toBe(17);
        expect(current.saveRequested).toBe(true);
        expect(future.saveRequested).toBe(true);
    });

    it("preserves a sanitized future local envelope and adds canonical v5", () => {
        const migrated = migrateSettings(
            {
                settingsVersion: 17,
                calendarSources: [local("First"), local("Second")],
                redactedLegacySources: [
                    {
                        legacyType: "local",
                        removedAtVersion: 12,
                        directory: "ENVELOPE_LOCAL_SENTINEL",
                    },
                ],
            },
            jest.fn()
        );

        expect(migrated.settings.redactedLegacySources).toEqual([
            { legacyType: "local", removedAtVersion: 12 },
            {
                legacyType: "local",
                removedAtVersion: SINGLE_LOCAL_SOURCE_VERSION,
            },
        ]);
        expect(JSON.stringify(migrated.settings)).not.toContain(
            "ENVELOPE_LOCAL_SENTINEL"
        );
    });

    it("redacts every removed source with its canonical version and is idempotent", () => {
        const input = {
            calendarSources: [
                legacyCalDav,
                { type: "local", directory: 42, color: "red" },
                legacyIcs,
                dailynote,
                local("Events"),
            ],
            defaultCalendar: 4,
            initialView: { desktop: "timeGridWeek", mobile: "timeGrid3Days" },
        };
        const original = JSON.stringify(input);
        const log = jest.fn();
        const first = migrateSettings(input, log);

        expect(JSON.stringify(input)).toBe(original);
        expect(first.changed).toBe(true);
        expect(first.saveRequested).toBe(true);
        expect(first.settings.calendarSources).toEqual([local("Events")]);
        expect(first.settings).not.toHaveProperty("defaultCalendar");
        expect(first.settings.redactedLegacySources).toEqual([
            { legacyType: "caldav", removedAtVersion: CALDAV_REMOVAL_VERSION },
            { legacyType: "ical", removedAtVersion: ICS_REMOVAL_VERSION },
            {
                legacyType: "dailynote",
                removedAtVersion: DAILY_NOTE_REMOVAL_VERSION,
            },
        ]);
        expectNoSentinels(first.settings);
        expectNoSentinels(log.mock.calls);
        expectNoSentinels((Notice as any).notices || []);

        const second = migrateSettings(first.settings, log);
        expect(second.settings).toEqual(first.settings);
        expect(JSON.stringify(second.settings)).toBe(
            JSON.stringify(first.settings)
        );
        expect(second.changed).toBe(false);
        expect(second.saveRequested).toBe(false);
    });

    it("uses only a fixed legacy type for malformed removed sources", () => {
        const migrated = migrateSettings(
            {
                calendarSources: [
                    { type: "unknown", password: "UNKNOWN_SENTINEL" },
                    { type: "caldav", password: "MALFORMED_SENTINEL" },
                    { type: "dailynote", heading: SENTINELS.dailyHeading },
                    { type: "dailynote", path: SENTINELS.dailyPath },
                ],
            },
            jest.fn()
        );
        const output = JSON.stringify(migrated.settings);
        expect(output).not.toContain("UNKNOWN_SENTINEL");
        expect(output).not.toContain("MALFORMED_SENTINEL");
        expect(migrated.settings.redactedLegacySources).toEqual([
            { legacyType: "caldav", removedAtVersion: CALDAV_REMOVAL_VERSION },
            {
                legacyType: "dailynote",
                removedAtVersion: DAILY_NOTE_REMOVAL_VERSION,
            },
        ]);
        expectNoSentinels(migrated.settings);
    });

    it("adds daily-note v4 to existing CalDAV v2 and ICS v3 envelopes", () => {
        const migrated = migrateSettings(
            {
                settingsVersion: ICS_REMOVAL_VERSION,
                calendarSources: [dailynote, local()],
                redactedLegacySources: [
                    {
                        legacyType: "caldav",
                        removedAtVersion: CALDAV_REMOVAL_VERSION,
                    },
                    {
                        legacyType: "ical",
                        removedAtVersion: ICS_REMOVAL_VERSION,
                    },
                ],
            },
            jest.fn()
        );

        expect(migrated.settings.settingsVersion).toBe(SETTINGS_VERSION);
        expect(migrated.settings.redactedLegacySources).toEqual([
            { legacyType: "caldav", removedAtVersion: CALDAV_REMOVAL_VERSION },
            { legacyType: "ical", removedAtVersion: ICS_REMOVAL_VERSION },
            {
                legacyType: "dailynote",
                removedAtVersion: DAILY_NOTE_REMOVAL_VERSION,
            },
        ]);
        expectNoSentinels(migrated.settings);
    });

    it("scrubs stale sources at current versions and never downgrades future versions", () => {
        const current = migrateSettings(
            {
                settingsVersion: SETTINGS_VERSION,
                calendarSources: [dailynote],
            },
            jest.fn()
        );
        const future = migrateSettings(
            {
                settingsVersion: 17,
                calendarSources: [legacyCalDav, legacyIcs, dailynote],
            },
            jest.fn()
        );

        expect(current.saveRequested).toBe(true);
        expect(current.settings.settingsVersion).toBe(SETTINGS_VERSION);
        expect(future.saveRequested).toBe(true);
        expect(future.settings.settingsVersion).toBe(17);
        expectNoSentinels(current.settings);
        expectNoSentinels(future.settings);
    });

    it("preserves unrelated top-level settings and sanitizes envelope extras", () => {
        const migrated = migrateSettings(
            {
                customPreference: { enabled: true },
                calendarSources: [legacyCalDav, legacyIcs],
                redactedLegacySources: [
                    {
                        legacyType: "caldav",
                        removedAtVersion: CALDAV_REMOVAL_VERSION,
                        password: "ENVELOPE_EXTRA_SENTINEL",
                    },
                ],
            },
            jest.fn()
        );

        expect((migrated.settings as any).customPreference).toEqual({
            enabled: true,
        });
        expect(JSON.stringify(migrated.settings)).not.toContain(
            "ENVELOPE_EXTRA_SENTINEL"
        );
        expect(migrated.settings.redactedLegacySources).toEqual([
            { legacyType: "caldav", removedAtVersion: CALDAV_REMOVAL_VERSION },
            { legacyType: "ical", removedAtVersion: ICS_REMOVAL_VERSION },
        ]);
    });

    it("preserves safe future envelopes while scrubbing stale raw ICS", () => {
        const first = migrateSettings(
            {
                settingsVersion: 17,
                calendarSources: [legacyIcs],
                redactedLegacySources: [
                    {
                        legacyType: "ical",
                        removedAtVersion: 12,
                        url: "ENVELOPE_URL_SENTINEL",
                    },
                ],
            },
            jest.fn()
        );
        expect(first.settings.settingsVersion).toBe(17);
        expect(first.settings.redactedLegacySources).toEqual([
            { legacyType: "ical", removedAtVersion: 12 },
            { legacyType: "ical", removedAtVersion: ICS_REMOVAL_VERSION },
        ]);
        expect(JSON.stringify(first.settings)).not.toContain(
            "ENVELOPE_URL_SENTINEL"
        );
        expectNoSentinels(first.settings);

        const second = migrateSettings(first.settings, jest.fn());
        expect(second.settings).toEqual(first.settings);
        expect(second.saveRequested).toBe(false);
    });

    it("preserves a safe future daily-note envelope and adds canonical v4", () => {
        const first = migrateSettings(
            {
                settingsVersion: 17,
                calendarSources: [dailynote],
                redactedLegacySources: [
                    {
                        legacyType: "dailynote",
                        removedAtVersion: 12,
                        heading: SENTINELS.dailyHeading,
                    },
                ],
            },
            jest.fn()
        );
        expect(first.settings.settingsVersion).toBe(17);
        expect(first.settings.redactedLegacySources).toEqual([
            { legacyType: "dailynote", removedAtVersion: 12 },
            {
                legacyType: "dailynote",
                removedAtVersion: DAILY_NOTE_REMOVAL_VERSION,
            },
        ]);
        expectNoSentinels(first.settings);

        const second = migrateSettings(first.settings, jest.fn());
        expect(second.settings).toEqual(first.settings);
        expect(second.saveRequested).toBe(false);
    });

    it.each(["icloud", "CalDAV", "CALDAV"])(
        "discards the unsupported %s type without leaking its fields",
        (type) => {
            const migrated = migrateSettings(
                {
                    calendarSources: [
                        { type, password: "UNSUPPORTED_TYPE_SENTINEL" },
                    ],
                },
                jest.fn()
            );
            expect(migrated.settings.calendarSources).toEqual([]);
            expect(migrated.settings.redactedLegacySources).toEqual([]);
            expect(JSON.stringify(migrated.settings)).not.toContain(
                "UNSUPPORTED_TYPE_SENTINEL"
            );
        }
    );

    it.each([
        [
            "mixed",
            {
                calendarSources: [local(), legacyCalDav, legacyIcs, dailynote],
            },
        ],
        ["CalDAV-only", { calendarSources: [legacyCalDav] }],
        ["ICS-only", { calendarSources: [legacyIcs] }],
        ["malformed root", null],
        [
            "malformed members",
            { calendarSources: [null, 42, { type: "caldav" }, local()] },
        ],
    ])(
        "boots the %s fixture after persisting before runtime initialization",
        async (_name, input) => {
            const operations: string[] = [];
            const result = await loadMigratedSettingsBeforeRuntime(
                async () => {
                    operations.push("load");
                    return input;
                },
                async (persisted) => {
                    operations.push("persist");
                    expectNoSentinels(persisted);
                },
                (settings) => {
                    operations.push("cache-reset");
                    for (const source of settings.calendarSources) {
                        expect(source.type).not.toBe("caldav");
                        expect(source.type).not.toBe("ical");
                        expect(source.type).not.toBe("dailynote");
                    }
                },
                jest.fn()
            );
            for (const source of result.settings.calendarSources) {
                expect(source.type).not.toBe("caldav");
                expect(source.type).not.toBe("ical");
                expect(source.type).not.toBe("dailynote");
            }

            expect(operations[0]).toBe("load");
            expect(operations.indexOf("persist")).toBeLessThan(
                operations.indexOf("cache-reset")
            );
        }
    );

    it("notifies once after persistence and before initialization without source fields", async () => {
        (Notice as any).notices = [];
        const operations: string[] = [];
        const first = await loadMigratedSettingsBeforeRuntime(
            async () => {
                operations.push("load");
                return { calendarSources: [dailynote, { ...dailynote }] };
            },
            async () => {
                operations.push("persist");
            },
            () => {
                operations.push("initialize");
            },
            jest.fn(),
            (message) => {
                operations.push("notice");
                new Notice(message);
            }
        );

        expect(operations).toEqual(["load", "persist", "notice", "initialize"]);
        expect((Notice as any).notices).toEqual([
            "A saved daily-note calendar source was removed. Existing daily notes were not changed.",
        ]);
        expectNoSentinels(first.settings);
        expectNoSentinels((Notice as any).notices);

        (Notice as any).notices = [];
        const persist = jest.fn(async () => undefined);
        const notify = jest.fn();
        await loadMigratedSettingsBeforeRuntime(
            async () => first.settings,
            persist,
            async () => undefined,
            jest.fn(),
            notify
        );
        expect(persist).not.toHaveBeenCalled();
        expect(notify).not.toHaveBeenCalled();
    });

    it("persists connector and multi-local redaction before fixed notices and initialization", async () => {
        const operations: string[] = [];
        const notices: string[] = [];
        const result = await loadMigratedSettingsBeforeRuntime(
            async () => {
                operations.push("load");
                return {
                    calendarSources: [
                        legacyCalDav,
                        legacyIcs,
                        dailynote,
                        local("DiscardedLocalSentinel"),
                        local("Keep"),
                    ],
                    defaultCalendar: "Keep",
                };
            },
            async () => {
                operations.push("persist");
            },
            () => {
                operations.push("initialize");
            },
            jest.fn(),
            (message) => {
                operations.push("notice");
                notices.push(message);
            }
        );

        expect(operations).toEqual([
            "load",
            "persist",
            "notice",
            "notice",
            "initialize",
        ]);
        expect(notices).toEqual([
            "A saved daily-note calendar source was removed. Existing daily notes were not changed.",
            "Multiple local calendar sources were reduced to one. Event notes were not changed.",
        ]);
        expect(result.settings.calendarSources).toEqual([local("Keep")]);
        expect(result.settings.redactedLegacySources).toEqual([
            { legacyType: "caldav", removedAtVersion: CALDAV_REMOVAL_VERSION },
            { legacyType: "ical", removedAtVersion: ICS_REMOVAL_VERSION },
            {
                legacyType: "dailynote",
                removedAtVersion: DAILY_NOTE_REMOVAL_VERSION,
            },
            {
                legacyType: "local",
                removedAtVersion: SINGLE_LOCAL_SOURCE_VERSION,
            },
        ]);
        expect(JSON.stringify(result.settings)).not.toContain(
            "DiscardedLocalSentinel"
        );
    });

    it("scrubs a stale legacy default without a multi-local notice", async () => {
        const persist = jest.fn(async () => undefined);
        const notify = jest.fn();
        const first = await loadMigratedSettingsBeforeRuntime(
            async () => ({
                settingsVersion: SETTINGS_VERSION,
                calendarSources: [local("Events")],
                defaultCalendar: "local::Events",
            }),
            persist,
            async () => undefined,
            jest.fn(),
            notify
        );

        expect(persist).toHaveBeenCalledTimes(1);
        expect(notify).not.toHaveBeenCalled();
        expect(first.settings).not.toHaveProperty("defaultCalendar");

        persist.mockClear();
        await loadMigratedSettingsBeforeRuntime(
            async () => first.settings,
            persist,
            async () => undefined,
            jest.fn(),
            notify
        );
        expect(persist).not.toHaveBeenCalled();
        expect(notify).not.toHaveBeenCalled();
    });

    it("does not notify or initialize when the scrubbed settings write fails", async () => {
        const initialize = jest.fn();
        const notify = jest.fn();
        await expect(
            loadMigratedSettingsBeforeRuntime(
                async () => ({ calendarSources: [dailynote] }),
                async () => {
                    throw new Error("synthetic settings write failure");
                },
                initialize,
                jest.fn(),
                notify
            )
        ).rejects.toThrow("synthetic settings write failure");
        expect(notify).not.toHaveBeenCalled();
        expect(initialize).not.toHaveBeenCalled();
    });

    it("does not initialize when the v6 desktop-only migration write fails", async () => {
        const initialize = jest.fn();
        await expect(
            loadMigratedSettingsBeforeRuntime(
                async () => ({
                    settingsVersion: SINGLE_LOCAL_SOURCE_VERSION,
                    calendarSources: [local("Events")],
                    initialView: {
                        desktop: "dayGridMonth",
                        mobile: "listWeek",
                    },
                }),
                async () => {
                    throw new Error("synthetic v6 persistence failure");
                },
                initialize,
                jest.fn()
            )
        ).rejects.toThrow("synthetic v6 persistence failure");
        expect(initialize).not.toHaveBeenCalled();
    });

    it("does not notify, initialize, or invoke note effects when multi-local persistence fails", async () => {
        const initialize = jest.fn();
        const notify = jest.fn();
        const forbiddenNoteEffect = jest.fn();
        await expect(
            loadMigratedSettingsBeforeRuntime(
                async () => ({
                    calendarSources: [local("First"), local("Second")],
                }),
                async () => {
                    throw new Error("synthetic v5 persistence failure");
                },
                (settings) => {
                    initialize(settings);
                    forbiddenNoteEffect();
                },
                jest.fn(),
                notify
            )
        ).rejects.toThrow("synthetic v5 persistence failure");
        expect(notify).not.toHaveBeenCalled();
        expect(initialize).not.toHaveBeenCalled();
        expect(forbiddenNoteEffect).not.toHaveBeenCalled();
    });

    it("boots removed-source-only data through cache population with no adapter effect", async () => {
        const forbiddenAdapterEffect = jest.fn();
        const cache = new EventCache(() => {
            forbiddenAdapterEffect();
            throw new Error("Removed-source data reached the local factory.");
        });

        await expect(
            loadMigratedSettingsBeforeRuntime(
                async () => ({
                    calendarSources: [dailynote],
                }),
                async () => undefined,
                async (settings) => {
                    cache.reset(settings.calendarSources);
                    await cache.populate();
                },
                jest.fn()
            )
        ).resolves.toBeDefined();
        expect(forbiddenAdapterEffect).not.toHaveBeenCalled();
        expect(cache.hasLocalCalendar()).toBe(false);
    });

    it("removes exactly the recorded daily-note set without changing full-note events or note bytes", async () => {
        const originalNoteBytes = PHASE4_DAILY_NOTE_FIXTURE.contents;
        let noteBytes = originalNoteBytes;
        const forbiddenNoteWrite = jest.fn(() => {
            noteBytes = "forbidden mutation";
        });
        const beforeBySource = {
            local: PHASE4_FULL_NOTE_EVENTS,
            dailynote: PHASE4_DAILY_NOTE_EVENTS,
        };
        const before = normalizedEventSet([
            ...beforeBySource.local,
            ...beforeBySource.dailynote,
        ]);

        const migrated = await loadMigratedSettingsBeforeRuntime(
            async () => ({
                calendarSources: [
                    local("Events"),
                    {
                        type: "dailynote",
                        heading: PHASE4_DAILY_NOTE_FIXTURE.heading,
                        color: "#456789",
                    },
                ],
            }),
            async () => undefined,
            async (settings) => {
                // This represents the removed adapter boundary: if a daily-note
                // source reaches runtime, the test deliberately records the
                // forbidden note effects that used to be possible.
                if (
                    settings.calendarSources.some(
                        (source) =>
                            (source as { type: string }).type === "dailynote"
                    )
                ) {
                    forbiddenNoteWrite();
                }
            },
            jest.fn(),
            jest.fn()
        );
        const retainedTypes = new Set(
            migrated.settings.calendarSources.map((source) => source.type)
        );
        const after = normalizedEventSet(
            retainedTypes.has("local") ? beforeBySource.local : []
        );
        const disappeared = before.filter((event) => !after.includes(event));

        expect(disappeared).toEqual(
            normalizedEventSet(PHASE4_DAILY_NOTE_EVENTS)
        );
        expect(after).toEqual(normalizedEventSet(PHASE4_FULL_NOTE_EVENTS));
        expect(noteBytes).toBe(originalNoteBytes);
        expect(forbiddenNoteWrite).not.toHaveBeenCalled();
    });

    it("makes no persistence or notice call for already-v5 single-local settings", async () => {
        const first = migrateSettings(
            { calendarSources: [legacyCalDav, local()] },
            jest.fn()
        );
        const persist = jest.fn(async () => undefined);
        const notify = jest.fn();
        const second = await loadMigratedSettingsBeforeRuntime(
            async () => first.settings,
            persist,
            async () => undefined,
            jest.fn(),
            notify
        );

        expect(second.saveRequested).toBe(false);
        expect(second.settings).toEqual(first.settings);
        expect(persist).not.toHaveBeenCalled();
        expect(notify).not.toHaveBeenCalled();
    });
});

describe("production persistence after migration", () => {
    it("keeps persisted and runtime snapshots distinct after activated load", async () => {
        const loaded = await loadMigratedSettings(
            async () => ({ calendarSources: [local("Events")] }),
            async () => undefined,
            jest.fn()
        );
        const persisted = capturePersistedSettings(loaded.settings);
        const baseline = captureRuntimeSettingsBaseline(loaded.settings);
        loaded.settings.calendarSources = [local("Work")];

        const prepared = prepareSettingsSave(
            persisted,
            baseline,
            loaded.settings
        );
        expect(prepared.changed).toBe(true);
        expect(
            (prepared.persisted.calendarSources as CalendarInfo[]).map(
                (source) => source.type === "local" && source.directory
            )
        ).toEqual(["Work"]);
        expect(
            (persisted.calendarSources as CalendarInfo[]).map(
                (source) => source.type === "local" && source.directory
            )
        ).toEqual(["Events"]);
    });

    it("preserves the version and redacted envelope during unrelated saves", () => {
        const migrated = migrateSettings(
            { calendarSources: [legacyCalDav, local("Events")] },
            jest.fn()
        ).settings;
        const persisted = capturePersistedSettings(migrated);
        const baseline = captureRuntimeSettingsBaseline(migrated);
        migrated.firstDay = 1;

        const prepared = prepareSettingsSave(persisted, baseline, migrated);

        expect(prepared.changed).toBe(true);
        expect(prepared.persisted.firstDay).toBe(1);
        expect(prepared.persisted.settingsVersion).toBe(SETTINGS_VERSION);
        expect(prepared.persisted.redactedLegacySources).toEqual([
            { legacyType: "caldav", removedAtVersion: CALDAV_REMOVAL_VERSION },
        ]);
        expectNoSentinels(prepared.persisted);
    });

    it("omits retired month-click behavior while preserving untouched saved data", () => {
        const persisted = {
            calendarSources: [local("Events")],
            clickToCreateEventFromMonthView: false,
        };
        const current = decodeSettings(
            persisted,
            undefined,
            jest.fn()
        ).settings;
        const baseline = captureRuntimeSettingsBaseline(current);

        expect(current).not.toHaveProperty("clickToCreateEventFromMonthView");
        current.firstDay = 1;
        const prepared = prepareSettingsSave(persisted, baseline, current);

        expect(prepared.persisted.clickToCreateEventFromMonthView).toBe(false);
        expect(prepared.persisted.firstDay).toBe(1);
    });

    it("requests no write when runtime settings are untouched", () => {
        const migrated = migrateSettings(
            { calendarSources: [legacyCalDav, local("Events")] },
            jest.fn()
        ).settings;
        const prepared = prepareSettingsSave(
            migrated,
            captureRuntimeSettingsBaseline(migrated),
            migrated
        );

        expect(prepared.changed).toBe(false);
        expect(prepared.persisted).toEqual(migrated);
    });

    it("never writes the migration-only legacy default key back", () => {
        const current = decodeSettings(
            { calendarSources: [local("Events")] },
            undefined,
            jest.fn()
        ).settings;
        const prepared = prepareSettingsSave(
            {
                ...current,
                defaultCalendar: "local::Events",
            },
            captureRuntimeSettingsBaseline(current),
            current
        );

        expect(prepared.changed).toBe(true);
        expect(prepared.persisted).not.toHaveProperty("defaultCalendar");
    });

    it("keeps successive one-source and desktop-view edits observable", () => {
        const input = {
            calendarSources: [local("Events")],
            initialView: { desktop: "timeGridWeek", mobile: "timeGrid3Days" },
        };
        const current = decodeSettings(input, undefined, jest.fn()).settings;
        const baseline = captureRuntimeSettingsBaseline(current);
        current.calendarSources = [local("Work")];
        current.initialView = "dayGridMonth";

        const first = prepareSettingsSave(input, baseline, current);
        current.calendarSources = [local("Personal")];
        current.initialView = "timeGridWeek";
        const second = prepareSettingsSave(
            first.persisted,
            first.runtimeBaseline,
            current
        );

        expect(second.changed).toBe(true);
        expect(
            (second.persisted.calendarSources as CalendarInfo[]).map(
                (source) => source.type
            )
        ).toEqual(["local"]);
        expect((second.persisted.calendarSources as CalendarInfo[])[0]).toEqual(
            local("Personal")
        );
        expect(second.persisted.initialView).toBe("timeGridWeek");
    });
});

describe("transactional runtime settings updates", () => {
    const currentSettings = () =>
        decodeSettings(
            {
                calendarSources: [local("Events")],
                initialView: "timeGridWeek",
            },
            undefined,
            jest.fn()
        ).settings;

    it("merges the generated sidebar marker without disturbing persisted metadata", () => {
        const persisted = {
            settingsVersion: 17,
            calendarSources: [local("Events")],
            initialView: "timeGridWeek",
            legacySidebarMigrationVersion: 0,
            redactedLegacySources: [
                { legacyType: "ical", removedAtVersion: 12 },
            ],
            unrelated: { retained: true },
        };
        const baseline = decodeSettings(
            persisted,
            undefined,
            jest.fn()
        ).settings;
        const prepared = prepareSettingsSave(persisted, baseline, {
            ...baseline,
            legacySidebarMigrationVersion: 1,
        });

        expect(prepared.persisted).toMatchObject({
            settingsVersion: 17,
            legacySidebarMigrationVersion: 1,
            redactedLegacySources: [
                { legacyType: "ical", removedAtVersion: 12 },
            ],
            unrelated: { retained: true },
        });
        expect(prepared.persisted.calendarSources).toEqual([local("Events")]);
    });

    it("does not commit or refresh when persistence fails", async () => {
        const current = currentSettings();
        const persisted = capturePersistedSettings(current);
        const baseline = captureRuntimeSettingsBaseline(current);
        const commit = jest.fn();
        const refresh = jest.fn();
        const notify = jest.fn();

        await expect(
            commitSettingsBeforeRuntime(
                persisted,
                baseline,
                { ...current, firstDay: 2 },
                async () => {
                    throw new Error("synthetic saveData failure");
                },
                commit,
                refresh,
                jest.fn(),
                notify
            )
        ).rejects.toThrow("synthetic saveData failure");

        expect(commit).not.toHaveBeenCalled();
        expect(refresh).not.toHaveBeenCalled();
        expect(notify).not.toHaveBeenCalled();
        expect(current.firstDay).toBe(0);
        expect(persisted.firstDay).toBe(0);
    });

    it("keeps committed memory and disk aligned when cache refresh fails", async () => {
        const current = currentSettings();
        const persisted = capturePersistedSettings(current);
        const baseline = captureRuntimeSettingsBaseline(current);
        const operations: string[] = [];
        let committedSettings = current;
        let committedPersisted: Record<string, unknown> = { ...persisted };
        const notify = jest.fn();
        const log = jest.fn();

        await expect(
            commitSettingsBeforeRuntime(
                persisted,
                baseline,
                { ...current, firstDay: 3 },
                async () => {
                    operations.push("persist");
                },
                (settings, nextPersisted) => {
                    operations.push("commit");
                    committedSettings = settings;
                    committedPersisted = nextPersisted;
                },
                async () => {
                    operations.push("refresh");
                    throw new Error("synthetic cache failure");
                },
                log,
                notify
            )
        ).resolves.toBeDefined();

        expect(operations).toEqual(["persist", "commit", "refresh"]);
        expect(committedSettings.firstDay).toBe(3);
        expect(committedPersisted.firstDay).toBe(3);
        expect(log).toHaveBeenCalledWith(expect.any(Error));
        expect(notify).toHaveBeenCalledWith(SETTINGS_REFRESH_FAILED_NOTICE);
    });
});

describe("sanitized parsing diagnostics", () => {
    it("never logs the rejected source object or raw type", () => {
        const log = jest.spyOn(console, "debug").mockImplementation(() => {});
        try {
            safeParseCalendarInfo({
                type: "SECRET_TYPE_SENTINEL",
                password: "SECRET_PASSWORD_SENTINEL",
            });
            expect(serializedLog(log)).not.toContain("SECRET_TYPE_SENTINEL");
            expect(serializedLog(log)).not.toContain(
                "SECRET_PASSWORD_SENTINEL"
            );
            expect(log).toHaveBeenCalledWith(
                "Parsing calendar info failed with errors",
                { sourceType: "unknown", issueCount: expect.any(Number) }
            );
        } finally {
            log.mockRestore();
        }
    });
});
