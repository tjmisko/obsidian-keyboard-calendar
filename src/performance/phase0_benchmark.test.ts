import { performance } from "perf_hooks";
import type { App, TFile, WorkspaceLeaf } from "obsidian";
import { Calendar, EventResponse } from "../calendars/Calendar";
import EventCache, { CalendarInitializerMap } from "../core/EventCache";
import { CalendarInfo, OFCEvent, parseEvent } from "../types";
import EventNoteEditor from "../ui/EventNoteEditor";

const WARMUP_RUNS = 5;
const MEASURED_RUNS = 25;
const FIXTURE_EVENT_COUNT = 250;

type BenchmarkName = "phase0-startup-index" | "phase0-event-open";

interface Summary {
    markStart: string;
    markEnd: string;
    warmupRuns: number;
    measuredRuns: number;
    medianMs: number;
    p95Ms: number;
}

const fixedEvents: OFCEvent[] = Array.from(
    { length: FIXTURE_EVENT_COUNT },
    (_, index) =>
        parseEvent({
            title: `Sanitized fixture event ${index}`,
            type: "single",
            date: `2026-08-${String((index % 28) + 1).padStart(2, "0")}`,
            allDay: index % 2 === 0,
            startTime: index % 2 === 0 ? undefined : "09:00",
            endTime: index % 2 === 0 ? undefined : "10:00",
        })
);

class BenchmarkCalendar extends Calendar {
    get type(): "FOR_TEST_ONLY" {
        return "FOR_TEST_ONLY";
    }

    get identifier(): string {
        return "sanitized-phase0-fixture";
    }

    get name(): string {
        return "Sanitized phase 0 fixture";
    }

    async getEvents(): Promise<EventResponse[]> {
        return fixedEvents.map((event) => [event, null]);
    }
}

const initializers: CalendarInitializerMap = {
    FOR_TEST_ONLY: (info: CalendarInfo) => new BenchmarkCalendar(info.color),
    local: () => null,
    dailynote: () => null,
    ical: () => null,
};

const sample = async (
    name: BenchmarkName,
    action: () => Promise<void>
): Promise<number> => {
    const markStart = `${name}:start`;
    const markEnd = `${name}:end`;
    performance.mark(markStart);
    await action();
    performance.mark(markEnd);
    performance.measure(name, markStart, markEnd);
    const measurement = performance.getEntriesByName(name).pop();
    if (!measurement) {
        throw new Error(`Missing benchmark measurement for ${name}.`);
    }
    performance.clearMarks(markStart);
    performance.clearMarks(markEnd);
    performance.clearMeasures(name);
    return measurement.duration;
};

const summarize = async (
    name: BenchmarkName,
    action: () => Promise<void>
): Promise<Summary> => {
    for (let run = 0; run < WARMUP_RUNS; run += 1) {
        await sample(name, action);
    }
    const samples: number[] = [];
    for (let run = 0; run < MEASURED_RUNS; run += 1) {
        samples.push(await sample(name, action));
    }
    const sorted = [...samples].sort((left, right) => left - right);
    const percentile = (fraction: number): number =>
        sorted[Math.ceil(sorted.length * fraction) - 1];
    return {
        markStart: `${name}:start`,
        markEnd: `${name}:end`,
        warmupRuns: WARMUP_RUNS,
        measuredRuns: MEASURED_RUNS,
        medianMs: percentile(0.5),
        p95Ms: percentile(0.95),
    };
};

describe("phase 0 deterministic performance baseline", () => {
    it("measures startup indexing and ordinary event-note opening", async () => {
        const consoleInfo = jest
            .spyOn(console, "info")
            .mockImplementation(() => {});
        const consoleDebug = jest
            .spyOn(console, "debug")
            .mockImplementation(() => {});
        const consoleWarn = jest
            .spyOn(console, "warn")
            .mockImplementation(() => {});
        try {
            const startupIndex = await summarize(
                "phase0-startup-index",
                async () => {
                    const cache = new EventCache(initializers);
                    cache.reset([
                        {
                            type: "FOR_TEST_ONLY",
                            id: "sanitized-phase0-fixture",
                            color: "#123456",
                        },
                    ]);
                    await cache.populate();
                    expect(
                        cache.getAllEvents().flatMap((source) => source.events)
                    ).toHaveLength(FIXTURE_EVENT_COUNT);
                }
            );

            const leaf = {
                getViewState: () => ({ type: "full-calendar-view" }),
                openFile: jest.fn(async () => undefined),
            } as unknown as WorkspaceLeaf;
            const editor = new EventNoteEditor({
                workspace: { activeLeaf: leaf },
            } as unknown as App);
            const file = {
                path: "Sanitized Fixtures/Event.md",
            } as TFile;
            const eventOpen = await summarize("phase0-event-open", async () =>
                editor.open(file, leaf)
            );

            expect(startupIndex.measuredRuns).toBeGreaterThanOrEqual(20);
            expect(eventOpen.measuredRuns).toBeGreaterThanOrEqual(20);
            expect(startupIndex.medianMs).toBeGreaterThanOrEqual(0);
            expect(eventOpen.p95Ms).toBeGreaterThanOrEqual(0);

            if (process.env.OFC_PHASE0_BENCHMARK === "1") {
                process.stdout.write(
                    `${JSON.stringify({
                        fixture: {
                            kind: "deterministic-mocked-adapters",
                            eventCount: FIXTURE_EVENT_COUNT,
                            containsUserData: false,
                        },
                        startupIndex,
                        eventOpen,
                    })}\n`
                );
            }
        } finally {
            consoleInfo.mockRestore();
            consoleDebug.mockRestore();
            consoleWarn.mockRestore();
        }
    });
});
