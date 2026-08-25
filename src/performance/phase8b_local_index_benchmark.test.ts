import { performance } from "perf_hooks";
import { TFile, TFolder } from "obsidian";

import FullNoteCalendar, {
    parseFullNoteEvent,
} from "../calendars/FullNoteCalendar";
import EventCache from "../core/EventCache";
import { localEventRecordId } from "../core/LocalEventIndex";
import type { ObsidianInterface } from "../ObsidianAdapter";
import { OFCEvent, validateEvent } from "../types";
import { MockAppBuilder } from "../../test_helpers/AppBuilder";
import { FileBuilder } from "../../test_helpers/FileBuilder";

const WARMUP_RUNS = 5;
const MEASURED_RUNS = 60;
const FIXTURE_EVENT_COUNT = 250;
const STARTUPS_PER_SAMPLE = 5;
const REPARSES_PER_SAMPLE = 500;
const OPEN_LOOKUPS_PER_SAMPLE = FIXTURE_EVENT_COUNT * 1000;
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
    date: `2026-08-${String((index % 28) + 1).padStart(2, "0")}`,
    endDate: null,
    startTime: "09:00",
    endTime: "10:00",
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

interface LegacyRecord {
    id: string;
    sourceId: string;
    path: string;
    event: OFCEvent;
}

interface LegacyAddRecord {
    id: string;
    sourceId: string;
    event: OFCEvent;
    location: { file: TFile; lineNumber: number | undefined };
}

interface LegacyEventDetails extends LegacyRecord {
    location: { path: string; lineNumber: number | undefined };
}

interface LegacyIdentifier {
    id: string;
}

class LegacyPath implements LegacyIdentifier {
    readonly id: string;

    constructor(file: { path: string }) {
        this.id = file.path;
    }
}

class LegacyEventId implements LegacyIdentifier {
    constructor(readonly id: string) {}
}

/** Exact test-local relationship mechanics from the removed EventStore. */
class LegacyOneToMany<T extends LegacyIdentifier, FK extends LegacyIdentifier> {
    private foreign = new Map<string, string>();
    private related = new Map<string, Set<string>>();

    add(one: T, many: FK): void {
        this.foreign.set(many.id, one.id);
        let related = this.related.get(one.id);
        if (!related) {
            related = new Set();
            this.related.set(one.id, related);
        }
        related.add(many.id);
    }

    delete(many: FK): void {
        const oneId = this.foreign.get(many.id);
        if (!oneId) return;
        this.foreign.delete(many.id);
        const related = this.related.get(oneId);
        if (!related) {
            throw new Error("Legacy relationship maps are inconsistent.");
        }
        related.delete(many.id);
    }

    getBy(key: T): Set<string> {
        const related = this.related.get(key.id);
        return related ? new Set(related) : new Set();
    }

    getRelated(key: FK): string | null {
        return this.foreign.get(key.id) || null;
    }

    get groupByRelated(): Map<string, string[]> {
        const result = new Map<string, string[]>();
        for (const [key, values] of this.related) {
            result.set(key, [...values.values()]);
        }
        return result;
    }
}

/** Test-local archive of the removed pre-8B store behavior. */
class LegacyIndexOracle {
    private eventsById = new Map<string, OFCEvent>();
    private sourceIndex = new LegacyOneToMany<
        LegacyIdentifier,
        LegacyEventId
    >();
    private pathIndex = new LegacyOneToMany<LegacyPath, LegacyEventId>();
    private lineById = new Map<string, number>();

    add(record: LegacyAddRecord): void {
        if (this.eventsById.has(record.id)) {
            throw new Error(`Duplicate legacy event ID ${record.id}.`);
        }
        console.debug("adding event", {
            id: record.id,
            event: record.event,
            location: record.location,
        });
        this.eventsById.set(record.id, record.event);
        this.sourceIndex.add(
            { id: record.sourceId },
            new LegacyEventId(record.id)
        );
        const { file, lineNumber } = record.location;
        console.debug("adding event in file:", file.path);
        this.pathIndex.add(new LegacyPath(file), new LegacyEventId(record.id));
        if (lineNumber !== undefined) {
            this.lineById.set(record.id, lineNumber);
        }
    }

    deleteEventsAtPath(path: string): void {
        const eventIds = this.pathIndex.getBy(new LegacyPath({ path }));
        for (const id of eventIds) {
            if (!this.eventsById.has(id)) continue;
            this.sourceIndex.delete(new LegacyEventId(id));
            this.pathIndex.delete(new LegacyEventId(id));
            this.lineById.delete(id);
            this.eventsById.delete(id);
        }
    }

    get eventsBySource(): Map<string, LegacyRecord[]> {
        const grouped = new Map<string, LegacyRecord[]>();
        for (const [sourceId, ids] of this.sourceIndex.groupByRelated) {
            grouped.set(sourceId, this.fetch(ids));
        }
        return grouped;
    }

    getEventsInSource(sourceId: string): LegacyRecord[] {
        return this.fetch(this.sourceIndex.getBy({ id: sourceId }));
    }

    getEventsAtPath(path: string): LegacyRecord[] {
        return this.fetch(this.pathIndex.getBy(new LegacyPath({ path })));
    }

