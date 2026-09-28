import { OFCEvent } from "../types";
import { dateEndpointsToFrontmatter } from "./interop";

export const DEFAULT_EVENT_TITLE = "Untitled event";
const MAX_EVENT_BASENAME_LENGTH = 120;

/** The form values of the touch event-creation dialog, as native inputs report them. */
export interface EventDraft {
    title: string;
    /** YYYY-MM-DD */
    date: string;
    /** HH:MM */
    startTime: string;
    /** HH:MM */
    endTime: string;
}

export type ResolvedEventDraft =
    | {
          ok: true;
          event: Partial<OFCEvent>;
          basename: string;
          start: Date;
          end: Date;
      }
    | { ok: false; error: string };

const pad = (value: number): string => value.toString().padStart(2, "0");

const formatDraftDate = (date: Date): string =>
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

const formatDraftTime = (date: Date): string =>
    `${pad(date.getHours())}:${pad(date.getMinutes())}`;

/** Seed the dialog from a FullCalendar selection. */
export const createEventDraft = (start: Date, end: Date): EventDraft => ({
    title: "",
    date: formatDraftDate(start),
    startTime: formatDraftTime(start),
    endTime: formatDraftTime(end),
});

const parseDraftDate = (value: string): Date | null => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
    if (!match) {
        return null;
    }
    const [year, month, day] = match.slice(1).map(Number);
    const date = new Date(year, month - 1, day);
    return date.getFullYear() === year &&
        date.getMonth() === month - 1 &&
        date.getDate() === day
        ? date
        : null;
};

/** Native time inputs report HH:MM, or HH:MM:SS when a step allows seconds. */
const parseDraftMinutes = (value: string): number | null => {
    const match = /^(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(value.trim());
    if (!match) {
        return null;
    }
    const [hours, minutes] = match.slice(1).map(Number);
    return hours < 24 && minutes < 60 ? hours * 60 + minutes : null;
};

const atMinutes = (day: Date, minutes: number): Date =>
    new Date(
        day.getFullYear(),
        day.getMonth(),
        day.getDate(),
        Math.floor(minutes / 60),
        minutes % 60
    );

/**
 * A note basename from a free-text title. Characters Obsidian forbids in file
 * names, or that break wikilinks, become spaces; leading dots would hide the
 * file. An empty result falls back to the default title.
 */
export const eventBasenameFromTitle = (title: string): string => {
    const basename = title
        .replace(/[\\/:*?"<>|#^[\]\u0000-\u001f]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/^\.+/, "")
        .trim()
        .slice(0, MAX_EVENT_BASENAME_LENGTH)
        .trim();
    return basename || DEFAULT_EVENT_TITLE;
};

/**
 * Validate the dialog. An end time before the start means the event runs
 * past midnight, as a native time picker has no way to say "tomorrow".
 */
export const resolveEventDraft = (draft: EventDraft): ResolvedEventDraft => {
    const day = parseDraftDate(draft.date);
    if (!day) {
        return { ok: false, error: "Choose a date." };
    }
    const startMinutes = parseDraftMinutes(draft.startTime);
    const endMinutes = parseDraftMinutes(draft.endTime);
    if (startMinutes === null || endMinutes === null) {
        return { ok: false, error: "Choose a start and end time." };
    }
    if (startMinutes === endMinutes) {
        return { ok: false, error: "End time must differ from the start." };
    }
    const start = atMinutes(day, startMinutes);
    const endDay =
        endMinutes < startMinutes
            ? new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1)
            : day;
    const end = atMinutes(endDay, endMinutes);
    return {
        ok: true,
        event: dateEndpointsToFrontmatter(start, end),
        basename: eventBasenameFromTitle(draft.title),
        start,
        end,
    };
};
