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

const makeApp = (app: MockApp): ObsidianInterface => ({
    getAbstractFileByPath: (path) => app.vault.getAbstractFileByPath(path),
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
    waitForMetadata: (file) =>
        new Promise((resolve) =>
            resolve(app.metadataCache.getFileCache(file)!)
        ),
    read: (file) => app.vault.read(file),
    create: jest.fn(),
    rewrite: jest.fn(),
    rename: jest.fn(),
    delete: jest.fn(),
    process: jest.fn(),
});

const dirName = "events";
const color = "#BADA55";

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
            startRecur: "2026-08-21",
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

    it.each([
        [{ tags: ["event", "recurring"] }],
        [{ weekday: "Mon", tags: ["event", "recurring"] }],
        [{ weekday: "Monday", week: 0, tags: ["event", "recurring"] }],
        [{ weekday: "Monday", week: 6, tags: ["event", "recurring"] }],
        [{ weekday: "Monday", week: "2", tags: ["event", "recurring"] }],
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
            const res = await calendar.getEvents();
            expect(res.length).toBe(inputs.length);
            const events = res.map((e) => e[0]);
            const paths = res.map((e) => e[1].file.path);

            expect(
                res.every((elt) => elt[1].lineNumber === undefined)
            ).toBeTruthy();

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

            for (const [
                event,
                {
                    file: { path },
                },
            ] of res) {
                const file = obsidian.getFileByPath(path)!;
                const eventsFromFile = await calendar.getEventsInFile(file);
                expect(eventsFromFile.length).toBe(1);
                expect(eventsFromFile[0][0]).toEqual(event);
            }
        }
    );
    it.todo("Recursive folder settings");

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
        const { lineNumber } = await calendar.createEvent(parseEvent(event));
        expect(lineNumber).toBeUndefined();
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

        await calendar.createEvent(parseEvent(event));

        expect(obsidian.create).toHaveBeenCalledWith(
            "events/Untitled event 1.md",
            newTimedEventFrontmatter(parseEvent(event))
        );
    });

    it("modify an existing event and keeping the same day and title", async () => {
        const event = parseEvent({
            title: "Test Event",
            allDay: false,
            date: "2022-01-01",
            endDate: null,
            startTime: "11:00",
            endTime: "12:30",
        });
        const filename = "2022-01-01 Test Event.md";
        const obsidian = makeApp(
            MockAppBuilder.make()
                .folder(
                    new MockAppBuilder("events").file(
                        filename,
                        new FileBuilder().frontmatter(event)
                    )
                )
                .done()
        );
        const calendar = new FullNoteCalendar(obsidian, color, dirName);

        const firstFile = obsidian.getAbstractFileByPath(
            join("events", filename)
        ) as TFile;

        const contents = await obsidian.read(firstFile);

        const mockFn = jest.fn();
        await calendar.modifyEvent(
            { path: join("events", filename), lineNumber: undefined },
            // @ts-ignore
            { ...event, endTime: "13:30" },
            mockFn
        );
        // TODO: make the third param a mock that we can inspect
        const newLoc = mockFn.mock.calls[0][0];
        expect(newLoc.file.path).toBe(join("events", filename));
        expect(newLoc.lineNumber).toBeUndefined();

        expect(obsidian.rewrite).toHaveReturnedTimes(1);
        const [file, rewriteCallback] = (obsidian.rewrite as jest.Mock).mock
            .calls[0];
        expect(file.path).toBe(join("events", filename));

        expect(rewriteCallback(contents)).toMatchInlineSnapshot(`
            "---
            title: Test Event
            allDay: false
            startTime: 11:00
            endTime: 13:30
            type: single
            date: 2022-01-01
            endDate: null
            ---
            "
        `);
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

        await calendar.modifyEvent(
            { path: file.path, lineNumber: undefined },
            parseEvent({
                title: "Planning",
                type: "single",
                allDay: false,
                date: "2026-08-22",
                startTime: "23:00",
                endTime: "01:00",
            }),
            jest.fn()
        );

        expect(obsidian.rename).not.toHaveBeenCalled();
        const [, rewriteCallback] = (obsidian.rewrite as jest.Mock).mock
            .calls[0];
        expect(rewriteCallback(contents)).toBe(
            [
                "---",
                "date: 2026-08-22",
                "start: 23:00",
                "end: 01:00",
                "tags:",
                "  - event",
                "  - work",
                "message: Keep me",
                "unknown:",
                "  nested: true",
                "---",
                "Body stays intact",
                "",
            ].join("\n")
        );
    });
    // it("modify an existing event with a new date", async () => {
    // 	const event: OFCEvent = {
    // 		title: "Test Event",
    // 		date: "2022-01-01",
    // 		startTime: "11:00",
    // 		endTime: "12:30",
    // 	};
    // 	const filename = "2022-01-01 Test Event.md";
    // 	const obsidian = makeApp(
    // 		MockAppBuilder.make()
    // 			.folder(
    // 				new MockAppBuilder("events").file(
    // 					filename,
    // 					new FileBuilder().frontmatter(event)
    // 				)
    // 			)
    // 			.done()
    // 	);
    // 	const calendar = new NoteCalendar(
    // 		obsidian,
    // 		color,
    // 		dirName,
    // 		false,
    // 		true
    // 	);

    // 	const firstFile = obsidian.getAbstractFileByPath(
    // 		join("events", filename)
    // 	) as TFile;

    // 	const contents = await obsidian.read(firstFile);

    // 	const newLoc = await calendar.modifyEvent(
    // 		{ path: join("events", filename), lineNumber: undefined },
    // 		{ ...event, date: "2022-01-02" }
    // 	);

    // 	const newFilename = "2022-01-02 Test Event.md";
    // 	expect(newLoc.file.path).toBe(join("events", newFilename));
    // 	expect(newLoc.lineNumber).toBeUndefined();

    // 	expect(obsidian.rewrite).toHaveReturnedTimes(1);
    // 	const [file, rewriteCallback] = (obsidian.rewrite as jest.Mock).mock
    // 		.calls[0];
    // 	expect(file.path).toBe(join("events", filename));
    // });
});
