import { parseYaml, TFile, TFolder } from "obsidian";
import { DateTime } from "luxon";
import { rrulestr } from "rrule";
import { ObsidianInterface } from "../ObsidianAdapter";
import {
    fullNoteSourceId,
    OFCEvent,
    parseEvent,
    validateEvent,
} from "../types";
import {
    isDirectChildMarkdownPath,
    LocalEventFile,
    LocalEventReadAdapter,
} from "../core/LocalEventIndex";

export interface FullNoteEventPath {
    path: string;
}

export interface FullNoteEventLocation {
    file: { path: string };
}

export interface PersistedEventWrite {
    location: FullNoteEventLocation;
    event: OFCEvent;
}

export const FRIENDLY_RECURRENCE_ANCHOR = "1970-01-01";

const WEEKDAY_CODES: Record<string, { simple: string; rrule: string }> = {
    sunday: { simple: "U", rrule: "SU" },
    monday: { simple: "M", rrule: "MO" },
    tuesday: { simple: "T", rrule: "TU" },
    wednesday: { simple: "W", rrule: "WE" },
    thursday: { simple: "R", rrule: "TH" },
    friday: { simple: "F", rrule: "FR" },
    saturday: { simple: "S", rrule: "SA" },
};

const isObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

const normalizeTags = (value: unknown): string[] => {
    const tags = Array.isArray(value) ? value : [value];
    return tags.flatMap((tag) =>
        typeof tag === "string" && tag.trim()
            ? tag
                  .split(",")
                  .map((item) => item.trim().replace(/^#/, ""))
                  .filter(Boolean)
            : []
    );
};

const parseDate = (value: unknown): string | null => {
    if (typeof value !== "string") {
        return null;
    }
    const parsed = DateTime.fromFormat(value, "yyyy-MM-dd", { zone: "utc" });
    return parsed.isValid && parsed.toFormat("yyyy-MM-dd") === value
        ? value
        : null;
};

const parseDateList = (value: unknown): string[] | null => {
    if (value === undefined || value === null) {
        return [];
    }
    if (!Array.isArray(value)) {
        return null;
    }

    const dates = value.map(parseDate);
    if (dates.some((date) => date === null)) {
        return null;
    }
    return [...new Set(dates as string[])].sort();
};

const parseAttendingDates = (
    value: unknown,
    recurring: boolean
): string[] | null => {
    if (value === undefined) {
        return [];
    }
    if (!recurring) {
        const date = parseDate(value);
        return date ? [date] : null;
    }
    return value === null ? null : parseDateList(value);
};

const inclusiveToExclusiveDate = (date: string): string =>
    DateTime.fromISO(date, { zone: "utc" }).plus({ days: 1 }).toISODate();

const exclusiveToInclusiveDate = (date: string): string =>
    DateTime.fromISO(date, { zone: "utc" }).minus({ days: 1 }).toISODate();

const parseTime = (value: unknown): string | null => {
    if (typeof value !== "string" || !/^\d{2}:\d{2}$/.test(value)) {
        return null;
    }
    const parsed = DateTime.fromFormat(value, "HH:mm", { zone: "utc" });
    return parsed.isValid && parsed.toFormat("HH:mm") === value ? value : null;
};

/**
 * Convert the note-first event properties into the plugin's existing event
 * model. The `event` tag deliberately opts a note into this strict schema;
 * notes without it continue through the legacy parser.
 */
export function parseFullNoteEvent(
    frontmatter: unknown,
    filenameTitle: string
): OFCEvent | null {
    if (!isObject(frontmatter)) {
        return null;
    }

    const tags = normalizeTags(frontmatter.tags);
    const normalizedTags = tags.map((tag) => tag.toLowerCase());
    const isFriendly = normalizedTags.includes("event");
    const explicitTitle =
        typeof frontmatter.title === "string"
            ? frontmatter.title
            : filenameTitle;

    if (!isFriendly) {
        const attendingDates = parseAttendingDates(
            frontmatter.attending,
            frontmatter.type === "recurring" || frontmatter.type === "rrule"
        );
        if (attendingDates === null) {
            return null;
        }
        return validateEvent({
            ...frontmatter,
            title: explicitTitle,
            ...(attendingDates.length > 0 ? { attendingDates } : {}),
        });
    }

    const startTime = parseTime(frontmatter.start);
    const endTime = parseTime(frontmatter.end);
    if (!startTime || !endTime) {
        return null;
    }

    const categories = tags.filter(
        (_, index) => !["event", "recurring"].includes(normalizedTags[index])
    );
    const common = {
        title: explicitTitle,
        startTime,
        endTime,
        ...(categories.length > 0 ? { categories } : {}),
    };

    if (!normalizedTags.includes("recurring")) {
        const date =
            frontmatter.date === undefined
                ? undefined
                : parseDate(frontmatter.date);
        if (!date) {
            return null;
        }
        const attendingDates = parseAttendingDates(
            frontmatter.attending,
            false
        );
        if (attendingDates === null) {
            return null;
        }
        const endDate =
            endTime <= startTime
                ? DateTime.fromISO(date, { zone: "utc" })
                      .plus({ days: 1 })
                      .toISODate()
                : null;
        return parseEvent({
            ...common,
            type: "single",
            date,
            endDate,
            ...(attendingDates.length > 0 ? { attendingDates } : {}),
        });
    }

    const recurrenceStartValue =
        frontmatter["start-recurrence"] !== undefined
            ? frontmatter["start-recurrence"]
            : frontmatter.date;
    const recurrenceStart =
        recurrenceStartValue === undefined
            ? undefined
            : parseDate(recurrenceStartValue);
    const recurrenceEnd =
        frontmatter["end-recurrence"] === undefined
            ? undefined
            : parseDate(frontmatter["end-recurrence"]);
    const skipDates = parseDateList(frontmatter.omit);
    const attendingDates = parseAttendingDates(frontmatter.attending, true);
    if (
        recurrenceStart === null ||
        recurrenceEnd === null ||
        skipDates === null ||
        attendingDates === null ||
        (recurrenceStart && recurrenceEnd && recurrenceEnd < recurrenceStart)
    ) {
        return null;
    }
    const endRecur = recurrenceEnd
        ? inclusiveToExclusiveDate(recurrenceEnd)
        : undefined;

    if (typeof frontmatter.weekday !== "string") {
        return null;
    }
    const weekday = WEEKDAY_CODES[frontmatter.weekday.trim().toLowerCase()];
    if (!weekday) {
        return null;
    }

    if (frontmatter.week === undefined) {
        return parseEvent({
            ...common,
            type: "recurring",
            daysOfWeek: [weekday.simple],
            skipDates,
            ...(attendingDates.length > 0 ? { attendingDates } : {}),
            ...(recurrenceStart ? { startRecur: recurrenceStart } : {}),
            ...(endRecur ? { endRecur } : {}),
        });
    }

    if (
        typeof frontmatter.week !== "number" ||
        !Number.isInteger(frontmatter.week) ||
        frontmatter.week < 1 ||
        frontmatter.week > 5
    ) {
        return null;
    }

    return parseEvent({
        ...common,
        type: "rrule",
        startDate: recurrenceStart || FRIENDLY_RECURRENCE_ANCHOR,
        rrule: `FREQ=MONTHLY;BYDAY=${frontmatter.week}${weekday.rrule}`,
        skipDates,
        ...(attendingDates.length > 0 ? { attendingDates } : {}),
        ...(endRecur ? { endRecur } : {}),
    });
}

const basenameFromEvent = (event: OFCEvent): string => {
    switch (event.type) {
        case undefined:
        case "single":
            return `${event.date} ${event.title}`;
        case "recurring":
            return `(Every ${event.daysOfWeek.join(",")}) ${event.title}`;
        case "rrule":
            return `(${rrulestr(event.rrule).toText()}) ${event.title}`;
    }
};

const filenameForEvent = (event: OFCEvent) => `${basenameFromEvent(event)}.md`;

const FRONTMATTER_SEPARATOR = "---";

/**
 * @param page Contents of a markdown file.
 * @returns Whether or not this page has a frontmatter section.
 */
function hasFrontmatter(page: string): boolean {
    return (
        page.indexOf(FRONTMATTER_SEPARATOR) === 0 &&
        page.slice(3).indexOf(FRONTMATTER_SEPARATOR) !== -1
    );
}

/**
 * Return only frontmatter from a page.
 * @param page Contents of a markdown file.
 * @returns Frontmatter section of a page.
 */
function extractFrontmatter(page: string): string | null {
    if (hasFrontmatter(page)) {
        return page.split(FRONTMATTER_SEPARATOR)[1];
    }
    return null;
}

/**
 * Remove frontmatter from a page.
 * @param page Contents of markdown file.
 * @returns Contents of a page without frontmatter.
 */
function extractPageContents(page: string): string {
    if (hasFrontmatter(page)) {
        // Frontmatter lives between the first two --- linebreaks.
        return page.split("---").slice(2).join("---");
    } else {
        return page;
    }
}

function replaceFrontmatter(page: string, newFrontmatter: string): string {
    return `---\n${newFrontmatter}---${extractPageContents(page)}`;
}

type PrintableAtom = Array<number | string> | number | string | boolean | null;
const REMOVE_FRONTMATTER_PROPERTY = Symbol("remove-frontmatter-property");
type FrontmatterModification =
    | PrintableAtom
    | undefined
    | typeof REMOVE_FRONTMATTER_PROPERTY;

function stringifyYamlAtom(v: PrintableAtom): string {
    let result = "";
    if (Array.isArray(v)) {
        result += "[";
        result += v.map(stringifyYamlAtom).join(",");
        result += "]";
    } else {
        result += `${v}`;
    }
    return result;
}

function stringifyYamlLine(
    k: string | number | symbol,
    v: PrintableAtom
): string {
    return `${String(k)}: ${stringifyYamlAtom(v)}`;
}

function stringifyYamlLines(
    k: string | number | symbol,
    v: PrintableAtom
): string[] {
    if (String(k) === "omit" && Array.isArray(v)) {
        return [
            `${String(k)}:`,
            ...v.map((item) => `  - ${stringifyYamlAtom(item)}`),
        ];
    }
    return [stringifyYamlLine(k, v)];
}

function modifyFrontmatterString(
    page: string,
    modifications: Record<string, FrontmatterModification>
): string {
    const frontmatter = extractFrontmatter(page)?.split("\n");
    let newFrontmatter: string[] = [];
    if (!frontmatter) {
        newFrontmatter = Object.entries(modifications)
            .filter(
                ([, v]) => v !== undefined && v !== REMOVE_FRONTMATTER_PROPERTY
            )
            .flatMap(([k, v]) => stringifyYamlLines(k, v as PrintableAtom));
        page = "\n" + page;
    } else {
        const linesAdded: Set<string | number | symbol> = new Set();
        // Modify rows in-place.
        for (let i = 0; i < frontmatter.length; i++) {
            const line: string = frontmatter[i];
            if (line === "" && (i === 0 || i === frontmatter.length - 1)) {
                continue;
            }
            const keyMatch = /^([A-Za-z0-9_-]+)\s*:/.exec(line);
            if (!keyMatch) {
                newFrontmatter.push(line);
                continue;
            }
            const key = keyMatch[1];
            linesAdded.add(key);
            const newVal = modifications[key];
            if (newVal === REMOVE_FRONTMATTER_PROPERTY) {
                while (
                    i + 1 < frontmatter.length &&
                    /^\s+\S/.test(frontmatter[i + 1])
                ) {
                    i += 1;
                }
            } else if (newVal !== undefined) {
                newFrontmatter.push(...stringifyYamlLines(key, newVal));
                while (
                    i + 1 < frontmatter.length &&
                    /^\s+\S/.test(frontmatter[i + 1])
                ) {
                    i += 1;
                }
            } else {
                // Just push the old line if we don't have a modification.
                newFrontmatter.push(line);
            }
        }

        // Add all rows that were not originally in the frontmatter.
        newFrontmatter.push(
            ...Object.keys(modifications)
                .filter((k) => !linesAdded.has(k))
                .filter(
                    (k) =>
                        modifications[k] !== undefined &&
                        modifications[k] !== REMOVE_FRONTMATTER_PROPERTY
                )
                .flatMap((k) =>
                    stringifyYamlLines(k, modifications[k] as PrintableAtom)
                )
        );
    }
    return replaceFrontmatter(page, newFrontmatter.join("\n") + "\n");
}

export function newTimedEventFrontmatter(event: OFCEvent): string {
    if (event.type !== "single" || !event.startTime || !event.endTime) {
        throw new Error(
            "Full-note events must have a date, start, and end time."
        );
    }
    const categories = (event.categories || []).filter(
        (category) => !["event", "recurring"].includes(category.toLowerCase())
    );
    return [
        "---",
        `date: ${event.date}`,
        `start: ${event.startTime}`,
        `end: ${event.endTime}`,
        "tags:",
        "  - event",
        ...categories.map((category) => `  - ${category}`),
        "---",
        "",
    ].join("\n");
}

const isFriendlyFrontmatter = (frontmatter: unknown): boolean => {
    if (!isObject(frontmatter)) {
        return false;
    }
    return normalizeTags(frontmatter.tags)
        .map((tag) => tag.toLowerCase())
        .includes("event");
};

const friendlyModifications = (
    event: OFCEvent
): Record<string, FrontmatterModification> => {
    let date: string | undefined;
    let endRecur: string | undefined;
    let skipDates: string[] | undefined;
    const attending =
        event.attendingDates === undefined
            ? undefined
            : event.attendingDates.length === 0
            ? REMOVE_FRONTMATTER_PROPERTY
            : event.type === "single"
            ? event.attendingDates[0]
            : [...event.attendingDates];
    if (event.type === "single") {
        date = event.date;
    } else if (event.type === "recurring") {
        endRecur = event.endRecur;
        skipDates = event.skipDates;
    } else {
        const recurrenceStart =
            event.startDate === FRIENDLY_RECURRENCE_ANCHOR
                ? undefined
                : event.startDate;
        date = undefined;
        endRecur = event.endRecur;
        skipDates = event.skipDates;
        return {
            allDay: REMOVE_FRONTMATTER_PROPERTY,
            "start-recurrence": recurrenceStart,
            "end-recurrence": endRecur
                ? exclusiveToInclusiveDate(endRecur)
                : undefined,
            omit: skipDates?.length ? skipDates : undefined,
            attending,
            start: event.startTime,
            end: event.endTime || undefined,
        };
    }
    return {
        allDay: REMOVE_FRONTMATTER_PROPERTY,
        date,
        ...(event.type !== "single"
            ? {
                  "start-recurrence": event.startRecur,
                  "end-recurrence": endRecur
                      ? exclusiveToInclusiveDate(endRecur)
                      : undefined,
                  omit: skipDates?.length ? skipDates : undefined,
              }
            : {}),
        start: event.startTime,
        end: event.endTime || undefined,
        attending,
    };
};

const legacyModifications = (
    event: OFCEvent
): Record<string, FrontmatterModification> => {
    const modifications = {
        ...event,
        allDay: REMOVE_FRONTMATTER_PROPERTY,
    } as Record<string, FrontmatterModification>;
    // Categories travel through FullCalendar so cache state survives a
    // drag/resize. Both values are unrelated to timing edits and must retain
    // their original YAML representation; `completed` remains parse-compatible
    // only.
    delete modifications.categories;
    delete modifications.completed;
    delete modifications.attendingDates;
    modifications.attending =
        event.attendingDates === undefined
            ? undefined
            : event.attendingDates.length === 0
            ? REMOVE_FRONTMATTER_PROPERTY
            : event.type === "single"
            ? event.attendingDates[0]
            : [...event.attendingDates];
    return modifications;
};

export default class FullNoteCalendar implements LocalEventReadAdapter {
    app: ObsidianInterface;
    readonly color: string;
    private _directory: string;
    private friendlyPaths = new Set<string>();

    constructor(app: ObsidianInterface, color: string, directory: string) {
        this.app = app;
        this.color = color;
        this._directory = directory;
    }
    get directory(): string {
        return this._directory;
    }

    get id(): string {
        return fullNoteSourceId({
            type: "local",
            color: this.color,
            directory: this.directory,
        });
    }

    listFiles(): readonly LocalEventFile[] {
        const eventFolder = this.directory.replace(/^\/+|\/+$/g, "")
            ? this.app.getAbstractFileByPath(this.directory)
            : this.app.getRoot();
        if (!eventFolder) {
            throw new Error(`Cannot get folder ${this.directory}`);
        }
        if (!(eventFolder instanceof TFolder)) {
            throw new Error(`${eventFolder} is not a directory.`);
        }
        return eventFolder.children.flatMap((file) =>
            file instanceof TFile ? [{ path: file.path, handle: file }] : []
        );
    }

    async readEvent(
        path: string,
        listedFile?: LocalEventFile
    ): Promise<OFCEvent | null> {
        if (!isDirectChildMarkdownPath(this.directory, path)) {
            return null;
        }
        const file =
            listedFile?.handle instanceof TFile
                ? listedFile.handle
                : this.app.getFileByPath(path);
        if (!file) {
            return null;
        }
        return parseFullNoteEvent(
            this.app.getMetadata(file)?.frontmatter,
            file.basename
        );
    }

    async readEventFromDisk(path: string): Promise<OFCEvent | null> {
        if (!isDirectChildMarkdownPath(this.directory, path)) {
            return null;
        }
        const file = this.app.getFileByPath(path);
        if (!file) return null;
        const page = await this.app.read(file);
        const rawFrontmatter = extractFrontmatter(page);
        return parseFullNoteEvent(
            rawFrontmatter ? parseYaml(rawFrontmatter) : null,
            this.basenameForPath(path)
        );
    }

    hasFile(path: string): boolean {
        return this.app.getFileByPath(path) !== null;
    }

    getNewEventPath(preferredBasename = "Untitled event"): string {
        const requestedBasename = preferredBasename
            .trim()
            .replace(/\.md$/i, "");
        if (
            !requestedBasename ||
            requestedBasename.includes("/") ||
            requestedBasename.includes("\\")
        ) {
            throw new Error(
                "Event filename must be a plain Markdown basename."
            );
        }
        let suffix = 0;
        let path: string;
        const directory = this.directory.replace(/\/+$/, "");
        do {
            const basename = `${requestedBasename}${
                suffix ? ` ${suffix}` : ""
            }.md`;
            path = directory ? `${directory}/${basename}` : basename;
            suffix += 1;
        } while (this.app.getAbstractFileByPath(path));

        return path;
    }

    async createEvent(
        event: OFCEvent,
        plannedPath = this.getNewEventPath()
    ): Promise<PersistedEventWrite> {
        if (event.type !== "single" || !event.startTime || !event.endTime) {
            throw new Error(
                "Full-note events must have a date, start, and end time."
            );
        }
        if (!isDirectChildMarkdownPath(this.directory, plannedPath)) {
            throw new Error(
                `Event path ${plannedPath} is outside the configured folder.`
            );
        }
        const file = await this.app.create(
            plannedPath,
            newTimedEventFrontmatter(event)
        );
        this.friendlyPaths.add(file.path);
        const writtenFrontmatter = extractFrontmatter(
            newTimedEventFrontmatter(event)
        );
        const persistedEvent = parseFullNoteEvent(
            writtenFrontmatter ? parseYaml(writtenFrontmatter) : null,
            this.basenameForPath(file.path)
        );
        if (!persistedEvent) {
            throw new Error(`Created event note ${file.path} is not readable.`);
        }
        return {
            location: { file },
            event: persistedEvent,
        };
    }

    private isFriendlyEventFile(path: string): boolean {
        if (this.friendlyPaths.has(path)) {
            return true;
        }
        const file = this.app.getFileByPath(path);
        if (!file) {
            return false;
        }
        return isFriendlyFrontmatter(this.app.getMetadata(file)?.frontmatter);
    }

    fileRenamed(oldPath: string, newPath: string): void {
        if (this.friendlyPaths.delete(oldPath)) {
            this.friendlyPaths.add(newPath);
        }
    }

    getNewLocation(
        location: FullNoteEventPath,
        event: OFCEvent
    ): FullNoteEventLocation {
        const { path } = location;
        const file = this.app.getFileByPath(path);
        if (!file) {
            throw new Error(
                `File ${path} either doesn't exist or is a folder.`
            );
        }

        if (this.isFriendlyEventFile(path)) {
            return { file };
        }

        const parentPath = file.parent.path.replace(/\/+$/, "");
        const updatedPath = parentPath
            ? `${parentPath}/${filenameForEvent(event)}`
            : filenameForEvent(event);
        return { file: { path: updatedPath } };
    }

    async modifyEvent(
        location: FullNoteEventPath,
        event: OFCEvent
    ): Promise<PersistedEventWrite> {
        const { path } = location;
        const file = this.app.getFileByPath(path);
        if (!file) {
            throw new Error(
                `File ${path} either doesn't exist or is a folder.`
            );
        }
        const newLocation = this.getNewLocation(location, event);

        const friendly = this.isFriendlyEventFile(path);
        const modifications = friendly
            ? friendlyModifications(event)
            : legacyModifications(event);

        if (file.path !== newLocation.file.path) {
            await this.app.rename(file, newLocation.file.path);
            this.fileRenamed(path, newLocation.file.path);
        }
        const persistedEvent = await this.app.rewrite<OFCEvent>(
            file,
            (page) => {
                const nextPage = modifyFrontmatterString(page, modifications);
                const rawFrontmatter = extractFrontmatter(nextPage);
                const parsedEvent = parseFullNoteEvent(
                    rawFrontmatter ? parseYaml(rawFrontmatter) : null,
                    this.basenameForPath(newLocation.file.path)
                );
                if (!parsedEvent) {
                    throw new Error(
                        `Updated event note ${newLocation.file.path} is not readable.`
                    );
                }
                return [nextPage, parsedEvent];
            }
        );
        if (!persistedEvent) {
            throw new Error(
                `Updated event note ${newLocation.file.path} is not readable.`
            );
        }
        return { location: newLocation, event: persistedEvent };
    }

    async deleteEvent(location: FullNoteEventPath): Promise<void> {
        const { path } = location;
        if (!isDirectChildMarkdownPath(this.directory, path)) {
            throw new Error(
                `Event path ${path} is outside the configured folder.`
            );
        }
        const file = this.app.getFileByPath(path);
        if (!file) {
            throw new Error(
                `File ${path} either doesn't exist or is a folder.`
            );
        }
        await this.app.trash(file);
        this.friendlyPaths.delete(path);
    }

    private basenameForPath(path: string): string {
        return path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/i, "");
    }
}
