import { EventApi, EventInput } from "@fullcalendar/core";
import { OFCEvent } from "../types";

import { DateTime, Duration } from "luxon";
import { rrulestr } from "rrule";

/*
 * Functions for converting between the types used by the FullCalendar view plugin and types used internally by Obsidian Full Calendar.
 */

const parseTime = (time: string): Duration | null => {
    let parsed = DateTime.fromFormat(time, "h:mm a");
    if (parsed.invalidReason) {
        parsed = DateTime.fromFormat(time, "HH:mm");
    }
    if (parsed.invalidReason) {
        parsed = DateTime.fromFormat(time, "HH:mm:ss");
    }

    if (parsed.invalidReason) {
        console.error(
            `FC: Error parsing time string '${time}': ${parsed.invalidReason}'`
        );
        return null;
    }

    return Duration.fromISOTime(
        parsed.toISOTime({
            includeOffset: false,
            includePrefix: false,
        })
    );
};

const normalizeTimeString = (time: string): string | null => {
    const parsed = parseTime(time);
    if (!parsed) {
        return null;
    }
    return parsed.toISOTime({
        suppressMilliseconds: true,
        includePrefix: false,
        suppressSeconds: true,
    });
};

const add = (date: DateTime, time: Duration): DateTime => {
    let hours = time.hours;
    let minutes = time.minutes;
    return date.set({ hour: hours, minute: minutes });
};

const getTime = (date: Date): string =>
    DateTime.fromJSDate(date).toISOTime({
        suppressMilliseconds: true,
        includeOffset: false,
        suppressSeconds: true,
    });

const getDate = (date: Date): string => DateTime.fromJSDate(date).toISODate();

const combineDateTimeStrings = (date: string, time: string): string | null => {
    const parsedDate = DateTime.fromISO(date);
    if (parsedDate.invalidReason) {
        console.error(
            `FC: Error parsing time string '${date}': ${parsedDate.invalidReason}`
        );
        return null;
    }

    const parsedTime = parseTime(time);
    if (!parsedTime) {
        return null;
    }

    return add(parsedDate, parsedTime).toISO({
        includeOffset: false,
        suppressMilliseconds: true,
    });
};

const DAYS = "UMTWRFS";
const RRULE_DAYS: Record<string, string> = {
    U: "SU",
    M: "MO",
    T: "TU",
    W: "WE",
    R: "TH",
    F: "FR",
    S: "SA",
};
const RECURRENCE_ANCHOR = "1970-01-01";

const getRecurrenceStart = (
    event: OFCEvent,
    startDate: string
): DateTime | null => {
    if (event.allDay) {
        return DateTime.fromISO(startDate);
    }
    const start = combineDateTimeStrings(startDate, event.startTime);
    return start ? DateTime.fromISO(start) : null;
};

const getRecurrenceExceptions = (
    dates: string[],
    recurrenceStart: DateTime
): string[] => {
    // RRule keeps one start time across timezone transitions, so exclusions
    // must use that same time while replacing only the local calendar date.
    const time = recurrenceStart.toJSDate().toISOString().split("T")[1];
    return dates.flatMap((date) => {
        const parsedDate = DateTime.fromISO(date).toISODate();
        return parsedDate ? `${parsedDate}T${time}` : [];
    });
};

const getRecurrenceEndRule = (
    endRecur: string | undefined,
    recurrenceStart: DateTime
): EventInput["exrule"] | undefined => {
    if (!endRecur) {
        return undefined;
    }
    const time = recurrenceStart.toJSDate().toISOString().split("T")[1];
    return {
        freq: "daily",
        dtstart: `${endRecur}T${time}`,
    };
};

export const selectionRequiresDayView = (
    viewType: string,
    allDay: boolean
): boolean => viewType === "dayGridMonth" || allDay;

const recurringDuration = (start: Duration, end: Duration): Duration => {
    const duration = end.minus(start);
    return duration.as("milliseconds") <= 0
        ? duration.plus({ days: 1 })
        : duration;
};

const recurringDurationString = (
    start: Duration,
    end: Duration
): string | null =>
    recurringDuration(start, end)
        .normalize()
        .shiftTo("hours", "minutes")
        .toISO();

export function dateEndpointsToFrontmatter(
    start: Date,
    end: Date,
    allDay: boolean
): Partial<OFCEvent> {
    const date = getDate(start);
    const endDate = getDate(end);
    return {
        type: "single",
        date,
        endDate: date !== endDate ? endDate : undefined,
        allDay,
        ...(allDay
            ? {}
            : {
                  startTime: getTime(start),
                  endTime: getTime(end),
              }),
    };
}

