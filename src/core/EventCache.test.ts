import { TFile } from "obsidian";
import FullNoteCalendar, {
    FullNoteEventLocation,
    FullNoteEventPath,
} from "../calendars/FullNoteCalendar";
import type { ObsidianInterface } from "../ObsidianAdapter";
import type { OFCEvent } from "../types";
import EventCache, {
    LocalCalendarInitializer,
    UpdateViewCallback,
} from "./EventCache";
import { MockAppBuilder } from "../../test_helpers/AppBuilder";
import { FileBuilder } from "../../test_helpers/FileBuilder";

const event = (
    title: string,
    date = "2026-08-22",
    extra: Partial<OFCEvent> = {}
): OFCEvent =>
    ({
        title,
        type: "single",
        allDay: true,
        date,
        endDate: null,
        ...extra,
    } as OFCEvent);

const file = (path: string): TFile => ({ path } as TFile);

const deferred = <T>() => {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((onResolve, onReject) => {
        resolve = onResolve;
        reject = onReject;
    });
    return { promise, resolve, reject };
};

class TestFullNoteCalendar extends FullNoteCalendar {
    events = new Map<string, OFCEvent | null>();
    existing = new Set<string>();
    nextCreatePath: string;
    nextModifyPath: string | null = null;

    listFiles = jest.fn(() =>
        [...this.events.keys()].map((path) => ({ path }))
    );
    readEvent = jest.fn(async (path: string) => this.events.get(path) || null);
    readEventFromDisk = jest.fn(
        async (path: string) => this.events.get(path) || null
    );
    createEvent = jest.fn(
        async (createdEvent: OFCEvent, plannedPath?: string) => {
            const path = plannedPath || this.nextCreatePath;
            this.existing.add(path);
            this.events.set(path, createdEvent);
            return {
                location: { file: file(path) },
                event: createdEvent,
            };
        }
    );
    modifyEvent = jest.fn(
        async (location: FullNoteEventPath, updatedEvent: OFCEvent) => {
            const newPath = this.nextModifyPath || location.path;
            this.existing.delete(location.path);
            this.events.delete(location.path);
            this.existing.add(newPath);
            this.events.set(newPath, updatedEvent);
            return {
                location: { file: file(newPath) },
                event: updatedEvent,
            };
        }
    );

    constructor(
        directory = "events",
        entries: Record<string, OFCEvent | null> = {}
    ) {
        super({} as ObsidianInterface, "#123456", directory);
        this.events = new Map(Object.entries(entries));
        Object.keys(entries).forEach((path) => this.existing.add(path));
        this.nextCreatePath = directory
            ? `${directory}/Untitled event.md`
            : "Untitled event.md";
    }

    getNewEventPath(): string {
        return this.nextCreatePath;
    }

    getNewLocation(
        location: FullNoteEventPath,
        _event: OFCEvent
    ): FullNoteEventLocation {
        return {
            file: file(this.nextModifyPath || location.path),
        };
    }

    hasFile(path: string): boolean {
        return this.existing.has(path);
    }
}

const makeCache = (
    calendar: TestFullNoteCalendar,
    calendarsByDirectory: Record<string, TestFullNoteCalendar> = {
        [calendar.directory]: calendar,
    }
): EventCache => {
    const initialize: LocalCalendarInitializer = (info) => {
        const configured = calendarsByDirectory[info.directory];
        if (!configured) throw new Error("Missing configured test calendar.");
        return configured;
    };
    const cache = new EventCache(initialize);
    cache.reset([
        {
            type: "local",
            directory: calendar.directory,
            color: calendar.color,
        },
    ]);
    return cache;
};

const sourceEvents = (cache: EventCache) =>
    cache.getAllEvents().flatMap((source) => source.events);

const eventPayloads = (callback: jest.Mock) =>
    callback.mock.calls
        .map(([payload]) => payload)
        .filter((payload) => payload.type === "events");

