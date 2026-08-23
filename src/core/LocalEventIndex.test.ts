import { TFile, TFolder } from "obsidian";
import { parseFullNoteEvent } from "../calendars/FullNoteCalendar";
import type { OFCEvent } from "../types";
import { MockAppBuilder } from "../../test_helpers/AppBuilder";
import { FileBuilder } from "../../test_helpers/FileBuilder";
import {
    isDirectChildMarkdownPath,
    LocalEventIndex,
    LocalEventReadAdapter,
    LocalEventRecord,
    localEventRecordId,
} from "./LocalEventIndex";

const event = (title: string, date = "2026-08-22", id?: string): OFCEvent => ({
    title,
    ...(id ? { id } : {}),
    type: "single",
    allDay: true,
    date,
    endDate: null,
});

const deferred = <T>() => {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((onResolve, onReject) => {
        resolve = onResolve;
        reject = onReject;
    });
    return { promise, resolve, reject };
};

class MemoryReadAdapter implements LocalEventReadAdapter {
    files: string[];
    events: Map<string, OFCEvent | null>;
    listFiles = jest.fn(async () => this.files.map((path) => ({ path })));
    readEvent = jest.fn(async (path: string) => this.events.get(path) || null);

    constructor(entries: Record<string, OFCEvent | null>) {
        this.files = Object.keys(entries);
        this.events = new Map(Object.entries(entries));
    }
}

const recordSet = (records: Iterable<LocalEventRecord>) =>
    [...records]
        .map(({ sourceId, path, event }) => ({ sourceId, path, event }))
        .sort((left, right) => left.path.localeCompare(right.path));

describe("local event ownership and identity", () => {
    it("admits only direct-child Markdown paths with retained root semantics", () => {
        expect(isDirectChildMarkdownPath("events", "events/Plan.md")).toBe(
            true
        );
        expect(isDirectChildMarkdownPath("events/", "events/Plan.MD")).toBe(
            true
        );
        expect(
            isDirectChildMarkdownPath("areas/events", "areas/events/Plan.md")
        ).toBe(true);
        expect(
            isDirectChildMarkdownPath("events", "events/nested/Plan.md")
        ).toBe(false);
        expect(isDirectChildMarkdownPath("events", "events/Plan.txt")).toBe(
            false
        );
        expect(isDirectChildMarkdownPath("events", "events-old/Plan.md")).toBe(
            false
        );
        expect(isDirectChildMarkdownPath("events", "/events/Plan.md")).toBe(
            false
        );
        expect(isDirectChildMarkdownPath("", "Root.md")).toBe(true);
        expect(isDirectChildMarkdownPath("/", "Root.md")).toBe(true);
        expect(isDirectChildMarkdownPath("", "events/Plan.md")).toBe(false);
    });

    it("creates stable collision-safe IDs from the source/path tuple", () => {
        const original = localEventRecordId("local::events", "events/A.md");
        expect(original).toBe(
            localEventRecordId("local::events", "events/A.md")
        );
        expect(original).not.toBe(
            localEventRecordId("local::other", "events/A.md")
        );
        expect(localEventRecordId("a:b", "c.md")).not.toBe(
            localEventRecordId("a", "b:c.md")
        );
        expect(localEventRecordId("a%3Ab", "c.md")).not.toBe(
            localEventRecordId("a:b", "c.md")
        );
    });
});

