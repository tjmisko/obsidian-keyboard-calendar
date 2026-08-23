import { performance } from "perf_hooks";
import { TFile } from "obsidian";

import FullNoteCalendar from "../calendars/FullNoteCalendar";
import EventCache, {
    CalendarInitializerMap,
    eventsAreDifferent,
} from "../core/EventCache";
import EventStore from "../core/EventStore";
import { localEventRecordId } from "../core/LocalEventIndex";
import type { ObsidianInterface } from "../ObsidianAdapter";
import type { OFCEvent } from "../types";
import { MockAppBuilder } from "../../test_helpers/AppBuilder";
import { FileBuilder } from "../../test_helpers/FileBuilder";

const WARMUP_RUNS = 5;
const MEASURED_RUNS = 60;
const FIXTURE_EVENT_COUNT = 250;
const STARTUPS_PER_SAMPLE = 5;
const REPARSES_PER_SAMPLE = 500;
const OPEN_LOOKUPS_PER_SAMPLE = FIXTURE_EVENT_COUNT * 100;
const SOURCE_DIRECTORY = "events";
const SOURCE_COLOR = "#123456";

type BenchmarkName = "startupIndex" | "oneNoteReparse" | "openIdToPath";

interface Summary {
    warmupRuns: number;
    measuredRuns: number;
    operationsPerSample: number;
    medianMs: number;
    p95Ms: number;
}

interface Comparison {
    legacy: Summary;
    candidate: Summary;
}

const percentile = (sorted: number[], fraction: number): number =>
    sorted[Math.ceil(sorted.length * fraction) - 1];

const summarize = (samples: number[], operationsPerSample: number): Summary => {
    const perOperation = samples
        .map((duration) => duration / operationsPerSample)
        .sort((left, right) => left - right);
    return {
        warmupRuns: WARMUP_RUNS,
        measuredRuns: MEASURED_RUNS,
        operationsPerSample,
        medianMs: percentile(perOperation, 0.5),
        p95Ms: percentile(perOperation, 0.95),
    };
};

const measure = async (action: () => Promise<void>): Promise<number> => {
    const start = performance.now();
    await action();
    return performance.now() - start;
};

/** Alternate ordering so neither implementation always gets the warmer turn. */
const compare = async (
    legacy: () => Promise<void>,
    candidate: () => Promise<void>,
    operationsPerSample = 1
): Promise<Comparison> => {
    const runPair = async (run: number, record: boolean) => {
        const legacyFirst = run % 2 === 0;
        const first = legacyFirst ? legacy : candidate;
        const second = legacyFirst ? candidate : legacy;
        const firstDuration = await measure(first);
        const secondDuration = await measure(second);
        if (record) {
            (legacyFirst ? legacySamples : candidateSamples).push(
                firstDuration
            );
            (legacyFirst ? candidateSamples : legacySamples).push(
                secondDuration
            );
        }
    };

    const legacySamples: number[] = [];
    const candidateSamples: number[] = [];
    for (let run = 0; run < WARMUP_RUNS; run += 1) {
        await runPair(run, false);
    }
    for (let run = 0; run < MEASURED_RUNS; run += 1) {
        await runPair(run, true);
    }
    return {
        legacy: summarize(legacySamples, operationsPerSample),
        candidate: summarize(candidateSamples, operationsPerSample),
    };
};

const fixtureEvent = (index: number): OFCEvent => ({
    title: `Sanitized fixture event ${String(index).padStart(3, "0")}`,
    type: "single",
    allDay: true,
    date: `2026-08-${String((index % 28) + 1).padStart(2, "0")}`,
    endDate: null,
});

const buildFixture = () => {
    let folder = new MockAppBuilder(SOURCE_DIRECTORY);
    for (let index = 0; index < FIXTURE_EVENT_COUNT; index += 1) {
        folder = folder.file(
            `Event ${String(index).padStart(3, "0")}.md`,
            new FileBuilder().frontmatter(fixtureEvent(index))
        );
    }
    return MockAppBuilder.make().folder(folder).done();
};

const normalizeLegacy = (store: EventStore, calendar: FullNoteCalendar) =>
    store
        .getEventsInCalendar(calendar)
        .map(({ event, location }) => ({
            sourceId: calendar.id,
            path: location?.path,
            event,
        }))
        .sort((left, right) =>
            (left.path || "").localeCompare(right.path || "")
        );

