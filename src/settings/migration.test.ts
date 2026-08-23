import { Notice } from "obsidian";
import EventCache, { CalendarInitializerMap } from "../core/EventCache";
import {
    CalendarInfo,
    safeParseCalendarInfo,
} from "../types/calendar_settings";
import {
    CALDAV_REMOVAL_VERSION,
    capturePersistedSettings,
    captureRuntimeSettingsBaseline,
    DAILY_NOTE_REMOVAL_VERSION,
    decodeSettings,
    ICS_REMOVAL_VERSION,
    loadMigratedSettings,
    loadMigratedSettingsBeforeRuntime,
    migrateSettings,
    prepareSettingsSave,
    SETTINGS_VERSION,
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

    it("deeply validates nested initial-view state", () => {
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
        ).toEqual({ desktop: "dayGridMonth", mobile: "listWeek" });
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
        ).toEqual({ desktop: "timeGridWeek", mobile: "timeGrid3Days" });
    });

    it("resolves old string and numeric local defaults", () => {
        const calendarSources = [legacyIcs, local("Work"), local("Home")];
        expect(
            decodeSettings(
                { calendarSources, defaultCalendar: 2 },
                undefined,
                jest.fn()
            ).settings.defaultCalendar
        ).toBe("local::Home");
        expect(
            decodeSettings(
                { calendarSources, defaultCalendar: "Work" },
                undefined,
                jest.fn()
            ).settings.defaultCalendar
        ).toBe("local::Work");
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
            ).settings.defaultCalendar
        ).toBe("local::Indexed");
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
            decodeSettings(input, undefined, jest.fn()).settings.defaultCalendar
        ).toBe("local::First");
    });
});

describe("active removed-source migration", () => {
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
        expect(first.settings.defaultCalendar).toBe("local::Events");
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

    it("boots removed-source-only data through cache population with no adapter effect", async () => {
        const forbiddenAdapterEffect = jest.fn(() => null);
        const initializers: CalendarInitializerMap = {
            local: forbiddenAdapterEffect,
            FOR_TEST_ONLY: forbiddenAdapterEffect,
        };
        const cache = new EventCache(initializers);

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
        expect(cache.calendars.size).toBe(0);
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

    it("makes no persistence call for already-v4 settings", async () => {
        const first = migrateSettings(
            { calendarSources: [legacyCalDav, local()] },
            jest.fn()
        );
        const persist = jest.fn(async () => undefined);
        const second = await loadMigratedSettings(
            async () => first.settings,
            persist,
            jest.fn()
        );

        expect(second.saveRequested).toBe(false);
        expect(second.settings).toEqual(first.settings);
        expect(persist).not.toHaveBeenCalled();
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
        loaded.settings.calendarSources.push(local("Work"));

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
        ).toEqual(["Events", "Work"]);
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

    it("keeps successive in-place source and nested-view edits observable", () => {
        const input = {
            calendarSources: [local("Events")],
            initialView: { desktop: "timeGridWeek", mobile: "timeGrid3Days" },
        };
        const current = decodeSettings(input, undefined, jest.fn()).settings;
        const baseline = captureRuntimeSettingsBaseline(current);
        current.calendarSources.push(local("Work"));
        current.initialView.desktop = "dayGridMonth";

        const first = prepareSettingsSave(input, baseline, current);
        current.calendarSources.push(local("Personal"));
        current.initialView.mobile = "listWeek";
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
        ).toEqual(["local", "local", "local"]);
        expect(second.persisted.initialView).toEqual({
            desktop: "dayGridMonth",
            mobile: "listWeek",
        });
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