describe("legacy-index equivalence", () => {
    it("matches the old direct-child source set without indexing nested or non-Markdown files", async () => {
        const app = MockAppBuilder.make()
            .file("Outside.md", new FileBuilder().frontmatter(event("Outside")))
            .folder(
                new MockAppBuilder("events")
                    .file(
                        "Alpha.md",
                        new FileBuilder().frontmatter(
                            event("Duplicate title", "2026-08-22")
                        )
                    )
                    .file(
                        "Beta.md",
                        new FileBuilder().frontmatter(
                            event("Duplicate title", "2026-08-23")
                        )
                    )
                    .file(
                        "Weekly.md",
                        new FileBuilder().frontmatter({
                            title: "Weekly",
                            type: "recurring",
                            allDay: false,
                            startTime: "09:00",
                            endTime: "10:00",
                            daysOfWeek: ["M"],
                            startRecur: "2026-08-01",
                            endRecur: "2026-09-01",
                            skipDates: ["2026-08-24"],
                        })
                    )
                    .file(
                        "Monthly.md",
                        new FileBuilder().frontmatter({
                            title: "Monthly",
                            type: "rrule",
                            allDay: false,
                            startTime: "11:00",
                            endTime: "12:00",
                            startDate: "2026-08-01",
                            rrule: "FREQ=MONTHLY;BYDAY=2TU",
                            skipDates: [],
                            endRecur: "2027-01-01",
                        })
                    )
                    .file(
                        "Invalid.md",
                        new FileBuilder().frontmatter({ title: "Invalid" })
                    )
                    .file("Ignore.txt", new FileBuilder().text("not an event"))
                    .folder(
                        new MockAppBuilder("nested").file(
                            "Nested.md",
                            new FileBuilder().frontmatter(event("Nested"))
                        )
                    )
            )
            .done();
        const fixtureBytes = new Map(app.vault.contents);
        const sourceId = "local::events";
        const folder = app.vault.getAbstractFileByPath("events");
        if (!(folder instanceof TFolder)) {
            throw new Error("Missing legacy-oracle fixture folder.");
        }
        const oldStoredEvents: Array<{ event: OFCEvent; path: string }> = [];
        for (const file of folder.children) {
            if (!(file instanceof TFile)) continue;
            const parsed = parseFullNoteEvent(
                app.metadataCache.getFileCache(file)?.frontmatter,
                file.basename
            );
            if (parsed)
                oldStoredEvents.push({ event: parsed, path: file.path });
        }
        const oldSet = oldStoredEvents
            .map(({ event, path }) => ({
                sourceId,
                path,
                event,
            }))
            .sort((left, right) => left.path.localeCompare(right.path));

        const adapter: LocalEventReadAdapter = {
            listFiles: async () =>
                app.vault.getFiles().map(({ path }) => ({ path })),
            readEvent: async (path) => {
                const file = app.vault.getAbstractFileByPath(path);
                if (!(file instanceof TFile)) return null;
                return parseFullNoteEvent(
                    app.metadataCache.getFileCache(file)?.frontmatter,
                    file.basename
                );
            },
        };
        const index = new LocalEventIndex({ sourceId, directory: "events" });
        await expect(index.populate(adapter)).resolves.toBe("applied");
        const firstIds = [...index.recordsById.keys()].sort();

        expect(oldSet).toHaveLength(4);
        expect(oldStoredEvents).toHaveLength(4);
        expect(new Set(oldSet.map(({ path }) => path)).size).toBe(4);
        expect(index.recordsById.size).toBe(4);
        expect(index.idByPath.size).toBe(4);
        expect(new Set(index.recordsById.keys()).size).toBe(4);
        expect(recordSet(index.recordsById.values())).toEqual(oldSet);
        expect([...index.idByPath.keys()]).not.toContain(
            "events/nested/Nested.md"
        );
        expect([...index.idByPath.keys()]).not.toContain("events/Ignore.txt");
        expect([...index.idByPath.keys()]).not.toContain("events/Invalid.md");

        const restarted = new LocalEventIndex({
            sourceId,
            directory: "events",
        });
        await restarted.populate(adapter);
        expect(recordSet(restarted.recordsById.values())).toEqual(oldSet);
        expect([...restarted.recordsById.keys()].sort()).toEqual(firstIds);

        expect(Object.keys(adapter).sort()).toEqual(["listFiles", "readEvent"]);
        expect(app.vault.contents).toEqual(fixtureBytes);
    });

    it("indexes only direct root Markdown files for a retained root source", async () => {
        const adapter = new MemoryReadAdapter({
            "Root.md": event("Root"),
            "folder/Nested.md": event("Nested"),
            "Root.txt": event("Wrong extension"),
        });
        const index = new LocalEventIndex({
            sourceId: "local::",
            directory: "",
        });

        await index.populate(adapter);

        expect([...index.idByPath.keys()]).toEqual(["Root.md"]);
    });

    it("defines the intended path-ID behavior for duplicate authored IDs outside the strict old-index oracle", async () => {
        const adapter = new MemoryReadAdapter({
            "events/A.md": event("Same", "2026-08-22", "duplicate"),
            "events/B.md": event("Same", "2026-08-22", "duplicate"),
        });
        const index = new LocalEventIndex({
            sourceId: "local::events",
            directory: "events",
        });

        await index.populate(adapter);

        expect(index.recordsById.size).toBe(2);
        expect(new Set(index.recordsById.keys()).size).toBe(2);
        expect(
            [...index.recordsById.values()].map(({ event }) => event.id)
        ).toEqual(["duplicate", "duplicate"]);
    });

    it("uses defensive source, event, and returned snapshot copies", async () => {
        const source = { sourceId: "local::events", directory: "events" };
        const originalEvent = event("Original");
        const adapter = new MemoryReadAdapter({
            "events/A.md": originalEvent,
        });
        const index = new LocalEventIndex(source);
        source.directory = "other";

        await index.populate(adapter);
        originalEvent.title = "Mutated input";
        const snapshot = index.snapshot;
        const returned = [...snapshot.recordsById.values()][0];
        returned.event.title = "Mutated snapshot";
        (snapshot.recordsById as Map<string, LocalEventRecord>).clear();
        (snapshot.idByPath as Map<string, string>).clear();

        expect([...index.recordsById.values()][0].event.title).toBe("Original");
        expect([...index.idByPath.keys()]).toEqual(["events/A.md"]);
        expect(index.snapshot.source).toEqual({
            sourceId: "local::events",
            directory: "events",
        });
        expect(() => index.assertInvariants()).not.toThrow();
    });

    it("defensively copies arrays without materializing absent optionals", async () => {
        const recurring = {
            title: "Weekly",
            type: "recurring",
            allDay: false,
            startTime: "09:00",
            endTime: "10:00",
            daysOfWeek: ["M"],
        } as OFCEvent;
        const adapter = new MemoryReadAdapter({
            "events/Weekly.md": recurring,
        });
        const index = new LocalEventIndex({
            sourceId: "local::events",
            directory: "events",
        });

        await index.populate(adapter);
        (recurring as Extract<OFCEvent, { type: "recurring" }>).daysOfWeek[0] =
            "T";
        const stored = [...index.recordsById.values()][0].event;

        expect(stored).toMatchObject({ daysOfWeek: ["M"] });
        expect(stored).not.toHaveProperty("skipDates");
        expect(() => index.assertInvariants()).not.toThrow();
    });

    it("deep-freezes the cache-only record seam", async () => {
        const adapter = new MemoryReadAdapter({
            "events/Weekly.md": {
                title: "Weekly",
                type: "recurring",
                allDay: false,
                startTime: "09:00",
                endTime: "10:00",
                daysOfWeek: ["M"],
                skipDates: ["2026-08-24"],
                categories: ["Work"],
            },
        });
        const index = new LocalEventIndex({
            sourceId: "local::events",
            directory: "events",
        });

        await index.populate(adapter);
        const stored = index.getImmutableRecordsForCache()[0];

        expect(Object.isFrozen(stored)).toBe(true);
        expect(Object.isFrozen(stored.event)).toBe(true);
        expect(Object.isFrozen(stored.event.categories)).toBe(true);
        if (stored.event.type !== "recurring") {
            throw new Error("Expected recurring test event.");
        }
        const recurring = stored.event;
        expect(Object.isFrozen(recurring.daysOfWeek)).toBe(true);
        expect(Object.isFrozen(recurring.skipDates)).toBe(true);
        expect(() => {
            stored.event.title = "Mutated";
        }).toThrow();
        expect(() => {
            recurring.daysOfWeek![0] = "T";
        }).toThrow();
        expect(index.getRecord(stored.id)?.event.title).toBe("Weekly");
    });
});

