import { Notice } from "obsidian";
import {
    CalendarInfo,
    safeParseCalendarInfo,
} from "../types/calendar_settings";
import {
    CALDAV_REMOVAL_VERSION,
    captureRuntimeSettingsBaseline,
    decodeSettings,
    migrateSettings,
    prepareSettingsSave,
} from "./migration";

const SENTINELS = {
    name: "SENTINEL_CALDAV_NAME_user@example.test",
    url: "https://sentinel-url.example.test/caldav?token=SENTINEL_URL_TOKEN",
    username: "SENTINEL_CALDAV_USERNAME",
    password: "SENTINEL_CALDAV_PASSWORD",
};

const local = (directory = "Events"): CalendarInfo => ({
    type: "local",
    directory,
    color: "#123456",
});
const ical: CalendarInfo = {
    type: "ical",
    url: "https://example.test/public-calendar.ics",
    color: "#234567",
};
const caldav: CalendarInfo = {
    type: "caldav",
    name: SENTINELS.name,
    url: SENTINELS.url,
    homeUrl: "https://example.test/home/",
    username: SENTINELS.username,
    password: SENTINELS.password,
    color: "#345678",
};
const dailynote: CalendarInfo = {
    type: "dailynote",
    heading: "Calendar",
    color: "#456789",
};

const serializedLog = (log: { mock: { calls: unknown[][] } }): string =>
    JSON.stringify(log.mock.calls);