describe("single local EventCache runtime", () => {
    it("indexes only direct Markdown events with stable path IDs and no writes", async () => {
        const calendar = new TestFullNoteCalendar("work", {
            "work/A.md": event("A", "2026-08-22", { id: "authored" }),
            "work/B.MD": event("B", "2026-08-23", { id: "authored" }),
            "work/nested/C.md": event("Nested"),
            "work/Ignore.txt": event("Wrong extension"),
            "outside/D.md": event("Outside"),
            "work/Invalid.md": null,
        });
        const cache = makeCache(calendar);

        await cache.populate();
        const first = sourceEvents(cache);

        expect(first).toHaveLength(2);
        expect(new Set(first.map(({ id }) => id)).size).toBe(2);
        expect(first.map(({ id }) => id)).toEqual(
            expect.arrayContaining([
                expect.stringContaining(encodeURIComponent("work/A.md")),
                expect.stringContaining(encodeURIComponent("work/B.MD")),
            ])
        );
        expect(calendar.createEvent).not.toHaveBeenCalled();
        expect(calendar.modifyEvent).not.toHaveBeenCalled();

        cache.reset([
            { type: "local", directory: "work", color: calendar.color },
        ]);
        await cache.populate();
        expect(sourceEvents(cache).map(({ id }) => id)).toEqual(
            first.map(({ id }) => id)
        );
    });

    it("does not expose mutable index events through getAllEvents", async () => {
        const calendar = new TestFullNoteCalendar("events", {
            "events/A.md": event("Original", "2026-08-22", {
                categories: ["work"],
            }),
        });
        const cache = makeCache(calendar);
        await cache.populate();

        const exposed = sourceEvents(cache)[0].event;
        expect(() => {
            exposed.title = "Mutated";
        }).toThrow();
        expect(() => {
            exposed.categories![0] = "changed";
        }).toThrow();

        expect(sourceEvents(cache)[0].event).toMatchObject({
            title: "Original",
            categories: ["work"],
        });
    });

    it("resolves the current event ID from its path", async () => {
        const calendar = new TestFullNoteCalendar("events", {
            "events/A.md": event("A"),
        });
        const cache = makeCache(calendar);
        await cache.populate();

        expect(cache.getEventIdForPath("events/A.md")).toBe(
            sourceEvents(cache)[0].id
        );
        expect(cache.getEventIdForPath("events/Missing.md")).toBeNull();
    });

    it("retains direct-root production ownership and lifecycle semantics", async () => {
        const calendar = new TestFullNoteCalendar("", {
            "Root.md": event("Root"),
            "nested/Nested.md": event("Nested"),
            "Ignore.txt": event("Wrong extension"),
        });
        const cache = makeCache(calendar);

        await cache.populate();
        expect(calendar.id).toBe("local::");
        expect(sourceEvents(cache).map(({ event }) => event.title)).toEqual([
            "Root",
        ]);

        calendar.events.set("Root.md", event("Updated"));
        await cache.fileUpdated(file("Root.md"));
        expect(sourceEvents(cache)[0].event.title).toBe("Updated");

        calendar.events.delete("Root.md");
        calendar.existing.delete("Root.md");
        calendar.events.set("Moved.MD", event("Moved"));
        calendar.existing.add("Moved.MD");
        await cache.fileRenamed(file("Moved.MD"), "Root.md");
        expect(sourceEvents(cache)[0].id).toContain(
            encodeURIComponent("Moved.MD")
        );

        cache.fileDeleted("Moved.MD");
        calendar.events.delete("Moved.MD");
        calendar.existing.delete("Moved.MD");
        expect(sourceEvents(cache)).toHaveLength(0);

        const location = await cache.createEvent(event("Created"));
        expect(location.file.path).toBe("Untitled event.md");
        expect(sourceEvents(cache)).toHaveLength(1);
    });

    it("routes real FullNoteCalendar root scans and lifecycle events", async () => {
        const app = MockAppBuilder.make()
            .file("Root.md", new FileBuilder().frontmatter(event("Root")))
            .file("Ignore.txt", new FileBuilder().frontmatter(event("Ignore")))
            .folder(
                new MockAppBuilder("nested").file(
                    "Nested.md",
                    new FileBuilder().frontmatter(event("Nested"))
                )
            )
            .done();
        const metadata = new Map<string, OFCEvent>([
            ["Root.md", event("Root")],
            ["Ignore.txt", event("Ignore")],
            ["nested/Nested.md", event("Nested")],
        ]);
        const io: ObsidianInterface = {
            getAbstractFileByPath: (path) =>
                app.vault.getAbstractFileByPath(path),
            getRoot: () => app.vault.getRoot(),
            getFileByPath: (path) => {
                const found = app.vault.getAbstractFileByPath(path);
                return found instanceof TFile ? found : null;
            },
            getMetadata: (target) =>
                ({
                    frontmatter: metadata.get(target.path),
                } as unknown as import("obsidian").CachedMetadata),
            read: (target) => app.vault.read(target),
            create: jest.fn(),
            rewrite: jest.fn(),
            rename: jest.fn(),
        };
        const calendar = new FullNoteCalendar(io, "#123456", "");
        const cache = new EventCache(() => calendar);
        cache.reset([{ type: "local", directory: "", color: "#123456" }]);

        await cache.populate();
        expect(calendar.id).toBe("local::");
        expect(sourceEvents(cache).map(({ event }) => event.title)).toEqual([
            "Root",
        ]);

        metadata.set("Root.md", event("Updated"));
        const rootFile = io.getFileByPath("Root.md")!;
        await cache.fileUpdated(rootFile);
        expect(sourceEvents(cache)[0].event.title).toBe("Updated");

        rootFile.name = "Moved.MD";
        metadata.delete("Root.md");
        metadata.set("Moved.MD", event("Moved"));
        await cache.fileRenamed(rootFile, "Root.md");
        expect(sourceEvents(cache)[0].event.title).toBe("Moved");
        expect(
            cache.getInfoForFullNoteEvent(sourceEvents(cache)[0].id)?.location
                .path
        ).toBe("Moved.MD");

        const rootChildren = app.vault.getRoot().children;
        rootChildren.splice(rootChildren.indexOf(rootFile), 1);
        metadata.delete("Moved.MD");
        cache.fileDeleted("Moved.MD");
        expect(sourceEvents(cache)).toHaveLength(0);
    });

    it("retries a same-epoch population invalidated by a live owned refresh", async () => {
        const calendar = new TestFullNoteCalendar("events", {
            "events/A.md": event("A"),
            "events/B.md": event("B"),
        });
        const cache = makeCache(calendar);
        const slow = deferred<OFCEvent | null>();
        calendar.readEvent.mockImplementationOnce(() => slow.promise);

        const population = cache.populate();
        await Promise.resolve();
        await Promise.resolve();
        calendar.events.set("events/A.md", event("A updated"));
        await cache.fileUpdated(file("events/A.md"));
        slow.resolve(event("A stale"));
        await population;

        expect(sourceEvents(cache)).toHaveLength(2);
        expect(cache.initialized).toBe(true);
        expect(sourceEvents(cache).map(({ event }) => event.title)).toEqual([
            "A updated",
            "B",
        ]);
    });

    it("coalesces concurrent population callers for one epoch", async () => {
        const calendar = new TestFullNoteCalendar("events", {
            "events/A.md": event("A"),
            "events/B.md": event("B"),
        });
        const cache = makeCache(calendar);
        const slow = deferred<OFCEvent | null>();
        calendar.readEvent.mockImplementationOnce(() => slow.promise);

        const first = cache.populate();
        const second = cache.populate();
        const third = cache.populate();
        expect(second).toBe(first);
        expect(third).toBe(first);
        slow.resolve(event("A"));
        await Promise.all([first, second, third]);

        expect(calendar.listFiles).toHaveBeenCalledTimes(1);
        expect(sourceEvents(cache).map(({ event }) => event.title)).toEqual([
            "A",
            "B",
        ]);
    });

    it("starts a new population owner after reset and discards the old scan", async () => {
        const calendar = new TestFullNoteCalendar("events", {
            "events/A.md": event("Old"),
        });
        const cache = makeCache(calendar);
        const slow = deferred<OFCEvent | null>();
        calendar.readEvent.mockImplementationOnce(() => slow.promise);
        const oldFirst = cache.populate();
        const oldSecond = cache.populate();
        expect(oldSecond).toBe(oldFirst);

        calendar.events.set("events/A.md", event("Fresh"));
        const freshRead = deferred<OFCEvent | null>();
        calendar.readEvent.mockImplementationOnce(() => freshRead.promise);
        cache.reset([
            { type: "local", directory: "events", color: calendar.color },
        ]);
        const fresh = cache.populate();
        expect(fresh).not.toBe(oldFirst);
        slow.resolve(event("Old result"));
        let oldSettled = false;
        void oldFirst.then(() => {
            oldSettled = true;
        });
        await Promise.resolve();
        await Promise.resolve();
        expect(oldSettled).toBe(false);
        freshRead.resolve(event("Fresh"));
        await fresh;
        await Promise.all([oldFirst, oldSecond]);

        expect(sourceEvents(cache)[0].event.title).toBe("Fresh");
        expect(cache.initialized).toBe(true);
    });

    it("publishes only the latest reversed rapid update", async () => {
        const calendar = new TestFullNoteCalendar("events", {
            "events/A.md": event("Initial"),
        });
        const cache = makeCache(calendar);
        await cache.populate();
        const slow = deferred<OFCEvent | null>();
        calendar.readEvent
            .mockImplementationOnce(() => slow.promise)
            .mockResolvedValueOnce(event("Latest"));

        const stale = cache.fileUpdated(file("events/A.md"));
        const latest = cache.fileUpdated(file("events/A.md"));
        await latest;
        slow.resolve(event("Stale"));
        await stale;

        expect(sourceEvents(cache)[0].event.title).toBe("Latest");
    });

    it("routes direct updates, external renames, nested no-ops, and deletes", async () => {
        const calendar = new TestFullNoteCalendar("events", {
            "events/A.md": event("A"),
            "events/nested/N.md": event("Nested"),
        });
        const cache = makeCache(calendar);
        await cache.populate();
        const callback = jest.fn();
        cache.on("update", callback);

        await cache.fileUpdated(file("events/nested/N.md"));
        expect(callback).not.toHaveBeenCalled();

        calendar.events.set("events/A.md", event("Changed"));
        await cache.fileUpdated(file("events/A.md"));
        expect(sourceEvents(cache)[0].event.title).toBe("Changed");

        calendar.events.delete("events/A.md");
        calendar.events.set("events/B.md", event("Renamed"));
        calendar.existing.delete("events/A.md");
        calendar.existing.add("events/B.md");
        await cache.fileRenamed(file("events/B.md"), "events/A.md");
        expect(
            cache.getInfoForFullNoteEvent(sourceEvents(cache)[0].id)?.location
                .path
        ).toBe("events/B.md");

        cache.fileDeleted("events/B.md");
        expect(sourceEvents(cache)).toHaveLength(0);
        expect(eventPayloads(callback)).toHaveLength(3);
    });

    it("reads saved bytes directly for vault modify notifications", async () => {
        const calendar = new TestFullNoteCalendar("events", {
            "events/A.md": event("Before"),
        });
        const cache = makeCache(calendar);
        await cache.populate();
        calendar.readEvent.mockResolvedValue(event("Stale metadata"));
        calendar.readEventFromDisk.mockResolvedValue(event("Saved bytes"));

        await cache.fileModified(file("events/A.md"));

        expect(sourceEvents(cache)[0].event.title).toBe("Saved bytes");
        expect(calendar.readEventFromDisk).toHaveBeenCalledWith("events/A.md");
    });

    it("reconciles missed edits and new files from disk before a view returns", async () => {
        const calendar = new TestFullNoteCalendar("events", {
            "events/A.md": event("Before"),
        });
        const cache = makeCache(calendar);
        await cache.populate();
        const callback = jest.fn();
        cache.on("update", callback);
        calendar.readEvent.mockClear();
        calendar.readEventFromDisk.mockClear();

        calendar.events.set("events/A.md", event("Edited on disk"));
        calendar.events.set("events/New.md", event("New on disk"));
        calendar.existing.add("events/New.md");

        await cache.reconcileFromDisk();

        expect(
            sourceEvents(cache).map(({ event: cached }) => cached.title)
        ).toEqual(["Edited on disk", "New on disk"]);
        expect(calendar.readEvent).not.toHaveBeenCalled();
        expect(calendar.readEventFromDisk).toHaveBeenCalledTimes(2);
        expect(eventPayloads(callback)).toHaveLength(1);
        expect(eventPayloads(callback)[0].toAdd).toHaveLength(2);
    });

    it("commits create only after disk success and suppresses its listener", async () => {
        const calendar = new TestFullNoteCalendar();
        const cache = makeCache(calendar);
        await cache.populate();
        const callback = jest.fn();
        cache.on("update", callback);
        calendar.createEvent.mockImplementationOnce(
            async (createdEvent, plannedPath) => {
                expect(sourceEvents(cache)).toHaveLength(0);
                const path = plannedPath!;
                calendar.existing.add(path);
                calendar.events.set(path, createdEvent);
                await cache.fileUpdated(file(path));
                expect(sourceEvents(cache)).toHaveLength(0);
                return {
                    location: { file: file(path) },
                    event: createdEvent,
                };
            }
        );

        const location = await cache.createEvent(event("Created"));

        expect(location.file.path).toBe("events/Untitled event.md");
        expect(sourceEvents(cache)[0].event.title).toBe("Created");
        expect(eventPayloads(callback)).toHaveLength(1);
    });

    it("indexes create semantics returned from the exact persisted note", async () => {
        const calendar = new TestFullNoteCalendar();
        const cache = makeCache(calendar);
        await cache.populate();
        const diskEvent = event("Untitled event", "2026-08-22");
        calendar.createEvent.mockImplementationOnce(
            async (_requested, path) => {
                calendar.existing.add(path!);
                calendar.events.set(path!, diskEvent);
                return {
                    location: { file: file(path!) },
                    event: diskEvent,
                };
            }
        );

        await cache.createEvent(
            event("Requested title", "2026-08-22", {
                id: "discarded-authored-id",
                categories: ["discarded-category"],
                completed: false,
            })
        );

        expect(sourceEvents(cache)[0].event).toEqual(diskEvent);
        expect(sourceEvents(cache)[0].id).toContain(
            encodeURIComponent("events/Untitled event.md")
        );
    });

    it("serializes publication against unrelated refreshes during create", async () => {
        const calendar = new TestFullNoteCalendar("events", {
            "events/A.md": event("A"),
        });
        const cache = makeCache(calendar);
        await cache.populate();
        const callback = jest.fn();
        cache.on("update", callback);
        const pending = deferred<{
            location: { file: TFile };
            event: OFCEvent;
        }>();
        calendar.createEvent.mockReturnValueOnce(pending.promise);

        const creation = cache.createEvent(event("Created"));
        calendar.events.set("events/A.md", event("A external"));
        await cache.fileUpdated(file("events/A.md"));
        calendar.existing.add("events/Untitled event.md");
        calendar.events.set("events/Untitled event.md", event("Created"));
        pending.resolve({
            location: {
                file: file("events/Untitled event.md"),
            },
            event: event("Created"),
        });
        await creation;

        const payloads = eventPayloads(callback);
        expect(payloads).toHaveLength(2);
        expect(
            payloads[1].toAdd.map(
                (entry: { event: OFCEvent }) => entry.event.title
            )
        ).toEqual(["Created"]);
        expect(sourceEvents(cache).map(({ event }) => event.title)).toEqual([
            "A external",
            "Created",
        ]);
    });

    it("reconciles failed creates from authoritative disk bytes", async () => {
        const calendar = new TestFullNoteCalendar();
        const cache = makeCache(calendar);
        await cache.populate();
        const callback = jest.fn();
        cache.on("update", callback);
        calendar.createEvent.mockRejectedValueOnce(new Error("create failed"));

        await expect(cache.createEvent(event("Requested"))).rejects.toThrow(
            "create failed"
        );
        expect(sourceEvents(cache)).toHaveLength(0);
        expect(callback).not.toHaveBeenCalled();

        calendar.createEvent.mockImplementationOnce(async (_event, path) => {
            calendar.existing.add(path!);
            calendar.events.set(path!, event("Actual disk event"));
            throw new Error("create returned failure after side effect");
        });
        await expect(
            cache.createEvent(event("Never claim me"))
        ).rejects.toThrow("after side effect");
        expect(sourceEvents(cache)[0].event.title).toBe("Actual disk event");
        expect(eventPayloads(callback)).toHaveLength(1);
        expect(eventPayloads(callback)[0].toAdd[0].event.title).toBe(
            "Actual disk event"
        );
    });

    it("commits same-path writes after success and preserves stored metadata", async () => {
        const previous = event("Before", "2026-08-22", {
            id: "authored-id",
            categories: ["work"],
            completed: "2026-08-01",
        });
        const calendar = new TestFullNoteCalendar("events", {
            "events/A.md": previous,
        });
        const cache = makeCache(calendar);
        await cache.populate();
        const id = sourceEvents(cache)[0].id;
        const callback = jest.fn();
        cache.on("update", callback);
        const write = deferred<{
            location: { file: TFile };
            event: OFCEvent;
        }>();
        calendar.modifyEvent.mockImplementationOnce(
            async (_location, value) => {
                expect(cache.getEventById(id)?.title).toBe("Before");
                expect(value.categories).toEqual(["work"]);
                expect(value.id).toBe("authored-id");
                expect(value.type === "single" && value.completed).toBe(
                    "2026-08-01"
                );
                return write.promise;
            }
        );

        const update = cache.updateEventWithId(
            id,
            event("After", "2026-08-23", {
                id: "full-calendar-replacement",
                categories: [],
            })
        );
        expect(callback).not.toHaveBeenCalled();
        calendar.events.set(
            "events/A.md",
            event("After", "2026-08-23", {
                categories: ["work"],
                completed: "2026-08-01",
                id: "authored-id",
            })
        );
        write.resolve({
            location: {
                file: file("events/A.md"),
            },
            event: calendar.events.get("events/A.md")!,
        });
        await update;

        expect(sourceEvents(cache)[0].id).toBe(id);
        expect(cache.getEventById(id)).toMatchObject({
            title: "After",
            categories: ["work"],
            completed: "2026-08-01",
            id: "authored-id",
        });
        expect(eventPayloads(callback)[0].toRemove).toEqual([id]);
        expect(eventPayloads(callback)[0].toAdd[0].sourceId).toBe(calendar.id);
    });

    it("preserves authored metadata absence, false, and empty arrays exactly", async () => {
        const cases: Array<{
            name: string;
            previous: OFCEvent;
            expected: Partial<OFCEvent>;
            absent: string[];
        }> = [
            {
                name: "absent",
                previous: event("Absent"),
                expected: {},
                absent: ["id", "categories", "attendingDates", "completed"],
            },
            {
                name: "false-empty",
                previous: event("False empty", "2026-08-22", {
                    id: "authored",
                    categories: [],
                    attendingDates: [],
                    completed: false,
                }),
                expected: {
                    id: "authored",
                    categories: [],
                    attendingDates: [],
                    completed: false,
                },
                absent: [],
            },
        ];

        for (const fixture of cases) {
            const path = `events/${fixture.name}.md`;
            const calendar = new TestFullNoteCalendar("events", {
                [path]: fixture.previous,
            });
            const cache = makeCache(calendar);
            await cache.populate();
            const id = sourceEvents(cache)[0].id;

            await cache.updateEventWithId(
                id,
                event("Updated", "2026-08-23", {
                    id: "replacement",
                    categories: ["replacement"],
                    attendingDates: ["2026-08-30"],
                    completed: "replacement",
                })
            );

            const written = calendar.modifyEvent.mock.calls[0][1];
            expect(written).toMatchObject(fixture.expected);
            fixture.absent.forEach((key) =>
                expect(written).not.toHaveProperty(key)
            );
        }
    });

    it("publishes absent and explicit empty optional arrays as different", async () => {
        const calendar = new TestFullNoteCalendar("events", {
            "events/A.md": event("A"),
        });
        const cache = makeCache(calendar);
        await cache.populate();
        const callback = jest.fn();
        cache.on("update", callback);

        calendar.events.set(
            "events/A.md",
            event("A", "2026-08-22", { categories: [] })
        );
        await cache.fileUpdated(file("events/A.md"));

        expect(eventPayloads(callback)).toHaveLength(1);
        expect(eventPayloads(callback)[0].toAdd[0].event.categories).toEqual(
            []
        );
    });

    it("drains a suppressed same-path update after a successful write", async () => {
        const calendar = new TestFullNoteCalendar("events", {
            "events/A.md": event("Before"),
        });
        const cache = makeCache(calendar);
        await cache.populate();
        const id = sourceEvents(cache)[0].id;
        const callback = jest.fn();
        cache.on("update", callback);
        const pending = deferred<{
            location: { file: TFile };
            event: OFCEvent;
        }>();
        calendar.modifyEvent.mockReturnValueOnce(pending.promise);

        const update = cache.updateEventWithId(id, event("Requested"));
        calendar.events.set("events/A.md", event("External final"));
        await cache.fileUpdated(file("events/A.md"));
        pending.resolve({
            location: {
                file: file("events/A.md"),
            },
            event: event("Requested"),
        });
        await update;

        expect(cache.getEventById(id)?.title).toBe("External final");
        expect(eventPayloads(callback)).toHaveLength(2);
    });

    it("leaves a queued path absent when its reconciliation read fails", async () => {
        const calendar = new TestFullNoteCalendar("events", {
            "events/A.md": event("Before"),
        });
        const cache = makeCache(calendar);
        await cache.populate();
        const id = sourceEvents(cache)[0].id;
        const pending = deferred<{
            location: { file: TFile };
            event: OFCEvent;
        }>();
        calendar.modifyEvent.mockReturnValueOnce(pending.promise);
        const error = jest.spyOn(console, "error").mockImplementation(() => {});

        const update = cache.updateEventWithId(id, event("Requested"));
        await cache.fileUpdated(file("events/A.md"));
        calendar.readEventFromDisk.mockRejectedValueOnce(
            new Error("disk read unavailable")
        );
        pending.resolve({
            location: {
                file: file("events/A.md"),
            },
            event: event("Requested"),
        });
        await update;

        expect(cache.getEventById(id)).toBeNull();
        expect(error).toHaveBeenCalledWith(
            "Could not reconcile event note events/A.md from disk",
            expect.any(Error)
        );
        error.mockRestore();
    });

    it("suppresses intermediate rename callbacks and emits remove-old/add-new", async () => {
        const calendar = new TestFullNoteCalendar("events", {
            "events/A.md": event("Before"),
        });
        calendar.nextModifyPath = "events/B.md";
        const cache = makeCache(calendar);
        await cache.populate();
        const oldId = sourceEvents(cache)[0].id;
        const callback = jest.fn();
        cache.on("update", callback);
        calendar.modifyEvent.mockImplementationOnce(
            async (_location, value) => {
                calendar.existing.delete("events/A.md");
                calendar.events.delete("events/A.md");
                calendar.existing.add("events/B.md");
                calendar.events.set("events/B.md", event("External renamed"));
                await cache.fileRenamed(file("events/B.md"), "events/A.md");
                expect(sourceEvents(cache)[0].id).toBe(oldId);
                return {
                    location: {
                        file: file("events/B.md"),
                    },
                    event: value,
                };
            }
        );

        await cache.updateEventWithId(oldId, event("After"));

        const current = sourceEvents(cache)[0];
        expect(current.id).not.toBe(oldId);
        expect(current.event.title).toBe("External renamed");
        expect(eventPayloads(callback)[0].toRemove).toEqual([oldId]);
        expect(eventPayloads(callback)[0].toAdd[0].id).toBe(current.id);
    });

    it("invalidates uncertain paths after same-path and partial-rename failures", async () => {
        const calendar = new TestFullNoteCalendar("events", {
            "events/A.md": event("Disk before"),
        });
        const cache = makeCache(calendar);
        await cache.populate();
        const oldId = sourceEvents(cache)[0].id;
        const callback = jest.fn();
        cache.on("update", callback);
        calendar.modifyEvent.mockRejectedValueOnce(new Error("rewrite failed"));

        await expect(
            cache.updateEventWithId(oldId, event("Requested"))
        ).rejects.toThrow("rewrite failed");
        expect(cache.getEventById(oldId)?.title).toBe("Disk before");
        expect(callback).not.toHaveBeenCalled();
        const restoredId = sourceEvents(cache)[0].id;

        calendar.nextModifyPath = "events/B.md";
        calendar.modifyEvent.mockImplementationOnce(async () => {
            calendar.existing.delete("events/A.md");
            calendar.events.delete("events/A.md");
            calendar.existing.add("events/B.md");
            calendar.events.set("events/B.md", event("Actual old bytes"));
            await cache.fileRenamed(file("events/B.md"), "events/A.md");
            throw new Error("rewrite failed after rename");
        });
        await expect(
            cache.updateEventWithId(restoredId, event("Never claim requested"))
        ).rejects.toThrow("after rename");

        expect(sourceEvents(cache)).toHaveLength(1);
        expect(sourceEvents(cache)[0].event.title).toBe("Actual old bytes");
        expect(sourceEvents(cache)[0].id).not.toBe(restoredId);
        expect(eventPayloads(callback)).toHaveLength(1);
        expect(eventPayloads(callback)[0].toAdd[0].event.title).toBe(
            "Actual old bytes"
        );
        expect(
            eventPayloads(callback)[0].toAdd.some(
                ({ event: added }: { event: OFCEvent }) =>
                    added.title === "Never claim requested"
            )
        ).toBe(false);
    });

    it("gives an interleaved delete precedence over a successful write return", async () => {
        const calendar = new TestFullNoteCalendar("events", {
            "events/A.md": event("Before"),
        });
        const cache = makeCache(calendar);
        await cache.populate();
        const id = sourceEvents(cache)[0].id;
        calendar.modifyEvent.mockImplementationOnce(async () => {
            calendar.existing.delete("events/A.md");
            calendar.events.delete("events/A.md");
            cache.fileDeleted("events/A.md");
            return {
                location: {
                    file: file("events/A.md"),
                },
                event: event("Phantom"),
            };
        });

        await expect(
            cache.updateEventWithId(id, event("Phantom"))
        ).rejects.toThrow("not found");
        expect(sourceEvents(cache)).toHaveLength(0);
    });

    it("does not publish old-epoch mutations across same/different-folder reset", async () => {
        const eventsCalendar = new TestFullNoteCalendar("events", {
            "events/A.md": event("Before"),
        });
        const workCalendar = new TestFullNoteCalendar("work", {
            "work/W.md": event("Work"),
        });
        const cache = makeCache(eventsCalendar, {
            events: eventsCalendar,
            work: workCalendar,
        });
        await cache.populate();
        const oldId = sourceEvents(cache)[0].id;
        const pending = deferred<{
            location: { file: TFile };
            event: OFCEvent;
        }>();
        eventsCalendar.modifyEvent.mockReturnValueOnce(pending.promise);
        const update = cache.updateEventWithId(oldId, event("Old write"));
        await cache.fileUpdated(file("events/A.md"));

        cache.reset([{ type: "local", directory: "work", color: "#123456" }]);
        await cache.populate();
        eventsCalendar.existing.add("events/A.md");
        eventsCalendar.events.set("events/A.md", event("Old write"));
        pending.resolve({
            location: {
                file: file("events/A.md"),
            },
            event: event("Old write"),
        });
        await update;

        expect(sourceEvents(cache).map(({ event }) => event.title)).toEqual([
            "Work",
        ]);

        const createPending = deferred<{
            location: { file: TFile };
            event: OFCEvent;
        }>();
        workCalendar.createEvent.mockReturnValueOnce(createPending.promise);
        const creation = cache.createEvent(event("Created"));
        cache.reset([{ type: "local", directory: "work", color: "#123456" }]);
        await cache.populate();
        workCalendar.existing.add("work/Untitled event.md");
        workCalendar.events.set("work/Untitled event.md", event("Created"));
        createPending.resolve({
            location: {
                file: file("work/Untitled event.md"),
            },
            event: event("Created"),
        });
        await creation;
        expect(sourceEvents(cache)).toHaveLength(2);
        expect(sourceEvents(cache).map(({ event }) => event.title)).toEqual(
            expect.arrayContaining(["Work", "Created"])
        );
    });

    it("does not apply an old raw reconciliation read after a same-source reset", async () => {
        const calendar = new TestFullNoteCalendar("events", {
            "events/A.md": event("Before"),
        });
        const cache = makeCache(calendar);
        await cache.populate();
        const id = sourceEvents(cache)[0].id;
        const rawRead = deferred<OFCEvent | null>();
        calendar.modifyEvent.mockRejectedValueOnce(new Error("write failed"));
        calendar.readEventFromDisk.mockReturnValueOnce(rawRead.promise);

        const update = cache.updateEventWithId(id, event("Requested"));
        await Promise.resolve();
        await Promise.resolve();
        calendar.events.set("events/A.md", event("Fresh reset"));
        cache.reset([
            { type: "local", directory: "events", color: calendar.color },
        ]);
        await cache.populate();
        rawRead.resolve(event("Old raw result"));

        await expect(update).rejects.toThrow("write failed");
        expect(sourceEvents(cache)[0].event.title).toBe("Fresh reset");
    });

    it("reconciles a partial old-epoch rename into the reset source once", async () => {
        const calendar = new TestFullNoteCalendar("events", {
            "events/A.md": event("Before"),
        });
        calendar.nextModifyPath = "events/B.md";
        const cache = makeCache(calendar);
        await cache.populate();
        const oldId = sourceEvents(cache)[0].id;
        const pending = deferred<{
            location: { file: TFile };
            event: OFCEvent;
        }>();
        calendar.modifyEvent.mockReturnValueOnce(pending.promise);
        const callback = jest.fn();
        cache.on("update", callback);

        const update = cache.updateEventWithId(oldId, event("Requested"));
        cache.reset([
            { type: "local", directory: "events", color: calendar.color },
        ]);
        await cache.populate();

        calendar.events.delete("events/A.md");
        calendar.existing.delete("events/A.md");
        calendar.events.set("events/B.md", event("Raw destination"));
        calendar.existing.add("events/B.md");
        await cache.fileRenamed(file("events/B.md"), "events/A.md");
        await cache.fileUpdated(file("events/B.md"));
        pending.reject(new Error("partial writer failure"));

        await expect(update).rejects.toThrow("partial writer failure");
        const current = sourceEvents(cache);
        expect(current).toHaveLength(1);
        expect(current[0].event.title).toBe("Raw destination");
        expect(current[0].id).not.toBe(oldId);
        expect(
            cache.getInfoForFullNoteEvent(current[0].id)?.location.path
        ).toBe("events/B.md");
        expect(eventPayloads(callback)).toHaveLength(1);
        expect(eventPayloads(callback)[0].toRemove).toEqual([oldId]);
        expect(eventPayloads(callback)[0].toAdd[0].event.title).toBe(
            "Raw destination"
        );
    });

    it("isolates subscriber failures from disk and other subscribers", async () => {
        const calendar = new TestFullNoteCalendar();
        const cache = makeCache(calendar);
        await cache.populate();
        const error = jest.spyOn(console, "error").mockImplementation(() => {});
        const bad: UpdateViewCallback = () => {
            throw new Error("subscriber failed");
        };
        const good = jest.fn();
        cache.on("update", bad);
        cache.on("update", good);
        calendar.createEvent.mockImplementationOnce(async (created, path) => {
            calendar.existing.add(path!);
            calendar.events.set(path!, created);
            await cache.fileUpdated(file(path!));
            return {
                location: { file: file(path!) },
                event: created,
            };
        });

        await expect(
            cache.createEvent(event("Created"))
        ).resolves.toBeDefined();
        expect(sourceEvents(cache)).toHaveLength(1);
        expect(good).toHaveBeenCalled();
        expect(error).toHaveBeenCalled();
        error.mockRestore();
    });

    it("gives each subscriber an isolated event-delta payload", async () => {
        const calendar = new TestFullNoteCalendar();
        const cache = makeCache(calendar);
        await cache.populate();
        cache.on("update", (payload) => {
            if (payload.type !== "events") return;
            payload.toRemove.push("malicious-removal");
            payload.toAdd[0].event.title = "Mutated payload";
        });
        const observer = jest.fn();
        cache.on("update", observer);

        await cache.createEvent(event("Persisted"));

        const observed = observer.mock.calls[0][0];
        expect(observed.toRemove).toEqual([]);
        expect(observed.toAdd[0].event.title).toBe("Persisted");
        expect(sourceEvents(cache)[0].event.title).toBe("Persisted");
    });
});
