/**
 * Handles rendering the calendar given a container element, eventSources, and interaction callbacks.
 */
import {
    Calendar,
    EventApi,
    EventClickArg,
    EventHoveringArg,
    EventInput,
} from "@fullcalendar/core";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import rrulePlugin from "@fullcalendar/rrule";
import listPlugin from "@fullcalendar/list";
import interactionPlugin from "@fullcalendar/interaction";
import { eventHasGhostTag } from "../settings/tag_settings";

// There is an issue with FullCalendar RRule support around DST boundaries which is fixed by this monkeypatch:
// https://github.com/fullcalendar/fullcalendar/issues/5273#issuecomment-1360459342
rrulePlugin.recurringTypes[0].expand = function (errd, fr, de) {
    const hours = errd.rruleSet._dtstart.getHours();
    return errd.rruleSet
        .between(de.toDate(fr.start), de.toDate(fr.end), true)
        .map((d: Date) => {
            return new Date(
                Date.UTC(
                    d.getFullYear(),
                    d.getMonth(),
                    d.getDate(),
                    hours,
                    d.getMinutes()
                )
            );
        });
};

interface ExtraRenderProps {
    eventClick?: (info: EventClickArg) => void;
    select?: (
        startDate: Date,
        endDate: Date,
        allDay: boolean,
        viewType: string
    ) => Promise<void>;
    modifyEvent?: (event: EventApi, oldEvent: EventApi) => Promise<boolean>;
    eventMouseEnter?: (info: EventHoveringArg) => void;
    firstDay?: number;
    initialView?: string;
    initialDate?: Date;
    timeFormat24h?: boolean;
    ghostEventTags?: () => readonly string[];
    openContextMenuForEvent?: (
        event: EventApi,
        mouseEvent: MouseEvent
    ) => Promise<void>;
    dailyNotePath?: (date: Date) => string;
    openDailyNote?: (date: Date) => Promise<void>;
    datesSet?: () => void;
    eventsSet?: () => void;
}

/** A local, already-materialized source. URL and callback sources are excluded. */
export interface LocalMaterializedEventSource {
    id: string;
    events: EventInput[];
    editable?: boolean;
    color?: string;
    textColor?: string;
}

const padTimePart = (value: number): string =>
    value.toString().padStart(2, "0");

export const formatTimeLabel = (date: Date): string =>
    `${padTimePart(date.getHours())}:${padTimePart(date.getMinutes())}`;

export const formatTimeGridSlotLabel = (date: Date): string =>
    date.getMinutes() === 0
        ? formatTimeLabel(date)
        : `:${padTimePart(date.getMinutes())}`;

export const formatDateLabel = (date: Date): string =>
    `${date.getFullYear()}-${padTimePart(date.getMonth() + 1)}-${padTimePart(
        date.getDate()
    )}`;

const COMPACT_MONTH_LABELS = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
];

export const formatCompactDateLabel = (date: Date): string =>
    `${COMPACT_MONTH_LABELS[date.getMonth()]} ${date.getDate()}`;

const formatLongDateParts = (
    year: number,
    month: number,
    day: number
): string => {
    const date = new Date(Date.UTC(year, month, day));
    const weekday = date.toLocaleDateString(undefined, {
        timeZone: "UTC",
        weekday: "long",
    });
    const monthName = date.toLocaleDateString(undefined, {
        month: "long",
        timeZone: "UTC",
    });
    return `${weekday}, ${day} ${monthName} ${year}`;
};

export const formatLongDateTitle = (date: Date): string =>
    formatLongDateParts(date.getFullYear(), date.getMonth(), date.getDate());

export const getRenderedEventTitle = (
    title: string,
    eventDate: Date | string | null
): string => {
    if (!eventDate) {
        return title;
    }
    const match = title.match(/^(\d{4}-\d{2}-\d{2})\s+-\s+(.+)$/);
    const eventDateLabel =
        typeof eventDate === "string" ? eventDate : formatDateLabel(eventDate);
    return match?.[1] === eventDateLabel ? match[2] : title;
};

