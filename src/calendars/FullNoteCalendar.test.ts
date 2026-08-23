import { join } from "path";
import { TFile } from "obsidian";

import { ObsidianInterface } from "src/ObsidianAdapter";
import { MockApp, MockAppBuilder } from "../../test_helpers/AppBuilder";
import { FileBuilder } from "../../test_helpers/FileBuilder";
import { OFCEvent } from "src/types";
import FullNoteCalendar, {
    FRIENDLY_RECURRENCE_ANCHOR,
    newTimedEventFrontmatter,
    parseFullNoteEvent,
} from "./FullNoteCalendar";
import { parseEvent } from "../types/schema";
import { fromEventApi, toEventInput } from "../ui/interop";

const makeApp = (
    app: MockApp
): ObsidianInterface & { read: (file: TFile) => Promise<string> } => ({
    getAbstractFileByPath: (path) => app.vault.getAbstractFileByPath(path),
    getRoot: () => app.vault.getRoot(),
    getFileByPath(path: string): TFile | null {
        const f = app.vault.getAbstractFileByPath(path);
        if (!f) {
            return null;
        }
        if (!(f instanceof TFile)) {
            return null;
        }
        return f;
    },
    getMetadata: (file) => app.metadataCache.getFileCache(file),
    read: (file) => app.vault.read(file),
    create: jest.fn(),
    rewrite: jest.fn(async (file: TFile, rewriteCallback) => {
        const result = await rewriteCallback(await app.vault.read(file));
        return Array.isArray(result) ? result[1] : undefined;
    }) as unknown as ObsidianInterface["rewrite"],
    rename: jest.fn(),
});

const dirName = "events";
const color = "#BADA55";

const readListedEvents = async (calendar: FullNoteCalendar) =>
    (
        await Promise.all(
            calendar.listFiles().map(async (listedFile) => {
                const event = await calendar.readEvent(
                    listedFile.path,
                    listedFile
                );
                return event
                    ? [{ event, path: listedFile.path, listedFile }]
                    : [];
            })
        )
    ).flat();

const readFileEvent = async (
    calendar: FullNoteCalendar,
    file: TFile
): Promise<OFCEvent> => {
    const event = await calendar.readEvent(file.path, {
        path: file.path,
        handle: file,
    });
    if (!event) throw new Error(`Could not parse test event ${file.path}.`);
    return event;
};

