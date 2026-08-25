import { EventApi, EventInput } from "@fullcalendar/core";
import { OFCEvent, parseEvent } from "../types";

import { DateTime, Duration } from "luxon";
import { rrulestr } from "rrule";

/*
 * Functions for converting between the types used by FullCalendar and those used internally by Keyboard Calendar.
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

export const selectionRequiresDayView = (viewType: string): boolean =>
    viewType === "dayGridMonth";

const recurringDuration = (start: Duration, end: Duration): Duration => {
    const duration = end.minus(start);
    return duration.as("milliseconds") <= 0
        ? duration.plus({ days: 1 })
        : duration;
};

const recurringDurationInput = (
    start: Duration,
    end: Duration
): EventInput["duration"] =>
    recurringDuration(start, end).normalize().toObject();

export function dateEndpointsToFrontmatter(
    start: Date,
    end: Date
): Partial<OFCEvent> {
    const date = getDate(start);
    const endDate = getDate(end);
    return {
        type: "single",
        date,
        endDate: date !== endDate ? endDate : undefined,
        startTime: getTime(start),
        endTime: getTime(end),
    };
}

/** Builds the persisted form of a single timed event after a grab move. */
export function moveSingleTimedEvent(
    event: OFCEvent,
    start: Date,
    end: Date
): OFCEvent | null {
    if (event.type !== "single") {
        return null;
    }
    return parseEvent({
        ...event,
        ...dateEndpointsToFrontmatter(start, end),
    });
}

/** Resolve the current local start of a concrete event for view navigation. */
export function getSingleEventStartDate(event: OFCEvent): Date | null {
    if (event.type !== "single") {
        return null;
    }
    const value = combineDateTimeStrings(event.date, event.startTime);
    const start = value ? DateTime.fromISO(value) : null;
    return start?.isValid ? start.toJSDate() : null;
}

export function toEventInput(
    id: string,
    frontmatter: OFCEvent
): EventInput | null {
    const categories = [...(frontmatter.categories || [])];
    const attendingDates = frontmatter.attendingDates
        ? [...frontmatter.attendingDates]
        : undefined;
    const commonExtendedProps = {
        categories,
        ...(attendingDates ? { attendingDates } : {}),
        ...(frontmatter.type !== "single" ? { ofcRecurring: true } : {}),
    };
    let event: EventInput = {
        id,
        title: frontmatter.title,
        allDay: false,
        extendedProps: commonExtendedProps,
    };
    if (frontmatter.type === "recurring") {
        const daysOfWeek = [...frontmatter.daysOfWeek];
        const skipDates = [...(frontmatter.skipDates || [])];
        const recurrenceMetadata = {
            daysOfWeek,
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
                    `FREQ=WEEKLY;BYDAY=${daysOfWeek
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
                    ...commonExtendedProps,
                    ofcRecurrence: recurrenceMetadata,
                },
            };
        } else {
            event = {
                ...event,
                daysOfWeek: daysOfWeek.map((c) => DAYS.indexOf(c)),
                startRecur: frontmatter.startRecur,
                endRecur: frontmatter.endRecur,
                extendedProps: {
                    ...commonExtendedProps,
                    ofcRecurrence: recurrenceMetadata,
                },
            };
        }
        const startTime = parseTime(frontmatter.startTime);
        const endTime = frontmatter.endTime && parseTime(frontmatter.endTime);
        event = {
            ...event,
            startTime: normalizeTimeString(frontmatter.startTime || ""),
            ...(startTime && endTime
                ? {
                      duration: recurringDurationInput(startTime, endTime),
                  }
                : {}),
        };
    } else if (frontmatter.type === "rrule") {
        const dtstartStr = combineDateTimeStrings(
            frontmatter.startDate,
            frontmatter.startTime
        );
        const dtstart = dtstartStr ? DateTime.fromISO(dtstartStr) : null;
        if (dtstart === null) {
            return null;
        }
        // NOTE: this supports one occurrence per recurrence date, matching the
        // note-first recurrence format.
        const exdate = getRecurrenceExceptions(
            [...frontmatter.skipDates],
            dtstart
        );

        event = {
            id,
            title: frontmatter.title,
            allDay: false,
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
            extendedProps: commonExtendedProps,
        };

        const startTime = parseTime(frontmatter.startTime);
        if (startTime && frontmatter.endTime) {
            const endTime = parseTime(frontmatter.endTime);
            const duration =
                endTime && recurringDurationInput(startTime, endTime);
            if (duration) {
                event.duration = duration;
            }
        }
    } else if (frontmatter.type === "single") {
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
            extendedProps: commonExtendedProps,
        };
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

export function attendEventOccurrence(event: OFCEvent, date: string): OFCEvent {
    const attendingDates = [
        ...new Set([...(event.attendingDates || []), date]),
    ].sort();
    return { ...event, attendingDates };
}

export function fromEventApi(event: EventApi): OFCEvent {
    if (event.allDay) {
        throw new Error("All-day events are not supported.");
    }
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
        ...(Array.isArray(event.extendedProps.attendingDates)
            ? { attendingDates: [...event.extendedProps.attendingDates] }
            : {}),
        startTime: getTime(event.start as Date),
        endTime: getTime(event.end as Date),

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