describe("local index lifecycle", () => {
    const source = { sourceId: "local::events", directory: "events" };

    it("handles valid-invalid-valid reparses with a stable path ID", async () => {
        const adapter = new MemoryReadAdapter({
            "events/A.md": event("First"),
        });
        const index = new LocalEventIndex(source);
        await index.populate(adapter);
        const id = index.idByPath.get("events/A.md");

        adapter.events.set("events/A.md", null);
        await index.refresh("events/A.md", adapter);
        expect(index.recordsById.size).toBe(0);

        adapter.events.set("events/A.md", event("Second"));
        await index.refresh("events/A.md", adapter);
        expect(index.idByPath.get("events/A.md")).toBe(id);
        expect(index.recordsById.get(id!)?.event.title).toBe("Second");
    });

    it("covers direct, nested, and outside rename transitions", async () => {
        const adapter = new MemoryReadAdapter({
            "events/A.md": event("A"),
        });
        const index = new LocalEventIndex(source);
        await index.populate(adapter);
        const originalId = index.idByPath.get("events/A.md");

        adapter.events.delete("events/A.md");
        adapter.events.set("events/B.md", event("A"));
        await index.rename("events/A.md", "events/B.md", adapter);
        const renamedId = index.idByPath.get("events/B.md");
        expect(renamedId).not.toBe(originalId);
        expect(index.idByPath.has("events/A.md")).toBe(false);

        adapter.events.delete("events/B.md");
        adapter.events.set("events/nested/B.md", event("A"));
        await index.rename("events/B.md", "events/nested/B.md", adapter);
        expect(index.recordsById.size).toBe(0);

        adapter.events.delete("events/nested/B.md");
        adapter.events.set("events/C.md", event("A"));
        await index.rename("events/nested/B.md", "events/C.md", adapter);
        expect([...index.idByPath.keys()]).toEqual(["events/C.md"]);

        adapter.events.delete("events/C.md");
        adapter.events.set("other/C.md", event("A"));
        await index.rename("events/C.md", "other/C.md", adapter);
        expect(index.recordsById.size).toBe(0);

        adapter.events.delete("other/C.md");
        adapter.events.set("events/D.md", event("A"));
        await index.rename("other/C.md", "events/D.md", adapter);
        expect([...index.idByPath.keys()]).toEqual(["events/D.md"]);
    });

    it("deletes records and prevents pending reads from resurrecting them", async () => {
        const adapter = new MemoryReadAdapter({
            "events/A.md": event("Initial"),
        });
        const index = new LocalEventIndex(source);
        await index.populate(adapter);
        const pending = deferred<OFCEvent | null>();
        adapter.readEvent.mockImplementationOnce(() => pending.promise);

        const refresh = index.refresh("events/A.md", adapter);
        expect(index.deletePath("events/A.md")).toBe(true);
        pending.reject(new Error("stale deleted read failed"));

        await expect(refresh).resolves.toBe("stale");
        expect(index.recordsById.size).toBe(0);
    });

    it("publishes only the latest rapid refresh for one path", async () => {
        const adapter = new MemoryReadAdapter({
            "events/A.md": event("Initial"),
        });
        const index = new LocalEventIndex(source);
        await index.populate(adapter);
        const slow = deferred<OFCEvent | null>();
        adapter.readEvent
            .mockImplementationOnce(() => slow.promise)
            .mockResolvedValueOnce(event("Latest"));

        const staleRefresh = index.refresh("events/A.md", adapter);
        const latestRefresh = index.refresh("events/A.md", adapter);
        await expect(latestRefresh).resolves.toBe("applied");
        slow.reject(new Error("stale rapid read failed"));
        await expect(staleRefresh).resolves.toBe("stale");
        expect([...index.recordsById.values()][0].event.title).toBe("Latest");
    });

    it("prevents an old-path read from returning after rename", async () => {
        const adapter = new MemoryReadAdapter({
            "events/A.md": event("Initial"),
        });
        const index = new LocalEventIndex(source);
        await index.populate(adapter);
        const slow = deferred<OFCEvent | null>();
        adapter.readEvent.mockImplementationOnce(() => slow.promise);
        const oldRefresh = index.refresh("events/A.md", adapter);

        adapter.events.set("events/B.md", event("Renamed"));
        await index.rename("events/A.md", "events/B.md", adapter);
        slow.reject(new Error("stale renamed read failed"));

        await expect(oldRefresh).resolves.toBe("stale");
        expect([...index.idByPath.keys()]).toEqual(["events/B.md"]);
        expect([...index.recordsById.values()][0].event.title).toBe("Renamed");
    });

    it("discards an old populate after refresh or source reset", async () => {
        const adapter = new MemoryReadAdapter({
            "events/A.md": event("Initial"),
        });
        const index = new LocalEventIndex(source);
        const slowPopulate = deferred<OFCEvent | null>();
        adapter.readEvent.mockImplementationOnce(() => slowPopulate.promise);
        const population = index.populate(adapter);
        await Promise.resolve();
        await Promise.resolve();

        adapter.readEvent.mockResolvedValueOnce(event("Refresh wins"));
        await index.refresh("events/A.md", adapter);
        slowPopulate.reject(new Error("stale populate read failed"));
        await expect(population).resolves.toBe("stale");
        expect([...index.recordsById.values()][0].event.title).toBe(
            "Refresh wins"
        );

        const oldEpochRead = deferred<OFCEvent | null>();
        adapter.readEvent.mockImplementationOnce(() => oldEpochRead.promise);
        const oldRefresh = index.refresh("events/A.md", adapter);
        index.reset({ sourceId: "local::work", directory: "work" });
        const workAdapter = new MemoryReadAdapter({
            "work/New.md": event("New source"),
        });
        await index.populate(workAdapter);
        oldEpochRead.reject(new Error("stale old-source read failed"));

        await expect(oldRefresh).resolves.toBe("stale");
        expect([...index.idByPath.keys()]).toEqual(["work/New.md"]);
        expect([...index.recordsById.values()][0].sourceId).toBe("local::work");
    });

    it("does not let unowned refresh or delete calls stale an owned population", async () => {
        const adapter = new MemoryReadAdapter({
            "events/A.md": event("Initial"),
        });
        const index = new LocalEventIndex(source);
        const slowRead = deferred<OFCEvent | null>();
        adapter.readEvent.mockImplementationOnce(() => slowRead.promise);
        const population = index.populate(adapter);
        await Promise.resolve();
        await Promise.resolve();

        const readCalls = adapter.readEvent.mock.calls.length;
        await expect(
            index.refresh("events/nested/Ignore.md", adapter)
        ).resolves.toBe("applied");
        await expect(index.refresh("other/Ignore.md", adapter)).resolves.toBe(
            "applied"
        );
        expect(index.deletePath("events/nested/Ignore.md")).toBe(false);
        expect(index.deletePath("other/Ignore.md")).toBe(false);
        expect(adapter.readEvent).toHaveBeenCalledTimes(readCalls);

        slowRead.resolve(event("Population survives"));
        await expect(population).resolves.toBe("applied");
        expect([...index.recordsById.values()][0].event.title).toBe(
            "Population survives"
        );
    });

    it("does not let an old-folder delete stale a new-source population", async () => {
        const index = new LocalEventIndex(source);
        index.reset({ sourceId: "local::work", directory: "work" });
        const adapter = new MemoryReadAdapter({
            "work/New.md": event("New source"),
        });
        const slowRead = deferred<OFCEvent | null>();
        adapter.readEvent.mockImplementationOnce(() => slowRead.promise);
        const population = index.populate(adapter);
        await Promise.resolve();
        await Promise.resolve();

        expect(index.deletePath("events/A.md")).toBe(false);
        slowRead.resolve(event("New source survives"));

        await expect(population).resolves.toBe("applied");
        expect([...index.idByPath.keys()]).toEqual(["work/New.md"]);
        expect([...index.recordsById.values()][0].event.title).toBe(
            "New source survives"
        );
    });

    it("discards an older refresh after a newer population commits", async () => {
        const adapter = new MemoryReadAdapter({
            "events/A.md": event("Initial"),
        });
        const index = new LocalEventIndex(source);
        await index.populate(adapter);
        const slowRefresh = deferred<OFCEvent | null>();
        adapter.readEvent.mockImplementationOnce(() => slowRefresh.promise);
        const refresh = index.refresh("events/A.md", adapter);

        adapter.events.set("events/A.md", event("Population wins"));
        await expect(index.populate(adapter)).resolves.toBe("applied");
        slowRefresh.resolve(event("Stale refresh"));

        await expect(refresh).resolves.toBe("stale");
        expect([...index.recordsById.values()][0].event.title).toBe(
            "Population wins"
        );
    });

    it("lets a newer failed population invalidate an old refresh without replacing the published snapshot", async () => {
        const adapter = new MemoryReadAdapter({
            "events/A.md": event("Published"),
        });
        const index = new LocalEventIndex(source);
        await index.populate(adapter);
        const published = index.snapshot;
        const slowRefresh = deferred<OFCEvent | null>();
        adapter.readEvent.mockImplementationOnce(() => slowRefresh.promise);
        const refresh = index.refresh("events/A.md", adapter);

        adapter.files.push("events/B.md");
        adapter.events.set("events/B.md", event("Never published"));
        adapter.readEvent.mockRejectedValueOnce(new Error("new scan failed"));
        await expect(index.populate(adapter)).rejects.toThrow(
            "new scan failed"
        );
        slowRefresh.resolve(event("Old refresh"));

        await expect(refresh).resolves.toBe("stale");
        expect(index.snapshot.recordsById).toEqual(published.recordsById);
        expect(index.snapshot.idByPath).toEqual(published.idByPath);
    });

    it("suppresses a stale file-list failure after a source reset", async () => {
        const oldAdapter = new MemoryReadAdapter({
            "events/A.md": event("Old"),
        });
        const index = new LocalEventIndex(source);
        const oldList = deferred<{ path: string }[]>();
        oldAdapter.listFiles.mockImplementationOnce(() => oldList.promise);
        const oldPopulation = index.populate(oldAdapter);

        index.reset({ sourceId: "local::work", directory: "work" });
        await index.populate(
            new MemoryReadAdapter({ "work/New.md": event("New") })
        );
        oldList.reject(new Error("stale list failed"));

        await expect(oldPopulation).resolves.toBe("stale");
        expect([...index.idByPath.keys()]).toEqual(["work/New.md"]);
    });

    it("preserves prior state on thrown reads and atomic population failure", async () => {
        const adapter = new MemoryReadAdapter({
            "events/A.md": event("Initial"),
        });
        const index = new LocalEventIndex(source);
        await index.populate(adapter);
        const before = index.snapshot;

        adapter.readEvent.mockRejectedValueOnce(new Error("refresh failed"));
        await expect(index.refresh("events/A.md", adapter)).rejects.toThrow(
            "refresh failed"
        );
        expect(index.snapshot.recordsById).toEqual(before.recordsById);

        adapter.listFiles.mockRejectedValueOnce(new Error("list failed"));
        await expect(index.populate(adapter)).rejects.toThrow("list failed");
        expect(index.snapshot.recordsById).toEqual(before.recordsById);

        adapter.files.push("events/B.md");
        adapter.events.set("events/B.md", event("B"));
        adapter.readEvent.mockImplementation(async (path) => {
            if (path === "events/B.md") throw new Error("populate failed");
            return adapter.events.get(path) || null;
        });
        await expect(index.populate(adapter)).rejects.toThrow(
            "populate failed"
        );
        expect(index.snapshot.recordsById).toEqual(before.recordsById);
        expect(index.snapshot.idByPath).toEqual(before.idByPath);
    });

    it("rejects duplicate scan paths without changing the prior snapshot", async () => {
        const adapter = new MemoryReadAdapter({
            "events/A.md": event("Initial"),
        });
        const index = new LocalEventIndex(source);
        await index.populate(adapter);
        const before = index.snapshot;
        adapter.files.push("events/A.md");

        await expect(index.populate(adapter)).rejects.toThrow("Duplicate path");
        expect(index.snapshot.recordsById).toEqual(before.recordsById);
        expect(index.snapshot.idByPath).toEqual(before.idByPath);
    });

    it("removes the old path even when reading a renamed destination fails", async () => {
        const adapter = new MemoryReadAdapter({
            "events/A.md": event("Initial"),
        });
        const index = new LocalEventIndex(source);
        await index.populate(adapter);
        adapter.readEvent.mockRejectedValueOnce(
            new Error("rename read failed")
        );

        await expect(
            index.rename("events/A.md", "events/B.md", adapter)
        ).rejects.toThrow("rename read failed");
        expect(index.idByPath.has("events/A.md")).toBe(false);
        expect(index.idByPath.has("events/B.md")).toBe(false);
    });
});