describe("note-first frontmatter", () => {
    it("parses a minimal timed event using the filename as its title", () => {
        expect(
            parseFullNoteEvent(
                {
                    date: "2026-08-21",
                    start: "09:30",
                    end: "10:15",
                    tags: ["event"],
                },
                "Planning"
            )
        ).toEqual({
            title: "Planning",
            type: "single",
            allDay: false,
            date: "2026-08-21",
            endDate: null,
            startTime: "09:30",
            endTime: "10:15",
        });
    });

    it("keeps an explicit title for backward compatibility", () => {
        expect(
            parseFullNoteEvent(
                {
                    title: "Frontmatter title",
                    date: "2026-08-21",
                    start: "09:30",
                    end: "10:15",
                    tags: ["event"],
                },
                "Filename title"
            )?.title
        ).toBe("Frontmatter title");
    });

    it("applies the filename before validating a legacy event", () => {
        expect(
            parseFullNoteEvent(
                {
                    date: "2026-08-21",
                    startTime: "09:30",
                    endTime: "10:15",
                },
                "Legacy event"
            )
        ).toMatchObject({
            title: "Legacy event",
            type: "single",
            allDay: false,
            startTime: "09:30",
            endTime: "10:15",
        });
    });

    it("treats an end at or before the start as overnight", () => {
        expect(
            parseFullNoteEvent(
                {
                    date: "2026-08-21",
                    start: "23:00",
                    end: "01:00",
                    tags: ["event"],
                },
                "Night shift"
            )
        ).toMatchObject({ endDate: "2026-08-22" });
    });

    it("retains nonreserved tags as category metadata", () => {
        expect(
            parseFullNoteEvent(
                {
                    date: "2026-08-21",
                    start: "09:30",
                    end: "10:15",
                    tags: ["event", "work", "Project A"],
                    message: "Preserved in the note",
                },
                "Categorized"
            )
        ).toMatchObject({ categories: ["work", "Project A"] });
    });

    it.each([
        [{ date: "2026-02-29", start: "09:00", end: "10:00" }],
        [{ date: "2026-08-21", start: "9:00", end: "10:00" }],
        [{ date: "2026-08-21", start: "25:00", end: "10:00" }],
        [{ date: "2026-08-21", start: "09:00", end: "10:99" }],
    ])("rejects invalid friendly date/time properties", (properties) => {
        expect(
            parseFullNoteEvent({ ...properties, tags: ["event"] }, "Invalid")
        ).toBeNull();
    });

    it("parses a weekly event with an optional start bound", () => {
        expect(
            parseFullNoteEvent(
                {
                    date: "2026-08-21",
                    start: "09:00",
                    end: "10:00",
                    weekday: "mOnDaY",
                    tags: ["event", "recurring"],
                },
                "Monday review"
            )
        ).toEqual({
            title: "Monday review",
            type: "recurring",
            allDay: false,
            daysOfWeek: ["M"],
            skipDates: [],
            startRecur: "2026-08-21",
            startTime: "09:00",
            endTime: "10:00",
        });
    });

    it("parses omitted dates and inclusive recurrence bounds", () => {
        expect(
            parseFullNoteEvent(
                {
                    date: "not-used-when-start-recurrence-is-set",
                    "start-recurrence": "2026-08-10",
                    "end-recurrence": "2026-08-31",
                    omit: ["2026-08-24", "2026-08-17", "2026-08-24"],
                    start: "09:00",
                    end: "10:00",
                    weekday: "Monday",
                    tags: ["event", "recurring"],
                },
                "Bounded review"
            )
        ).toEqual({
            title: "Bounded review",
            type: "recurring",
            allDay: false,
            daysOfWeek: ["M"],
            startRecur: "2026-08-10",
            endRecur: "2026-09-01",
            skipDates: ["2026-08-17", "2026-08-24"],
            startTime: "09:00",
            endTime: "10:00",
        });
    });

    it("parses unbounded first- and second-Saturday monthly events", () => {
        const first = parseFullNoteEvent(
            {
                start: "09:00",
                end: "10:00",
                weekday: "Saturday",
                week: 1,
                tags: ["event", "recurring"],
            },
            "First Saturday"
        );
        const second = parseFullNoteEvent(
            {
                start: "11:00",
                end: "12:00",
                weekday: "SATURDAY",
                week: 2,
                tags: ["event", "recurring"],
            },
            "Second Saturday"
        );

        expect(first).toMatchObject({
            type: "rrule",
            startDate: FRIENDLY_RECURRENCE_ANCHOR,
            rrule: "FREQ=MONTHLY;BYDAY=1SA",
        });
        expect(second).toMatchObject({
            type: "rrule",
            startDate: FRIENDLY_RECURRENCE_ANCHOR,
            rrule: "FREQ=MONTHLY;BYDAY=2SA",
        });
    });

    it("uses date as the lower bound for a monthly recurrence", () => {
        expect(
            parseFullNoteEvent(
                {
                    date: "2026-08-21",
                    start: "09:00",
                    end: "10:00",
                    weekday: "Saturday",
                    week: 1,
                    tags: ["event", "recurring"],
                },
                "First Saturday"
            )
        ).toMatchObject({
            type: "rrule",
            startDate: "2026-08-21",
            rrule: "FREQ=MONTHLY;BYDAY=1SA",
        });
    });

    it("applies omissions and an inclusive end to monthly recurrences", () => {
        expect(
            parseFullNoteEvent(
                {
                    "start-recurrence": "2026-08-01",
                    "end-recurrence": "2026-12-31",
                    omit: ["2026-10-03"],
                    start: "09:00",
                    end: "10:00",
                    weekday: "Saturday",
                    week: 1,
                    tags: ["event", "recurring"],
                },
                "First Saturday"
            )
        ).toMatchObject({
            type: "rrule",
            startDate: "2026-08-01",
            endRecur: "2027-01-01",
            skipDates: ["2026-10-03"],
        });
    });

    it.each([
        [{ tags: ["event", "recurring"] }],
        [{ weekday: "Mon", tags: ["event", "recurring"] }],
        [{ weekday: "Monday", week: 0, tags: ["event", "recurring"] }],
        [{ weekday: "Monday", week: 6, tags: ["event", "recurring"] }],
        [{ weekday: "Monday", week: "2", tags: ["event", "recurring"] }],
        [
            {
                weekday: "Monday",
                omit: "2026-08-22",
                tags: ["event", "recurring"],
            },
        ],
        [
            {
                weekday: "Monday",
                omit: ["not-a-date"],
                tags: ["event", "recurring"],
            },
        ],
        [
            {
                weekday: "Monday",
                "start-recurrence": "2026-09-01",
                "end-recurrence": "2026-08-31",
                tags: ["event", "recurring"],
            },
        ],
    ])("rejects invalid recurring properties", (properties) => {
        expect(
            parseFullNoteEvent(
                { start: "09:00", end: "10:00", ...properties },
                "Invalid recurring"
            )
        ).toBeNull();
    });
});

