import type { Calendar, EventInput, EventSourceApi } from "@fullcalendar/core";

import type { UpdateViewCallback } from "../core/EventCache";
import type { OFCEvent } from "../types";
import type { LocalMaterializedEventSource } from "./calendar";
import { toEventInput } from "./interop";

type CalendarUpdate = Parameters<UpdateViewCallback>[0];

type IncrementalFailure = {
    reason: string;
    eventId: string;
    sourceId: string;
};

type EventConverter = (id: string, event: OFCEvent) => EventInput | null;

export interface CalendarUpdateOptions {
    calendar: Calendar;
    update: CalendarUpdate;
    getEventSources: () => LocalMaterializedEventSource[];
    renderSelection: () => void;
    convertEvent?: EventConverter;
    warn?: (message: string) => void;
}

const rebuildEventSources = (
    calendar: Calendar,
    getEventSources: () => LocalMaterializedEventSource[]
): void => {
    calendar.removeAllEventSources();
    for (const source of getEventSources()) {
        calendar.addEventSource(source);
    }
};

const applyIncrementalUpdate = (
    calendar: Calendar,
    update: Extract<CalendarUpdate, { type: "events" }>,
    convertEvent: EventConverter
): IncrementalFailure | null => {
    for (const id of update.toRemove) {
        calendar.getEventById(id)?.remove();
    }

    for (const { id, event, sourceId } of update.toAdd) {
        let eventInput: EventInput | null;
        try {
            eventInput = convertEvent(id, event);
        } catch (_error) {
            return { reason: "event conversion threw", eventId: id, sourceId };
        }
        if (!eventInput) {
            return {
                reason: "event conversion returned null",
                eventId: id,
                sourceId,
            };
        }

        let source: EventSourceApi | null;
        try {
            source = calendar.getEventSourceById(sourceId);
        } catch (_error) {
            return {
                reason: "event source lookup threw",
                eventId: id,
                sourceId,
            };
        }
        if (!source) {
            return {
                reason: "event source was not found",
                eventId: id,
                sourceId,
            };
        }

        let insertedEvent;
        try {
            insertedEvent = calendar.addEvent(eventInput, source);
        } catch (_error) {
            return { reason: "addEvent threw", eventId: id, sourceId };
        }
        if (!insertedEvent) {
            return { reason: "addEvent returned null", eventId: id, sourceId };
        }

        let insertedById;
        try {
            insertedById = calendar.getEventById(id);
        } catch (_error) {
            return {
                reason: "inserted event lookup threw",
                eventId: id,
                sourceId,
            };
        }
        if (insertedEvent.id !== id || !insertedById) {
            return {
                reason: "event ID was missing after addEvent",
                eventId: id,
                sourceId,
            };
        }
    }

    return null;
};

const formatFallbackWarning = ({
    reason,
    eventId,
    sourceId,
}: IncrementalFailure): string =>
    `Full Calendar update fallback: ${reason}; event=${eventId}; source=${sourceId}`;

/** Keep an existing FullCalendar instance synchronized with EventCache. */
export const applyCalendarCacheUpdate = ({
    calendar,
    update,
    getEventSources,
    renderSelection,
    convertEvent = toEventInput,
    warn = console.warn,
}: CalendarUpdateOptions): void => {
    try {
        calendar.batchRendering(() => {
            if (update.type === "resync") {
                rebuildEventSources(calendar, getEventSources);
                return;
            }

            const failure = applyIncrementalUpdate(
                calendar,
                update,
                convertEvent
            );
            if (failure) {
                warn(formatFallbackWarning(failure));
                rebuildEventSources(calendar, getEventSources);
            }
        });
    } finally {
        renderSelection();
    }
};