const normalizeCandidate = (cache: EventCache) =>
    cache
        .getAllEvents()
        .flatMap(({ id: sourceId, events }) =>
            events.map(({ id, event }) => ({
                sourceId,
                path: cache.getInfoForFullNoteEvent(id)?.location.path,
                event,
            }))
        )
        .sort((left, right) =>
            (left.path || "").localeCompare(right.path || "")
        );

describe("Phase 8B local-index benchmark", () => {
    jest.setTimeout(60_000);
    let consoleDebug: jest.SpyInstance;

    beforeEach(() => {
        consoleDebug = jest
            .spyOn(console, "debug")
            .mockImplementation(() => undefined);
    });

    afterEach(() => {
        consoleDebug.mockRestore();
    });

    it("keeps the old/new sets equal and every candidate p95 within 1.20x", async () => {
        const app = buildFixture();
        const fixtureBytes = new Map(app.vault.contents);
        const forbidden = {
            create: jest.fn(),
            rewrite: jest.fn(),
            rename: jest.fn(),
        };
        const io: ObsidianInterface = {
            getAbstractFileByPath: (path) =>
                app.vault.getAbstractFileByPath(path),
            getRoot: () => app.vault.getRoot(),
            getFileByPath: (path) => {
                const file = app.vault.getAbstractFileByPath(path);
                return file instanceof TFile ? file : null;
            },
            getMetadata: (file) => app.metadataCache.getFileCache(file),
            read: (file) => app.vault.read(file),
            create: forbidden.create,
            rewrite: forbidden.rewrite,
            rename: forbidden.rename,
        };
        const calendar = new FullNoteCalendar(
            io,
            SOURCE_COLOR,
            SOURCE_DIRECTORY
        );
        const source = {
            sourceId: calendar.id,
            directory: SOURCE_DIRECTORY,
        };
        const initializers: CalendarInitializerMap = {
            local: () => calendar,
            FOR_TEST_ONLY: () => null,
        };
        const makeCandidateCache = async () => {
            const cache = new EventCache(initializers);
            cache.reset([
                {
                    type: "local",
                    directory: SOURCE_DIRECTORY,
                    color: SOURCE_COLOR,
                },
            ]);
            cache.on("update", () => undefined);
            await cache.populate();
            return cache;
        };
        const targetPath = "events/Event 125.md";
        const targetFile = app.vault.getAbstractFileByPath(targetPath);
        expect(targetFile).toBeInstanceOf(TFile);

        let latestLegacyStartupStore: EventStore | null = null;
        let latestLegacyStartupEvents: Array<{
            event: OFCEvent;
            id: string;
        }> = [];
        let latestCandidateStartupCache: EventCache | null = null;
        const startupIndex = await compare(
            async () => {
                for (let run = 0; run < STARTUPS_PER_SAMPLE; run += 1) {
                    const store = new EventStore();
                    const parsed = await calendar.getEvents();
                    parsed.forEach(([event, location], index) =>
                        store.add({
                            calendar,
                            location,
                            id: String(index),
                            event,
                        })
                    );
                    const eventsByCalendar = store.eventsByCalendar;
                    const storedEvents =
                        eventsByCalendar.get(calendar.id) || [];
                    latestLegacyStartupEvents = storedEvents.map(
                        ({ event, id }) => ({ event, id })
                    );
                    latestLegacyStartupStore = store;
                }
            },
            async () => {
                for (let run = 0; run < STARTUPS_PER_SAMPLE; run += 1) {
                    latestCandidateStartupCache = await makeCandidateCache();
                    latestCandidateStartupCache.getAllEvents();
                }
            },
            STARTUPS_PER_SAMPLE
        );
        expect(latestLegacyStartupStore!.eventCount).toBe(FIXTURE_EVENT_COUNT);
        expect(latestLegacyStartupEvents).toHaveLength(FIXTURE_EVENT_COUNT);
        expect(
            latestCandidateStartupCache!
                .getAllEvents()
                .flatMap(({ events }) => events)
        ).toHaveLength(FIXTURE_EVENT_COUNT);

        const legacyStore = new EventStore();
        (await calendar.getEvents()).forEach(([event, location], index) =>
            legacyStore.add({
                calendar,
                location,
                id: String(index),
                event,
            })
        );
        const candidateCache = await makeCandidateCache();

        const oneNoteReparse = await compare(
            async () => {
                for (let run = 0; run < REPARSES_PER_SAMPLE; run += 1) {
                    const parsed = await calendar.getEventsInFile(
                        targetFile as TFile
                    );
                    const old = legacyStore.getEventsInFileAndCalendar(
                        targetFile as TFile,
                        calendar
                    );
                    if (
                        eventsAreDifferent(
                            old.map(({ event }) => event),
                            parsed.map(([event]) => event)
                        )
                    ) {
                        legacyStore.deleteEventsAtPath(targetPath);
                        parsed.forEach(([event, location]) =>
                            legacyStore.add({
                                calendar,
                                location,
                                id: String(FIXTURE_EVENT_COUNT),
                                event,
                            })
                        );
                    }
                }
            },
            async () => {
                for (let run = 0; run < REPARSES_PER_SAMPLE; run += 1) {
                    await candidateCache.fileUpdated(targetFile as TFile);
                }
            },
            REPARSES_PER_SAMPLE
        );

        const legacyTargetId = legacyStore.getEventsInFile({
            path: targetPath,
        })[0].id;
        const candidateTargetId = localEventRecordId(
            source.sourceId,
            targetPath
        );
        expect(candidateCache.getEventById(candidateTargetId)).not.toBeNull();
        let legacyOpenPath: string | null | undefined;
        let candidateOpenPath: string | undefined;
        const openIdToPath = await compare(
            async () => {
                for (let run = 0; run < OPEN_LOOKUPS_PER_SAMPLE; run += 1) {
                    legacyOpenPath =
                        legacyStore.getEventDetails(legacyTargetId)?.location
                            ?.path;
                }
            },
            async () => {
                for (let run = 0; run < OPEN_LOOKUPS_PER_SAMPLE; run += 1) {
                    candidateOpenPath =
                        candidateCache.getInfoForFullNoteEvent(
                            candidateTargetId
                        )?.location.path;
                }
            },
            OPEN_LOOKUPS_PER_SAMPLE
        );
        expect(legacyOpenPath).toBe(targetPath);
        expect(candidateOpenPath).toBe(targetPath);

        const legacySet = normalizeLegacy(legacyStore, calendar);
        const candidateSet = normalizeCandidate(candidateCache);
        expect(legacySet).toHaveLength(FIXTURE_EVENT_COUNT);
        expect(candidateSet).toHaveLength(FIXTURE_EVENT_COUNT);
        expect(new Set(legacySet.map(({ path }) => path)).size).toBe(
            FIXTURE_EVENT_COUNT
        );
        expect(new Set(candidateSet.map(({ path }) => path)).size).toBe(
            FIXTURE_EVENT_COUNT
        );
        expect(candidateSet).toEqual(legacySet);
        expect(forbidden.create).not.toHaveBeenCalled();
        expect(forbidden.rewrite).not.toHaveBeenCalled();
        expect(forbidden.rename).not.toHaveBeenCalled();
        expect(app.vault.contents).toEqual(fixtureBytes);

        const comparisons: Record<BenchmarkName, Comparison> = {
            startupIndex,
            oneNoteReparse,
            openIdToPath,
        };
        if (process.env.OFC_PHASE8B_BENCHMARK === "1") {
            process.stdout.write(
                `${JSON.stringify({
                    fixture: {
                        kind: "deterministic-direct-child-full-note",
                        sourceDirectory: SOURCE_DIRECTORY,
                        eventCount: FIXTURE_EVENT_COUNT,
                        containsUserData: false,
                    },
                    comparisons,
                })}\n`
            );
        }
        for (const [name, { legacy, candidate }] of Object.entries(
            comparisons
        )) {
            expect(legacy.warmupRuns).toBe(WARMUP_RUNS);
            expect(legacy.measuredRuns).toBe(MEASURED_RUNS);
            if (candidate.p95Ms > legacy.p95Ms * 1.2) {
                throw new Error(
                    `${name} candidate p95 ${candidate.p95Ms}ms exceeds ` +
                        `1.20x legacy p95 ${legacy.p95Ms}ms.`
                );
            }
        }
    });
});
