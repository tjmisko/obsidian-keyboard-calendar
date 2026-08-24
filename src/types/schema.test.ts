import fc from "fast-check";
import { ZodFastCheck } from "zod-fast-check";
import {
    CommonSchema,
    EventSchema,
    OFCEvent,
    ParsedDate,
    ParsedTime,
    TimeSchema,
    parseEvent,
    validateEvent,
} from "./schema";

describe("schema parsing tests", () => {
    describe("timed single events", () => {
        it("defaults to a single event and requires a start time", () => {
            expect(
                parseEvent({
                    title: "Test",
                    date: "2021-01-01",
                    startTime: "10:30",
                })
            ).toEqual({
                title: "Test",
                type: "single",
                date: "2021-01-01",
                endDate: null,
                startTime: "10:30",
                endTime: null,
            });
        });

        it("strips a legacy false allDay marker", () => {
            expect(
                parseEvent({
                    title: "Legacy timed event",
                    type: "single",
                    date: "2021-01-01",
                    allDay: false,
                    startTime: "10:30 pm",
                    endTime: "11:45 pm",
                })
            ).toEqual({
                title: "Legacy timed event",
                type: "single",
                date: "2021-01-01",
                endDate: null,
                startTime: "10:30 pm",
                endTime: "11:45 pm",
            });
        });

        it("retains multi-day endpoints and legacy completion metadata", () => {
            expect(
                parseEvent({
                    title: "Overnight",
                    type: "single",
                    date: "2021-01-01",
                    endDate: "2021-01-03",
                    startTime: "23:00",
                    endTime: "01:00",
                    completed: false,
                })
            ).toEqual({
                title: "Overnight",
                type: "single",
                date: "2021-01-01",
                endDate: "2021-01-03",
                startTime: "23:00",
                endTime: "01:00",
                completed: false,
            });
        });
    });

    describe("timed recurring events", () => {
        it("parses a bounded weekly recurrence", () => {
            expect(
                parseEvent({
                    title: "Test",
                    type: "recurring",
                    daysOfWeek: ["M", "W"],
                    startRecur: "2023-01-05",
                    endRecur: "2023-05-12",
                    startTime: "09:00",
                    endTime: "10:00",
                })
            ).toEqual({
                title: "Test",
                type: "recurring",
                daysOfWeek: ["M", "W"],
                startRecur: "2023-01-05",
                endRecur: "2023-05-12",
                startTime: "09:00",
                endTime: "10:00",
            });
        });

        it("parses an rrule recurrence", () => {
            expect(
                parseEvent({
                    title: "Test",
                    type: "rrule",
                    id: "hi",
                    rrule: "RRULE",
                    skipDates: [],
                    startDate: "2023-01-05",
                    startTime: "09:00",
                    endTime: "10:00",
                })
            ).toEqual({
                title: "Test",
                type: "rrule",
                id: "hi",
                rrule: "RRULE",
                skipDates: [],
                startDate: "2023-01-05",
                startTime: "09:00",
                endTime: "10:00",
            });
        });
    });

    it.each(["single", "recurring", "rrule"])(
        "rejects legacy all-day %s events",
        (type) => {
            const event = {
                title: "Unsupported",
                type,
                allDay: true,
                date: "2021-01-01",
                daysOfWeek: ["M"],
                startDate: "2021-01-01",
                rrule: "FREQ=WEEKLY",
                skipDates: [],
            };

            expect(() => parseEvent(event)).toThrow(
                "All-day events are not supported."
            );
            expect(validateEvent(event)).toBeNull();
        }
    );

    it("logs only a fixed diagnostic for invalid private data", () => {
        const privateSentinel = "SYNTHETIC_PRIVATE_FIELD_DO_NOT_LOG";
        const debug = jest
            .spyOn(console, "debug")
            .mockImplementation(() => undefined);
        try {
            expect(
                validateEvent({
                    title: privateSentinel,
                    date: privateSentinel,
                })
            ).toBeNull();
            expect(debug).toHaveBeenCalledWith("Parsing failed with errors", {
                issueCount: expect.any(Number),
            });
            expect(JSON.stringify(debug.mock.calls)).not.toContain(
                privateSentinel
            );
        } finally {
            debug.mockRestore();
        }
    });

    describe("property-based tests", () => {
        const zfc = ZodFastCheck()
            .override(
                ParsedDate,
                fc
                    .date({
                        min: new Date(2000, 0, 0),
                        max: new Date(2150, 0, 0),
                    })
                    .map(
                        (date) =>
                            `${date.getFullYear()}-${(date.getMonth() + 1)
                                .toString()
                                .padStart(2, "0")}-${date
                                .getDate()
                                .toString()
                                .padStart(2, "0")}`
                    )
            )
            .override(
                ParsedTime,
                fc
                    .date()
                    .map(
                        (date) =>
                            `${date
                                .getHours()
                                .toString()
                                .padStart(2, "0")}:${date
                                .getMinutes()
                                .toString()
                                .padStart(2, "0")}`
                    )
            );

        it("parses", () => {
            const CommonArb = zfc.inputOf(CommonSchema);
            const TimeArb = zfc.inputOf(TimeSchema);
            const EventArb = zfc.inputOf(EventSchema);
            const EventInputArbitrary = fc
                .tuple(CommonArb, TimeArb, EventArb)
                .map(([common, time, event]) => ({
                    ...common,
                    ...time,
                    ...event,
                }));

            fc.assert(
                fc.property(EventInputArbitrary, (obj) => {
                    expect(() => parseEvent(obj)).not.toThrow();
                })
            );
        });

        it("normalizes parsed events idempotently", () => {
            const CommonArb = zfc.outputOf(CommonSchema);
            const TimeArb = zfc.outputOf(TimeSchema);
            const EventArb = zfc.outputOf(EventSchema);
            const OFCEventArbitrary: fc.Arbitrary<OFCEvent> = fc
                .tuple(CommonArb, TimeArb, EventArb)
                .map(([common, time, event]) => ({
                    ...common,
                    ...time,
                    ...event,
                }));

            fc.assert(
                fc.property(OFCEventArbitrary, (event) => {
                    expect(parseEvent({ ...event })).toEqual(event);
                })
            );
        });
    });
});