describe("Note Calendar Tests", () => {
    it.each([
        [
            "One event",
            [
                {
                    title: "2022-01-01 Test Event.md",
                    event: {
                        title: "Test Event",
                        allDay: true,
                        date: "2022-01-01",
                    } as OFCEvent,
                },
            ],
        ],
        [
            "Two events",
            [
                {
                    title: "2022-01-01 Test Event.md",
                    event: {
                        title: "Test Event",
                        allDay: true,
                        date: "2022-01-01",
                    } as OFCEvent,
                },
                {
                    title: "2022-01-02 Another Test Event.md",
                    event: {
                        title: "Another Test Event",
                        allDay: true,
                        date: "2022-01-02",
                    } as OFCEvent,
                },
            ],
        ],
        [
            "Two events on the same day",
            [
                {
                    title: "2022-01-01 Test Event.md",
                    event: {
                        title: "Test Event",
                        allDay: true,
                        date: "2022-01-01",
                    } as OFCEvent,
                },
                {
                    title: "2022-01-01 Another Test Event.md",
                    event: {
                        title: "Another Test Event",
                        date: "2022-01-01",
                        startTime: "11:00",
                        endTime: "12:00",
                    } as OFCEvent,
                },
            ],
        ],
    ])(
        "%p",
        async (_, inputs: { title: string; event: Partial<OFCEvent> }[]) => {
            const obsidian = makeApp(
                MockAppBuilder.make()
                    .folder(
                        inputs.reduce(
                            (builder, { title, event }) =>
                                builder.file(
                                    title,
                                    new FileBuilder().frontmatter(event)
                                ),
                            new MockAppBuilder(dirName)
                        )
                    )
                    .done()
            );
            const calendar = new FullNoteCalendar(obsidian, color, dirName);
            const res = await readListedEvents(calendar);
            expect(res.length).toBe(inputs.length);
            const events = res.map(({ event }) => event);
            const paths = res.map(({ path }) => path);

            for (const { event, title } of inputs.map((i) => ({
                title: i.title,
                event: {
                    endDate: null,
                    allDay: false,
                    type: "single",
                    ...i.event,
                },
            }))) {
                expect(events).toContainEqual(event);
                expect(paths).toContainEqual(`${dirName}/${title}`);
            }

            for (const { event, path, listedFile } of res) {
                const file = obsidian.getFileByPath(path)!;
                expect(listedFile.handle).toBe(file);
                expect(await calendar.readEvent(path, listedFile)).toEqual(
                    event
                );
            }
        }
    );
    it("keeps the existing initial scan limited to direct-child notes", async () => {
        const obsidian = makeApp(
            MockAppBuilder.make()
                .folder(
                    new MockAppBuilder(dirName)
                        .file(
                            "Direct.md",
                            new FileBuilder().frontmatter({
                                title: "Direct",
                                type: "single",
                                allDay: true,
                                date: "2026-08-22",
                            })
                        )
                        .folder(
                            new MockAppBuilder("nested").file(
                                "Nested.md",
                                new FileBuilder().frontmatter({
                                    title: "Nested",
                                    type: "single",
                                    allDay: true,
                                    date: "2026-08-23",
                                })
                            )
                        )
                )
                .done()
        );
        const calendar = new FullNoteCalendar(obsidian, color, dirName);

        const paths = (await readListedEvents(calendar)).map(
            ({ path }) => path
        );

        expect(paths).toEqual([`${dirName}/Direct.md`]);
    });

    it("uses the explicit vault root for retained root-source operations", async () => {
        const app = MockAppBuilder.make()
            .file(
                "Root.md",
                new FileBuilder().frontmatter({
                    title: "Root",
                    type: "single",
                    allDay: true,
                    date: "2026-08-22",
                    endDate: null,
                })
            )
            .file("Ignore.txt", new FileBuilder().text("ignored"))
            .folder(
                new MockAppBuilder("nested").file(
                    "Nested.md",
                    new FileBuilder().frontmatter({
                        title: "Nested",
                        type: "single",
                        allDay: true,
                        date: "2026-08-22",
                        endDate: null,
                    })
                )
            )
            .done();
        const obsidian = makeApp(app);
        const getAbstract = jest.spyOn(obsidian, "getAbstractFileByPath");
        const getRoot = jest.spyOn(obsidian, "getRoot");
        const calendar = new FullNoteCalendar(obsidian, color, "");

        expect(calendar.listFiles().map(({ path }) => path)).toEqual([
            "Root.md",
            "Ignore.txt",
        ]);
        expect(getRoot).toHaveBeenCalled();
        expect(getAbstract).not.toHaveBeenCalledWith("");
        expect((await calendar.readEvent("Root.md"))?.title).toBe("Root");
        expect(await calendar.readEvent("nested/Nested.md")).toBeNull();
        expect(calendar.getNewEventPath()).toBe("Untitled event.md");

        (obsidian.create as jest.Mock).mockResolvedValue({
            path: "Untitled event.md",
        });
        const created = await calendar.createEvent(
            parseEvent({
                title: "Requested",
                type: "single",
                allDay: false,
                date: "2026-08-24",
                startTime: "09:00",
                endTime: "10:00",
            })
        );
        expect(obsidian.create).toHaveBeenCalledWith(
            "Untitled event.md",
            expect.any(String)
        );
        expect(created.location.file.path).toBe("Untitled event.md");
        expect(created.event.title).toBe("Untitled event");

        expect(
            calendar.getNewLocation(
                { path: "Root.md" },
                parseEvent({
                    title: "Renamed",
                    type: "single",
                    allDay: true,
                    date: "2026-08-23",
                    endDate: null,
                })
            ).file.path
        ).toBe("2026-08-23 Renamed.md");
    });

    it("creates an event", async () => {
        const obsidian = makeApp(MockAppBuilder.make().done());
        const calendar = new FullNoteCalendar(obsidian, color, dirName);
        const event = {
            title: "Test Event",
            date: "2022-01-01",
            endDate: null,
            allDay: false,
            startTime: "11:00",
            endTime: "12:30",
        };

        (obsidian.create as jest.Mock).mockReturnValue({
            path: join(dirName, "2022-01-01 Test Event.md"),
        });
        const { event: persistedEvent } = await calendar.createEvent(
            parseEvent(event)
        );
        expect(persistedEvent).toMatchObject({
            title: "2022-01-01 Test Event",
            date: "2022-01-01",
            startTime: "11:00",
            endTime: "12:30",
        });
        expect(obsidian.create).toHaveBeenCalledTimes(1);
        const returns = (obsidian.create as jest.Mock).mock.calls[0];
        expect(returns).toMatchInlineSnapshot(`
            [
              "events/Untitled event.md",
              "---
            date: 2022-01-01
            start: 11:00
            end: 12:30
            tags:
              - event
            ---
            ",
            ]
        `);
    });

    it("uses a collision-safe filename", async () => {
        const event = {
            title: "Test Event",
            allDay: false,
            date: "2022-01-01",
            endDate: null,
            startTime: "11:00",
            endTime: "12:00",
        };
        const obsidian = makeApp(
            MockAppBuilder.make()
                .folder(
                    new MockAppBuilder("events").file(
                        "Untitled event.md",
                        new FileBuilder().frontmatter({
                            date: "2022-01-01",
                            start: "11:00",
                            end: "12:00",
                            tags: ["event"],
                        })
                    )
                )
                .done()
        );
        const calendar = new FullNoteCalendar(obsidian, color, dirName);
        (obsidian.create as jest.Mock).mockReturnValue({
            path: join(dirName, "Untitled event 1.md"),
        });

        const { event: persistedEvent } = await calendar.createEvent(
            parseEvent(event)
        );

        expect(obsidian.create).toHaveBeenCalledWith(
            "events/Untitled event 1.md",
            newTimedEventFrontmatter(parseEvent(event))
        );
        expect(persistedEvent.title).toBe("Untitled event 1");
        expect(persistedEvent).not.toHaveProperty("id");
        expect(persistedEvent).not.toHaveProperty("categories");
        expect(persistedEvent).not.toHaveProperty("completed");
    });

    it("modify an existing event and keeping the same day and title", async () => {
        const event = parseEvent({
            title: "Test Event",
            allDay: false,
            date: "2022-01-01",
            endDate: null,
            startTime: "11:00",
            endTime: "12:30",
            categories: ["work", "planning"],
            completed: "2021-01-01T10:30:00.000Z",
        });
        const filename = "2022-01-01 Test Event.md";
        const app = MockAppBuilder.make()
            .folder(
                new MockAppBuilder("events").file(
                    filename,
                    new FileBuilder().frontmatter(event)
                )
            )
            .done();
        app.vault.contents.set(
            "/events/2022-01-01 Test Event.md",
            [
                "---",
                "title: Test Event",
                "allDay: false",
                "startTime: 11:00",
                "endTime: 12:30",
                "type: single",
                "date: 2022-01-01",
                "endDate: null",
                "categories:",
                "  - work",
                "  - planning",
                "completed: 2021-01-01T10:30:00.000Z",
                "unknown:",
                "  nested: true",
                "---",
                "Legacy body stays intact",
                "",
            ].join("\n")
        );
        const obsidian = makeApp(app);
        const calendar = new FullNoteCalendar(obsidian, color, dirName);

        const firstFile = obsidian.getAbstractFileByPath(
            join("events", filename)
        ) as TFile;

        const contents = await obsidian.read(firstFile);

        const { location: newLoc, event: persistedEvent } =
            await calendar.modifyEvent(
                { path: join("events", filename) },
                // @ts-ignore
                { ...event, endTime: "13:30" }
            );
        expect(newLoc.file.path).toBe(join("events", filename));
        expect(persistedEvent).toMatchObject({
            title: "Test Event",
            endTime: "13:30",
            categories: ["work", "planning"],
            completed: "2021-01-01T10:30:00.000Z",
        });

        expect(obsidian.rewrite).toHaveReturnedTimes(1);
        const [file, rewriteCallback] = (obsidian.rewrite as jest.Mock).mock
            .calls[0];
        expect(file.path).toBe(join("events", filename));

        expect(rewriteCallback(contents)[0]).toBe(
            [
                "---",
                "title: Test Event",
                "allDay: false",
                "startTime: 11:00",
                "endTime: 13:30",
                "type: single",
                "date: 2022-01-01",
                "endDate: null",
                "categories:",
                "  - work",
                "  - planning",
                "completed: 2021-01-01T10:30:00.000Z",
                "unknown:",
                "  nested: true",
                "---",
                "Legacy body stays intact",
                "",
            ].join("\n")
        );
    });

    it("updates friendly timing without rewriting unknown properties or body", async () => {
        const filename = "Planning.md";
        const app = MockAppBuilder.make()
            .folder(
                new MockAppBuilder("events").file(
                    filename,
                    new FileBuilder().frontmatter({
                        date: "2026-08-21",
                        start: "09:00",
                        end: "10:00",
                        tags: ["event", "work"],
                        message: "Keep me",
                        completed: false,
                    })
                )
            )
            .done();
        app.vault.contents.set(
            "/events/Planning.md",
            [
                "---",
                "date: 2026-08-21",
                "start: 09:00",
                "end: 10:00",
                "tags:",
                "  - event",
                "  - work",
                "message: Keep me",
                "completed: false",
                "unknown:",
                "  nested: true",
                "---",
                "Body stays intact",
                "",
            ].join("\n")
        );
        const obsidian = makeApp(app);
        const calendar = new FullNoteCalendar(obsidian, color, dirName);
        const file = obsidian.getFileByPath(`events/${filename}`)!;
        const contents = await obsidian.read(file);

        const parsedEvent = await readFileEvent(calendar, file);
        const rendered = toEventInput("planning", parsedEvent)!;
        const movedEvent = fromEventApi({
            title: parsedEvent.title,
            allDay: false,
            start: new Date(2026, 7, 22, 23, 0),
            end: new Date(2026, 7, 23, 1, 0),
            extendedProps: rendered.extendedProps,
        } as any);
        expect(movedEvent.categories).toEqual(["work"]);
        expect(movedEvent).not.toHaveProperty("completed");

        const { event: persistedEvent } = await calendar.modifyEvent(
            { path: file.path },
            movedEvent
        );

        expect(persistedEvent).toMatchObject({
            title: "Planning",
            categories: ["work"],
            date: "2026-08-22",
            startTime: "23:00",
            endTime: "01:00",
        });

        expect(obsidian.rename).not.toHaveBeenCalled();
        const [, rewriteCallback] = (obsidian.rewrite as jest.Mock).mock
            .calls[0];
        expect(rewriteCallback(contents)[0]).toBe(
            [
                "---",
                "date: 2026-08-22",
                "start: 23:00",
                "end: 01:00",
                "tags:",
                "  - event",
                "  - work",
                "message: Keep me",
                "completed: false",
                "unknown:",
                "  nested: true",
                "---",
                "Body stays intact",
                "",
            ].join("\n")
        );
    });

    it("returns raw-page semantics when metadata cache fields are stale", async () => {
        const filename = "Stale metadata.md";
        const app = MockAppBuilder.make()
            .folder(
                new MockAppBuilder("events").file(
                    filename,
                    new FileBuilder().frontmatter({
                        title: "Metadata title",
                        type: "single",
                        allDay: false,
                        date: "2026-08-22",
                        startTime: "09:00",
                        endTime: "10:00",
                        id: "stale-id",
                        categories: ["stale"],
                        completed: false,
                    })
                )
            )
            .done();
        app.vault.contents.set(
            "/events/Stale metadata.md",
            [
                "---",
                "title: Raw title",
                "type: single",
                "allDay: false",
                "date: 2026-08-22",
                "startTime: 09:00",
                "endTime: 10:00",
                "id: raw-id",
                "categories:",
                "  - raw-category",
                "completed: 2026-08-01T12:34:56.000Z",
                "---",
                "Raw body",
                "",
            ].join("\n")
        );
        const obsidian = makeApp(app);
        const calendar = new FullNoteCalendar(obsidian, color, dirName);
        const { event: persistedEvent } = await calendar.modifyEvent(
            {
                path: `events/${filename}`,
            },
            parseEvent({
                title: "Moved",
                type: "single",
                allDay: false,
                date: "2026-08-23",
                startTime: "11:00",
                endTime: "12:00",
            })
        );

        expect(persistedEvent).toMatchObject({
            title: "Moved",
            date: "2026-08-23",
            startTime: "11:00",
            endTime: "12:00",
            id: "raw-id",
            categories: ["raw-category"],
            completed: "2026-08-01T12:34:56.000Z",
        });
    });

    it("writes recurring omissions as a clean YAML list", async () => {
        const filename = "Monday review.md";
        const app = MockAppBuilder.make()
            .folder(
                new MockAppBuilder("events").file(
                    filename,
                    new FileBuilder().frontmatter({
                        date: "2026-08-03",
                        start: "09:00",
                        end: "10:00",
                        weekday: "Monday",
                        omit: ["2026-08-10"],
                        tags: ["event", "recurring"],
                    })
                )
            )
            .done();
        app.vault.contents.set(
            "/events/Monday review.md",
            [
                "---",
                "date: 2026-08-03",
                "start: 09:00",
                "end: 10:00",
                "weekday: Monday",
                "omit:",
                "  - 2026-08-10",
                "tags:",
                "  - event",
                "  - recurring",
                "---",
                "Body stays intact",
                "",
            ].join("\n")
        );
        const obsidian = makeApp(app);
        const calendar = new FullNoteCalendar(obsidian, color, dirName);
        const file = obsidian.getFileByPath(`events/${filename}`)!;
        const contents = await obsidian.read(file);

        await calendar.modifyEvent(
            { path: file.path },
            parseEvent({
                title: "Monday review",
                type: "recurring",
                allDay: false,
                daysOfWeek: ["M"],
                startRecur: "2026-08-03",
                endRecur: "2026-09-01",
                skipDates: ["2026-08-10", "2026-08-24"],
                startTime: "09:00",
                endTime: "10:00",
            })
        );

        const [, rewriteCallback] = (obsidian.rewrite as jest.Mock).mock
            .calls[0];
        expect(rewriteCallback(contents)[0]).toBe(
            [
                "---",
                "date: 2026-08-03",
                "start: 09:00",
                "end: 10:00",
                "weekday: Monday",
                "omit:",
                "  - 2026-08-10",
                "  - 2026-08-24",
                "tags:",
                "  - event",
                "  - recurring",
                "start-recurrence: 2026-08-03",
                "end-recurrence: 2026-08-31",
                "---",
                "Body stays intact",
                "",
            ].join("\n")
        );
    });

    it("preserves legacy date while changing recurrence timing and omissions", async () => {
        const filename = "Different recurrence start.md";
        const app = MockAppBuilder.make()
            .folder(
                new MockAppBuilder("events").file(
                    filename,
                    new FileBuilder().frontmatter({
                        date: "1999-01-01",
                        "start-recurrence": "2026-08-03",
                        "end-recurrence": "2026-08-31",
                        start: "09:00",
                        end: "10:00",
                        weekday: "Monday",
                        omit: ["2026-08-17"],
                        tags: ["event", "recurring", "work"],
                        completed: "2026-08-01T12:34:56.000Z",
                    })
                )
            )
            .done();
        app.vault.contents.set(
            "/events/Different recurrence start.md",
            [
                "---",
                "date: 1999-01-01",
                "start-recurrence: 2026-08-03",
                "end-recurrence: 2026-08-31",
                "start: 09:00",
                "end: 10:00",
                "weekday: Monday",
                "tags:",
                "  - event",
                "  - recurring",
                "  - work",
                "completed: 2026-08-01T12:34:56.000Z",
                "unrelated: preserve-me",
                "unknown:",
                "  nested: true",
                "omit:",
                "  - 2026-08-17",
                "---",
                "Body stays byte-equivalent",
                "",
            ].join("\n")
        );
        const obsidian = makeApp(app);
        const calendar = new FullNoteCalendar(obsidian, color, dirName);
        const file = obsidian.getFileByPath(`events/${filename}`)!;
        const contents = await obsidian.read(file);

        const parsedEvent = await readFileEvent(calendar, file);
        const rendered = toEventInput("weekly", parsedEvent)!;
        const movedEvent = fromEventApi({
            title: parsedEvent.title,
            allDay: false,
            start: new Date(2026, 7, 10, 11, 30),
            end: new Date(2026, 7, 10, 12, 45),
            extendedProps: rendered.extendedProps,
        } as any);
        expect(movedEvent).toMatchObject({
            type: "recurring",
            categories: ["work"],
            startRecur: "2026-08-03",
            endRecur: "2026-09-01",
            skipDates: ["2026-08-17"],
        });

        await calendar.modifyEvent({ path: file.path }, movedEvent);

        const [, rewriteCallback] = (obsidian.rewrite as jest.Mock).mock
            .calls[0];
        expect(rewriteCallback(contents)[0]).toBe(
            [
                "---",
                "date: 1999-01-01",
                "start-recurrence: 2026-08-03",
                "end-recurrence: 2026-08-31",
                "start: 11:30",
                "end: 12:45",
                "weekday: Monday",
                "tags:",
                "  - event",
                "  - recurring",
                "  - work",
                "completed: 2026-08-01T12:34:56.000Z",
                "unrelated: preserve-me",
                "unknown:",
                "  nested: true",
                "omit:",
                "  - 2026-08-17",
                "---",
                "Body stays byte-equivalent",
                "",
            ].join("\n")
        );
    });
});