export const CALENDAR_VIEW_SEQUENCE = [
    "dayGridMonth",
    "timeGridWeek",
    "timeGridDay",
    "listWeek",
] as const;

export const getAdjacentCalendarView = (
    currentView: string,
    reverse = false
): (typeof CALENDAR_VIEW_SEQUENCE)[number] => {
    const currentIndex = CALENDAR_VIEW_SEQUENCE.indexOf(
        currentView as (typeof CALENDAR_VIEW_SEQUENCE)[number]
    );
    if (currentIndex === -1) {
        return reverse
            ? CALENDAR_VIEW_SEQUENCE[CALENDAR_VIEW_SEQUENCE.length - 1]
            : CALENDAR_VIEW_SEQUENCE[0];
    }
    const offset = reverse ? -1 : 1;
    return CALENDAR_VIEW_SEQUENCE[
        (currentIndex + offset + CALENDAR_VIEW_SEQUENCE.length) %
            CALENDAR_VIEW_SEQUENCE.length
    ];
};

const isTimeGridView = (viewType: string): boolean =>
    viewType.startsWith("timeGrid");

export function renderCalendar(
    containerEl: HTMLElement,
    eventSources: LocalMaterializedEventSource[],
    settings?: ExtraRenderProps
): Calendar {
    const {
        eventClick,
        select,
        modifyEvent,
        eventMouseEnter,
        openContextMenuForEvent,
        dailyNotePath,
        openDailyNote,
        ghostEventTags,
    } = settings || {};
    const modifyEventCallback =
        modifyEvent &&
        (async ({
            event,
            oldEvent,
            revert,
        }: {
            event: EventApi;
            oldEvent: EventApi;
            revert: () => void;
        }) => {
            const success = await modifyEvent(event, oldEvent);
            if (!success) {
                revert();
            }
        });

    const cal = new Calendar(containerEl, {
        plugins: [
            // View plugins
            dayGridPlugin,
            timeGridPlugin,
            listPlugin,
            // Drag + drop and editing
            interactionPlugin,
            rrulePlugin,
        ],
        initialView: settings?.initialView || "timeGridWeek",
        initialDate: settings?.initialDate,
        nowIndicator: true,
        scrollTimeReset: false,
        dayMaxEvents: true,
        weekNumberCalculation: "ISO",
        slotDuration: "00:15:00",
        snapDuration: "00:15:00",
        slotLabelInterval: "00:15:00",

        headerToolbar: {
            left: "prev,next today",
            center: "title",
            right: "dayGridMonth,timeGridWeek,timeGridDay,listWeek",
        },
        footerToolbar: false,

        views: {
            timeGrid: {
                allDaySlot: false,
                displayEventTime: false,
                titleFormat: { week: "long" },
            },
            timeGridDay: {
                type: "timeGrid",
                duration: { days: 1 },
                buttonText: "day",
                titleFormat: ({ start }) =>
                    formatLongDateParts(start.year, start.month, start.day),
            },
        },
        firstDay: settings?.firstDay,
        datesSet: settings?.datesSet,
        eventsSet: settings?.eventsSet,
        slotLabelContent: ({ date }) => formatTimeGridSlotLabel(date),
        slotLabelClassNames: ({ date }) =>
            date.getMinutes() === 0
                ? ["ofc-time-label-major"]
                : ["ofc-time-label-minor"],
        slotLaneClassNames: ({ date }) =>
            date?.getMinutes() === 0
                ? ["ofc-time-slot-major"]
                : ["ofc-time-slot-minor"],
        dayHeaderContent: ({ date, text, view }) => {
            if (!isTimeGridView(view.type)) {
                return text;
            }

            const header = document.createElement("span");
            header.addClass("ofc-day-header");

            const weekday = header.createSpan({
                cls: "ofc-day-header-weekday",
                text: date.toLocaleDateString(undefined, { weekday: "long" }),
            });
            weekday.setAttribute("aria-hidden", "true");

            header.createSpan({
                cls: "ofc-day-header-date ofc-day-header-date-full",
                text: formatDateLabel(date),
            });
            const compactDate = header.createSpan({
                cls: "ofc-day-header-date ofc-day-header-date-compact",
                text: formatCompactDateLabel(date),
            });
            compactDate.setAttribute("aria-hidden", "true");

            return { domNodes: [header] };
        },
        dayHeaderDidMount: ({ date, el, view }) => {
            if (
                !isTimeGridView(view.type) ||
                (!dailyNotePath && !openDailyNote)
            ) {
                return;
            }

            const link = el.querySelector<HTMLAnchorElement>(
                ".fc-col-header-cell-cushion"
            );
            if (!link) {
                return;
            }

            const dateLabel = formatDateLabel(date);
            const notePath = dailyNotePath?.(date);
            link.addClass("ofc-daily-note-link", "internal-link");
            link.setAttribute(
                "aria-label",
                `Open daily note for ${date.toLocaleDateString(undefined, {
                    weekday: "long",
                })}, ${dateLabel}`
            );
            if (notePath) {
                link.setAttribute("data-href", notePath);
                link.setAttribute("href", notePath);
            }
            if (openDailyNote) {
                link.addEventListener("click", (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    void openDailyNote(date);
                });
            }
        },
        ...(settings?.timeFormat24h && {
            eventTimeFormat: {
                hour: "numeric",
                minute: "2-digit",
                hour12: false,
            },
        }),
        eventSources,
        eventClick,
        // Build the shortened title inside FullCalendar's render lifecycle.
        // Mutating its title node after mount causes text to duplicate on rerender.
        eventContent: ({ event, isStart, view }) => {
            if (
                view.type.startsWith("list") ||
                event.display.includes("background")
            ) {
                return undefined;
            }

            const content = document.createElement("div");
            content.addClass("ofc-event-card-content");
            content.createDiv({
                cls: "fc-event-title fc-sticky",
                text: getRenderedEventTitle(
                    event.title,
                    isStart ? event.start : null
                ),
            });
            return { domNodes: [content] };
        },

        selectable: select && true,
        selectMirror: select && true,
        select:
            select &&
            (async (info) => {
                await select(info.start, info.end, info.allDay, info.view.type);
                info.view.calendar.unselect();
            }),

        editable: modifyEvent && true,
        eventDrop: modifyEventCallback,
        eventResize: modifyEventCallback,

        eventMouseEnter,

        eventDidMount: ({ event, el, backgroundColor, textColor }) => {
            if (backgroundColor) {
                el.style.setProperty("--ofc-event-color", backgroundColor);
            }
            if (textColor !== "black") {
                el.addClass("ofc-event-muted-light-text");
            }
            if (
                eventHasGhostTag(
                    event.extendedProps.categories,
                    ghostEventTags?.() || []
                ) &&
                !(
                    event.start &&
                    Array.isArray(event.extendedProps.attendingDates) &&
                    event.extendedProps.attendingDates.includes(
                        formatDateLabel(event.start)
                    )
                )
            ) {
                el.addClass("ofc-event-ghost");
            }
            if (event.start && !event.display.includes("background")) {
                el.dataset.ofcEventId = event.id;
                el.dataset.ofcEventStart = event.start.toISOString();
                el.dataset.ofcEventEnd = (
                    event.end || event.start
                ).toISOString();
                el.tabIndex = -1;
            }
            el.addEventListener("contextmenu", (e) => {
                e.preventDefault();
                openContextMenuForEvent && openContextMenuForEvent(event, e);
            });
        },

        longPressDelay: 250,
    });
    cal.render();
    return cal;
}