describe("settings decoder", () => {
    it.each([
        ["local-only", { calendarSources: [local()] }, ["local"]],
        ["ICS-only", { calendarSources: [ical] }, ["ical"]],
        [
            "mixed local/ICS/CalDAV/daily-note",
            { calendarSources: [local(), ical, caldav, dailynote] },
            ["local", "ical", "caldav", "dailynote"],
        ],
        ["CalDAV-only", { calendarSources: [caldav] }, ["caldav"]],
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
        const calendarSources = [ical, local("Work"), local("Home")];
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
            { type: "local", directory: 42, color: "red" },
            { type: "removed-source", token: "discard-me" },
            local("Indexed"),
            local("Fallback"),
        ];
        expect(
            decodeSettings(
                { calendarSources, defaultCalendar: 2 },
                undefined,
                jest.fn()
            ).settings.defaultCalendar
        ).toBe("local::Indexed");
    });

    it("filters unsupported sources before runtime initialization", () => {
        const settings = decodeSettings(
            { calendarSources: [caldav, dailynote, local(), ical] },
            ["local", "ical"],
            jest.fn()
        ).settings;
        expect(settings.calendarSources.map((source) => source.type)).toEqual([
            "local",
            "ical",
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

describe("pure inactive credential-removal migration", () => {
    it("redacts every source-provided CalDAV field and is idempotent", () => {
        const input = {
            calendarSources: [caldav, local("Events")],
            defaultCalendar: 1,
            initialView: { desktop: "timeGridWeek", mobile: "timeGrid3Days" },
        };
        const original = JSON.stringify(input);
        const log = jest.fn();
        const first = migrateSettings(
            input,
            ["caldav"],
            CALDAV_REMOVAL_VERSION,
            log
        );
        const output = JSON.stringify(first.settings);

        expect(JSON.stringify(input)).toBe(original);
        expect(first.changed).toBe(true);
        expect(first.saveRequested).toBe(true);
        expect(first.settings.defaultCalendar).toBe("local::Events");
        expect(first.settings.redactedLegacySources).toEqual([
            { legacyType: "caldav", removedAtVersion: CALDAV_REMOVAL_VERSION },
        ]);
        for (const sentinel of Object.values(SENTINELS)) {
            expect(output).not.toContain(sentinel);
            expect(serializedLog(log)).not.toContain(sentinel);
            expect(JSON.stringify((Notice as any).notices || [])).not.toContain(
                sentinel
            );
        }

        const second = migrateSettings(
            first.settings,
            ["caldav"],
            CALDAV_REMOVAL_VERSION,
            log
        );
        expect(second.settings).toEqual(first.settings);
        expect(JSON.stringify(second.settings)).toBe(
            JSON.stringify(first.settings)
        );
        expect(second.changed).toBe(false);
        expect(second.saveRequested).toBe(false);
    });

    it("discards malformed and unknown fields rather than quarantining them", () => {
        const migrated = migrateSettings(
            {
                calendarSources: [
                    { type: "unknown", password: "UNKNOWN_SENTINEL" },
                    { type: "caldav", password: "MALFORMED_SENTINEL" },
                ],
            },
            ["caldav"],
            CALDAV_REMOVAL_VERSION,
            jest.fn()
        );
        const output = JSON.stringify(migrated.settings);
        expect(output).not.toContain("UNKNOWN_SENTINEL");
        expect(output).not.toContain("MALFORMED_SENTINEL");
        expect(migrated.settings.redactedLegacySources).toEqual([]);
    });
});

describe("non-destructive production persistence", () => {
    it("preserves raw source slots and credentials during an unrelated save", () => {
        const input = {
            calendarSources: [
                caldav,
                { type: "future-secret-type", token: "UNKNOWN_SENTINEL" },
                null,
                local("Events"),
            ],
            defaultCalendar: 3,
            firstDay: 0,
        };
        const decoded = decodeSettings(input, undefined, jest.fn()).settings;
        const baseline = captureRuntimeSettingsBaseline(decoded);
        decoded.firstDay = 1;

        const prepared = prepareSettingsSave(input, baseline, decoded);

        expect(prepared.changed).toBe(true);
        expect(prepared.persisted.firstDay).toBe(1);
        expect(prepared.persisted.defaultCalendar).toBe(3);
        expect(prepared.persisted.calendarSources).toEqual(
            input.calendarSources
        );
        for (const sentinel of [
            ...Object.values(SENTINELS),
            "UNKNOWN_SENTINEL",
        ]) {
            expect(JSON.stringify(prepared.persisted)).toContain(sentinel);
        }
    });

    it("persists an explicit source edit but not decoder normalization", () => {
        const input = {
            calendarSources: [caldav, local("Events")],
            defaultCalendar: 1,
        };
        const decoded = decodeSettings(input, undefined, jest.fn()).settings;
        const baseline = captureRuntimeSettingsBaseline(decoded);
        decoded.calendarSources = decoded.calendarSources.filter(
            (source) => source.type !== "caldav"
        );

        const prepared = prepareSettingsSave(input, baseline, decoded);

        expect(prepared.persisted.calendarSources).toEqual([local("Events")]);
        // The normalized runtime default was not an explicit user change.
        expect(prepared.persisted.defaultCalendar).toBe(1);
    });

    it("requests no write when runtime settings are untouched", () => {
        const input = {
            calendarSources: [caldav, local("Events")],
            defaultCalendar: 1,
        };
        const decoded = decodeSettings(input, undefined, jest.fn()).settings;
        const prepared = prepareSettingsSave(
            input,
            captureRuntimeSettingsBaseline(decoded),
            decoded
        );

        expect(prepared.changed).toBe(false);
        expect(prepared.persisted).toEqual(input);
    });

    it("keeps successive in-place source and nested-view edits observable", () => {
        const input = {
            calendarSources: [local("Events")],
            initialView: { desktop: "timeGridWeek", mobile: "timeGrid3Days" },
        };
        const current = decodeSettings(input, undefined, jest.fn()).settings;
        const baseline = captureRuntimeSettingsBaseline(current);
        current.calendarSources.push(ical);
        current.initialView.desktop = "dayGridMonth";

        const first = prepareSettingsSave(input, baseline, current);
        current.calendarSources.push(local("Work"));
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
        ).toEqual(["local", "ical", "local"]);
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