    getEventDetails(id: string): LegacyEventDetails | null {
        const event = this.eventsById.get(id);
        const sourceId = this.sourceIndex.getRelated(new LegacyEventId(id));
        const path = this.pathIndex.getRelated(new LegacyEventId(id));
        const lineNumber = this.lineById.get(id);
        return event && sourceId && path
            ? {
                  id,
                  event,
                  sourceId,
                  path,
                  location: { path, lineNumber },
              }
            : null;
    }

    get eventCount(): number {
        return this.eventsById.size;
    }

    private fetch(ids: Iterable<string>): LegacyRecord[] {
        const result: LegacyRecord[] = [];
        for (const id of ids) {
            const details = this.getEventDetails(id);
            if (details) result.push(details);
        }
        return result;
    }
}

type LegacyEventResponse = [
    OFCEvent,
    { file: TFile; lineNumber: number | undefined }
];

const legacyScan = async (
    app: ReturnType<typeof buildFixture>
): Promise<LegacyEventResponse[]> => {
    const folder = app.vault.getAbstractFileByPath(SOURCE_DIRECTORY);
    if (!(folder instanceof TFolder)) {
        throw new Error("Missing benchmark source folder.");
    }
    const records: LegacyEventResponse[] = [];
    for (const file of folder.children) {
        if (!(file instanceof TFile)) continue;
        records.push(...(await legacyReadFile(app, file)));
    }
    return records;
};

const legacyReadFile = async (
    app: ReturnType<typeof buildFixture>,
    file: TFile
): Promise<LegacyEventResponse[]> => {
    const event = parseFullNoteEvent(
        app.metadataCache.getFileCache(file)?.frontmatter,
        file.basename
    );
    return event ? [[event, { file, lineNumber: undefined }]] : [];
};

const legacyDeepEqual = (left: unknown, right: unknown): boolean => {
    if (left === right) return true;
    if (Array.isArray(left) && Array.isArray(right)) {
        return (
            left.length === right.length &&
            left.every((value, index) => legacyDeepEqual(value, right[index]))
        );
    }
    if (
        typeof left !== "object" ||
        left === null ||
        typeof right !== "object" ||
        right === null
    ) {
        return false;
    }
    const leftRecord = left as Record<string, unknown>;
    const rightRecord = right as Record<string, unknown>;
    const keys = Object.keys(leftRecord);
    return (
        keys.length === Object.keys(rightRecord).length &&
        keys.every(
            (key) =>
                Object.prototype.hasOwnProperty.call(rightRecord, key) &&
                legacyDeepEqual(leftRecord[key], rightRecord[key])
        )
    );
};

const legacyEventsAreDifferent = (
    oldEvents: OFCEvent[],
    newEvents: OFCEvent[]
): boolean => {
    const oldNormalized = oldEvents
        .sort((left, right) => left.title.localeCompare(right.title))
        .flatMap((event) => validateEvent(event) || []);
    const newNormalized = newEvents
        .sort((left, right) => left.title.localeCompare(right.title))
        .flatMap((event) => validateEvent(event) || []);
    return (
        oldNormalized.length !== newNormalized.length ||
        oldNormalized.some(
            (event, index) => !legacyDeepEqual(event, newNormalized[index])
        )
    );
};

const normalizeLegacy = (store: LegacyIndexOracle, sourceId: string) =>
    store
        .getEventsInSource(sourceId)
        .map(({ event, path }) => ({
            sourceId,
            path,
            event,
        }))
        .sort((left, right) => left.path.localeCompare(right.path));

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
            trash: jest.fn(),
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
            trash: forbidden.trash,
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
        const makeCandidateCache = async () => {
            const cache = new EventCache(() => calendar);
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

        let latestLegacyStartupStore: LegacyIndexOracle | null = null;
        let latestLegacyStartupEvents: Array<{
            event: OFCEvent;
            id: string;
        }> = [];
        let latestCandidateStartupCache: EventCache | null = null;
        const startupIndex = await compare(
            async () => {
                for (let run = 0; run < STARTUPS_PER_SAMPLE; run += 1) {
                    const store = new LegacyIndexOracle();
                    const parsed = await legacyScan(app);
                    parsed.forEach(([event, location], index) =>
                        store.add({
                            sourceId: calendar.id,
                            location,
                            id: String(index),
                            event,
                        })
                    );
                    const eventsByCalendar = store.eventsBySource;
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

        const legacyStore = new LegacyIndexOracle();
        (await legacyScan(app)).forEach(([event, location], index) =>
            legacyStore.add({
                sourceId: calendar.id,
                location,
                id: String(index),
                event,
            })
        );
        const candidateCache = await makeCandidateCache();

        const oneNoteReparse = await compare(
            async () => {
                for (let run = 0; run < REPARSES_PER_SAMPLE; run += 1) {
                    const parsed = await legacyReadFile(
                        app,
                        targetFile as TFile
                    );
                    const old = legacyStore.getEventsAtPath(targetPath);
                    if (
                        legacyEventsAreDifferent(
                            old.map(({ event }) => event),
                            parsed.map(([event]) => event)
                        )
                    ) {
                        legacyStore.deleteEventsAtPath(targetPath);
                        parsed.forEach(([event, location]) =>
                            legacyStore.add({
                                sourceId: calendar.id,
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

        const legacyTargetId = legacyStore.getEventsAtPath(targetPath)[0].id;
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
                            .path;
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

        const legacySet = normalizeLegacy(legacyStore, calendar.id);
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