export function toEventInput(
    id: string,
    frontmatter: OFCEvent
): EventInput | null {
    let event: EventInput = {
        id,
        title: frontmatter.title,
        allDay: frontmatter.allDay,
        extendedProps: {
            categories: frontmatter.categories || [],
        },
    };
    if (frontmatter.type === "recurring") {
        const skipDates = frontmatter.skipDates || [];
        const recurrenceMetadata = {
            daysOfWeek: frontmatter.daysOfWeek,
            startRecur: frontmatter.startRecur,
            endRecur: frontmatter.endRecur,
            skipDates,
        };

        if (skipDates.length > 0) {
            const recurrenceStart = getRecurrenceStart(
                frontmatter,
                frontmatter.startRecur || RECURRENCE_ANCHOR
            );
            if (!recurrenceStart) {
                return null;
            }
            event = {
                ...event,
                rrule: rrulestr(
                    `FREQ=WEEKLY;BYDAY=${frontmatter.daysOfWeek
                        .map((day) => RRULE_DAYS[day])
                        .join(",")}`,
                    { dtstart: recurrenceStart.toJSDate() }
                ).toString(),
                exdate: getRecurrenceExceptions(skipDates, recurrenceStart),
                exrule: getRecurrenceEndRule(
                    frontmatter.endRecur,
                    recurrenceStart
                ),
                extendedProps: {
                    categories: frontmatter.categories || [],
                    ofcRecurrence: recurrenceMetadata,
                },
            };
        } else {
            event = {
                ...event,
                daysOfWeek: frontmatter.daysOfWeek.map((c) => DAYS.indexOf(c)),
                startRecur: frontmatter.startRecur,
                endRecur: frontmatter.endRecur,
                extendedProps: {
                    categories: frontmatter.categories || [],
                    ofcRecurrence: recurrenceMetadata,
                },
            };
        }
        if (!frontmatter.allDay) {
            const startTime = parseTime(frontmatter.startTime);
            const endTime =
                frontmatter.endTime && parseTime(frontmatter.endTime);
            event = {
                ...event,
                startTime: normalizeTimeString(frontmatter.startTime || ""),
                ...(startTime && endTime
                    ? {
                          duration: recurringDurationString(startTime, endTime),
                      }
                    : {}),
            };
        }
    } else if (frontmatter.type === "rrule") {
        const dtstart = (() => {
            if (frontmatter.allDay) {
                return DateTime.fromISO(frontmatter.startDate);
            } else {
                const dtstartStr = combineDateTimeStrings(
                    frontmatter.startDate,
                    frontmatter.startTime
                );

                if (!dtstartStr) {
                    return null;
                }
                return DateTime.fromISO(dtstartStr);
            }
        })();
        if (dtstart === null) {
            return null;
        }
        // NOTE: this supports one occurrence per recurrence date, matching the
        // note-first recurrence format.
        const exdate = getRecurrenceExceptions(frontmatter.skipDates, dtstart);

        event = {
            id,
            title: frontmatter.title,
            allDay: frontmatter.allDay,
            // Nth-weekday recurrence cannot currently be reconstructed from a
            // dragged FullCalendar occurrence. Source-level editability would
            // otherwise let fromEventApi collapse it into a single event.
            editable: false,
            startEditable: false,
            durationEditable: false,
            rrule: rrulestr(frontmatter.rrule, {
                dtstart: dtstart.toJSDate(),
            }).toString(),
            exdate,
            exrule: getRecurrenceEndRule(frontmatter.endRecur, dtstart),
            extendedProps: {
                categories: frontmatter.categories || [],
            },
        };

        if (!frontmatter.allDay) {
            const startTime = parseTime(frontmatter.startTime);
            if (startTime && frontmatter.endTime) {
                const endTime = parseTime(frontmatter.endTime);
                const duration =
                    endTime && recurringDurationString(startTime, endTime);
                if (duration) {
                    event.duration = duration;
                }
            }
        }
    } else if (frontmatter.type === "single") {
        if (!frontmatter.allDay) {
            const start = combineDateTimeStrings(
                frontmatter.date,
                frontmatter.startTime
            );
            if (!start) {
                return null;
            }
            let end = undefined;
            if (frontmatter.endTime) {
                end = combineDateTimeStrings(
                    frontmatter.endDate || frontmatter.date,
                    frontmatter.endTime
                );
                if (!end) {
                    return null;
                }
            }

            event = {
                ...event,
                start,
                end,
                extendedProps: {
                    categories: frontmatter.categories || [],
                },
            };
        } else {
            event = {
                ...event,
                start: frontmatter.date,
                end: frontmatter.endDate || undefined,
                extendedProps: {
                    categories: frontmatter.categories || [],
                },
            };
        }
    }

    return event;
}

export function omitRecurringOccurrence(
    event: OFCEvent,
    date: string
): OFCEvent {
    if (event.type === "single") {
        throw new Error("Only recurring events can omit an occurrence.");
    }
    const skipDates = [...new Set([...(event.skipDates || []), date])].sort();
    return { ...event, skipDates };
}

export function fromEventApi(event: EventApi): OFCEvent {
    const recurrenceMetadata = event.extendedProps.ofcRecurrence as
        | {
              daysOfWeek: string[];
              startRecur?: string;
              endRecur?: string;
              skipDates?: string[];
          }
        | undefined;
    const isRecurring: boolean =
        recurrenceMetadata !== undefined ||
        event.extendedProps.daysOfWeek !== undefined;
    const startDate = getDate(event.start as Date);
    const endDate = getDate(event.end as Date);
    return {
        title: event.title,
        categories: event.extendedProps.categories || [],
        ...(event.allDay
            ? { allDay: true }
            : {
                  allDay: false,
                  startTime: getTime(event.start as Date),
                  endTime: getTime(event.end as Date),
              }),

        ...(isRecurring
            ? {
                  type: "recurring",
                  daysOfWeek: recurrenceMetadata
                      ? recurrenceMetadata.daysOfWeek
                      : event.extendedProps.daysOfWeek.map(
                            (i: number) => DAYS[i]
                        ),
                  startRecur: recurrenceMetadata
                      ? recurrenceMetadata.startRecur
                      : event.extendedProps.startRecur &&
                        getDate(event.extendedProps.startRecur),
                  endRecur: recurrenceMetadata
                      ? recurrenceMetadata.endRecur
                      : event.extendedProps.endRecur &&
                        getDate(event.extendedProps.endRecur),
                  skipDates: recurrenceMetadata?.skipDates,
              }
            : {
                  type: "single",
                  date: startDate,
                  ...(startDate !== endDate ? { endDate } : { endDate: null }),
              }),
    };
}
