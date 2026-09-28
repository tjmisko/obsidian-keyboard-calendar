import { App, Modal } from "obsidian";
import type { Calendar } from "@fullcalendar/core";
import { LocalMaterializedEventSource, renderCalendar } from "./calendar";
import { refreshTimeGridLayout, TimeGridZoom } from "./calendar_zoom";
import { getDayPeekScrollTime } from "./day_peek";

export interface DayPeekModalOptions {
    date: Date;
    zoomLevel: number;
    firstDay?: number;
    timeFormat24h?: boolean;
    ghostEventTags: () => readonly string[];
    getEventSources: () => LocalMaterializedEventSource[];
    /** Subscribe to event changes; returns an unsubscribe function. */
    subscribe: (onChange: () => void) => () => void;
    openEvent: (eventId: string) => void;
    proposeEvent: (start: Date, end: Date) => void;
}

/**
 * A phone's answer to the desktop day sidebar: long-pressing a month day (or
 * tapping "+N more") peeks at that day's time grid in a sheet, without leaving
 * the month.
 */
export class DayPeekModal extends Modal {
    private calendar: Calendar | null = null;
    private unsubscribe: (() => void) | null = null;

    constructor(app: App, private readonly options: DayPeekModalOptions) {
        super(app);
    }

    onOpen(): void {
        const { options } = this;
        this.modalEl.addClass("ofc-day-peek-modal");
        this.contentEl.empty();
        const root = this.contentEl.createDiv({
            cls: "ofc-calendar-root ofc-day-calendar-root ofc-day-peek-root",
        });
        const zoom = new TimeGridZoom(options.zoomLevel);
        zoom.applyTo(root);

        const calendar = renderCalendar(root, options.getEventSources(), {
            variant: "day-sidebar",
            isMobile: true,
            initialDate: options.date,
            firstDay: options.firstDay,
            timeFormat24h: options.timeFormat24h,
            ghostEventTags: options.ghostEventTags,
            eventClick: (info) => {
                info.jsEvent.preventDefault();
                this.close();
                options.openEvent(info.event.id);
            },
            select: async (start, end) => {
                options.proposeEvent(start, end);
            },
        });
        this.calendar = calendar;
        refreshTimeGridLayout(calendar, zoom.level);
        calendar.scrollToTime(
            getDayPeekScrollTime(
                calendar.getEvents().map((event) => ({
                    start: event.start,
                    end: event.end,
                    allDay: event.allDay,
                })),
                options.date
            )
        );

        // Keep the peek live while an event is created from it.
        this.unsubscribe = options.subscribe(() => {
            if (this.calendar !== calendar) {
                return;
            }
            calendar.removeAllEventSources();
            for (const source of options.getEventSources()) {
                calendar.addEventSource(source);
            }
        });
    }

    onClose(): void {
        this.unsubscribe?.();
        this.unsubscribe = null;
        this.calendar?.destroy();
        this.calendar = null;
        this.contentEl.empty();
    }
}
