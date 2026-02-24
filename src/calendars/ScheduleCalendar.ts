import { TFile, TFolder } from "obsidian";
import { ObsidianInterface } from "../ObsidianAdapter";
import { OFCEvent } from "../types";
import { Calendar, EventResponse } from "./Calendar";
import { parseRetendFile, RetendEvent } from "./parsing/retend";

function scheduleEventToOFCEvent(event: RetendEvent): OFCEvent {
    return {
        title: event.title,
        type: "single",
        allDay: false,
        startTime: event.startTime,
        endTime: event.endTime,
        date: event.date,
        endDate: null,
        category: event.category,
        id: `schedule::${event.date}::${event.startTime}`,
    };
}

export default class ScheduleCalendar extends Calendar {
    app: ObsidianInterface;
    private _directory: string;

    constructor(app: ObsidianInterface, color: string, directory: string) {
        super(color);
        this.app = app;
        this._directory = directory;
    }

    get directory(): string {
        return this._directory;
    }

    get type(): "schedule" {
        return "schedule";
    }

    get identifier(): string {
        return this.directory;
    }

    get name(): string {
        return `Schedule (${this.directory})`;
    }

    containsPath(path: string): boolean {
        return path.startsWith(this._directory) && path.endsWith(".schedule");
    }

    async getEventsInFile(file: TFile): Promise<EventResponse[]> {
        if (!file.path.endsWith(".schedule")) {
            return [];
        }
        const contents = await this.app.read(file);
        const events = parseRetendFile(contents);
        return events.map((event) => [
            scheduleEventToOFCEvent(event),
            { file, lineNumber: event.startLine },
        ]);
    }

    async getEvents(): Promise<EventResponse[]> {
        const folder = this.app.getAbstractFileByPath(this.directory);
        if (!folder || !(folder instanceof TFolder)) {
            return [];
        }

        const results: EventResponse[] = [];
        for (const child of folder.children) {
            if (child instanceof TFile && child.path.endsWith(".schedule")) {
                const events = await this.getEventsInFile(child);
                results.push(...events);
            }
        }
        return results;
    }
}
