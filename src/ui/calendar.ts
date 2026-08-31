/**
 * Handles rendering the calendar given a container element, eventSources, and interaction callbacks.
 */
import {
    Calendar,
    CalendarOptions,
    EventApi,
    EventClickArg,
    EventHoveringArg,
    EventInput,
} from "@fullcalendar/core";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import rrulePlugin from "@fullcalendar/rrule";
import interactionPlugin from "@fullcalendar/interaction";
import { eventHasGhostTag } from "../settings/tag_settings";

// There is an issue with FullCalendar RRule support around DST boundaries which is fixed by this monkeypatch:
// https://github.com/fullcalendar/fullcalendar/issues/5273#issuecomment-1360459342
export const toLocalWallClockRecurrenceMarker = (
    occurrence: Date,
    localStart: Date
): Date =>
    new Date(
        Date.UTC(
            occurrence.getUTCFullYear(),
            occurrence.getUTCMonth(),
            occurrence.getUTCDate(),
            localStart.getHours(),
            localStart.getMinutes(),
            localStart.getSeconds(),
            localStart.getMilliseconds()
        )
    );

rrulePlugin.recurringTypes[0].expand = function (errd, fr, de) {
    const localStart = errd.rruleSet._dtstart;
    return errd.rruleSet
        .between(de.toDate(fr.start), de.toDate(fr.end), true)
        .map((d: Date) => toLocalWallClockRecurrenceMarker(d, localStart));
};

export type CalendarVariant = "primary" | "day-sidebar";

interface ExtraRenderProps {
    eventClick?: (info: EventClickArg) => void;
    select?: (
        startDate: Date,
        endDate: Date,
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
    diagnostic?: (event: string, details: unknown) => void;
    variant?: CalendarVariant;
    isMobile?: boolean;
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

const formatDatePartsLabel = (
    year: number,
    monthIndex: number,
    day: number
): string => `${year}-${padTimePart(monthIndex + 1)}-${padTimePart(day)}`;

export const formatTimeLabel = (date: Date): string =>
    `${padTimePart(date.getHours())}:${padTimePart(date.getMinutes())}`;

export const formatTimeGridSlotLabel = (date: Date): string =>
    date.getMinutes() === 0
        ? formatTimeLabel(date)
        : `:${padTimePart(date.getMinutes())}`;

export const formatDateLabel = (date: Date): string =>
    formatDatePartsLabel(date.getFullYear(), date.getMonth(), date.getDate());

/** Give a touch gesture time to become a scroll before selection or dragging. */
export const TOUCH_LONG_PRESS_DELAY_MS = 400;

const roundLayoutNumber = (value: unknown): number | null =>
    typeof value === "number" && Number.isFinite(value)
        ? Math.round(value * 100) / 100
        : null;

const toIsoString = (value: unknown): string | null =>
    value instanceof Date && !Number.isNaN(value.getTime())
        ? value.toISOString()
        : null;

const summarizeElement = (
    element: HTMLElement | null
): Record<string, unknown> => {
    if (!element) {
        return { present: false };
    }

    let rect: DOMRect | null = null;
    try {
        rect = element.getBoundingClientRect?.() || null;
    } catch (_error) {}

    let style: CSSStyleDeclaration | null = null;
    try {
        style =
            element.ownerDocument?.defaultView?.getComputedStyle(element) ||
            null;
    } catch (_error) {}

    let classes: string[] = [];
    try {
        classes = Array.from(element.classList || []).slice(0, 20);
    } catch (_error) {}

    return {
        present: true,
        tag: element.tagName?.toLowerCase() || null,
        classes,
        rect: rect
            ? {
                  x: roundLayoutNumber(rect.x),
                  y: roundLayoutNumber(rect.y),
                  width: roundLayoutNumber(rect.width),
                  height: roundLayoutNumber(rect.height),
              }
            : null,
        client: {
            width: roundLayoutNumber(element.clientWidth),
            height: roundLayoutNumber(element.clientHeight),
        },
        scroll: {
            width: roundLayoutNumber(element.scrollWidth),
            height: roundLayoutNumber(element.scrollHeight),
        },
        style: style
            ? {
                  display: style.display,
                  visibility: style.visibility,
                  position: style.position,
                  width: style.width,
                  height: style.height,
                  minWidth: style.minWidth,
                  minHeight: style.minHeight,
                  overflow: style.overflow,
                  overflowX: style.overflowX,
                  overflowY: style.overflowY,
                  flex: style.flex,
                  flexGrow: style.flexGrow,
              }
            : null,
    };
};

const CALENDAR_DIAGNOSTIC_SELECTORS = {
    calendar: ".fc",
    headerToolbar: ".fc-header-toolbar",
    footerToolbar: ".fc-footer-toolbar",
    viewHarness: ".fc-view-harness",
    activeViewHarness: ".fc-view-harness-active",
    timeGridView: ".fc-timegrid",
    scrollGrid: ".fc-scrollgrid",
    timeGridBody: ".fc-timegrid-body",
    timeGridSlots: ".fc-timegrid-slots",
    timeGridColumns: ".fc-timegrid-cols",
    scrollerHarness: ".fc-scroller-harness",
    scroller: ".fc-scroller",
} as const;

/** Capture layout facts without event titles, note paths, or DOM text. */
export const collectCalendarRenderDiagnostics = (
    containerEl: HTMLElement,
    calendar?: Calendar | null
): Record<string, unknown> => {
    const query = (selector: string): HTMLElement | null => {
        try {
            return typeof containerEl.querySelector === "function"
                ? containerEl.querySelector<HTMLElement>(selector)
                : null;
        } catch (_error) {
            return null;
        }
    };
    const count = (selector: string): number | null => {
        try {
            return typeof containerEl.querySelectorAll === "function"
                ? containerEl.querySelectorAll(selector).length
                : null;
        } catch (_error) {
            return null;
        }
    };

    const elements: Record<string, unknown> = {};
    for (const [name, selector] of Object.entries(
        CALENDAR_DIAGNOSTIC_SELECTORS
    )) {
        elements[name] = {
            count: count(selector),
            first: summarizeElement(query(selector)),
        };
    }

    const ancestors: Record<string, unknown>[] = [];
    let ancestor = containerEl.parentElement;
    for (let depth = 0; ancestor && depth < 4; depth += 1) {
        ancestors.push(summarizeElement(ancestor));
        ancestor = ancestor.parentElement;
    }

    const calendarApi = calendar as
        | (Calendar & {
              getEvents?: () => unknown[];
              getEventSources?: () => unknown[];
          })
        | null
        | undefined;
    let calendarState: Record<string, unknown> | null = null;
    if (calendarApi) {
        try {
            const view = calendarApi.view;
            calendarState = {
                viewType: view?.type || null,
                activeStart: toIsoString(view?.activeStart),
                activeEnd: toIsoString(view?.activeEnd),
                currentDate:
                    typeof calendarApi.getDate === "function"
                        ? toIsoString(calendarApi.getDate())
                        : null,
                eventCount:
                    typeof calendarApi.getEvents === "function"
                        ? calendarApi.getEvents().length
                        : null,
                eventSourceCount:
                    typeof calendarApi.getEventSources === "function"
                        ? calendarApi.getEventSources().length
                        : null,
            };
        } catch (error) {
            calendarState = { readError: error };
        }
    }

    const calendarWindow = containerEl.ownerDocument?.defaultView;
    const visualViewport = calendarWindow?.visualViewport;
    return {
        connected: containerEl.isConnected ?? null,
        documentVisibility: containerEl.ownerDocument?.visibilityState || null,
        viewport: calendarWindow
            ? {
                  innerWidth: roundLayoutNumber(calendarWindow.innerWidth),
                  innerHeight: roundLayoutNumber(calendarWindow.innerHeight),
                  devicePixelRatio: roundLayoutNumber(
                      calendarWindow.devicePixelRatio
                  ),
                  orientationType:
                      calendarWindow.screen?.orientation?.type || null,
                  orientationAngle:
                      calendarWindow.screen?.orientation?.angle ?? null,
                  visualViewport: visualViewport
                      ? {
                            width: roundLayoutNumber(visualViewport.width),
                            height: roundLayoutNumber(visualViewport.height),
                            scale: roundLayoutNumber(visualViewport.scale),
                            offsetTop: roundLayoutNumber(
                                visualViewport.offsetTop
                            ),
                            offsetLeft: roundLayoutNumber(
                                visualViewport.offsetLeft
                            ),
                        }
                      : null,
              }
            : null,
        calendarState,
        container: summarizeElement(containerEl),
        ancestors,
        elements,
    };
};

const emitCalendarDiagnostic = (
    diagnostic: ExtraRenderProps["diagnostic"],
    event: string,
    details: unknown
): void => {
    try {
        diagnostic?.(event, details);
    } catch (_error) {
        // Diagnostics must not be capable of interrupting FullCalendar.
    }
};

const scheduleCalendarLayoutDiagnostics = (
    containerEl: HTMLElement,
    calendar: Calendar,
    diagnostic: ExtraRenderProps["diagnostic"]
): void => {
    if (!diagnostic) {
        return;
    }
    const calendarWindow = containerEl.ownerDocument?.defaultView;
    if (!calendarWindow) {
        return;
    }

    try {
        calendarWindow.requestAnimationFrame(() => {
            emitCalendarDiagnostic(
                diagnostic,
                "layout.animation-frame-1",
                collectCalendarRenderDiagnostics(containerEl, calendar)
            );
            calendarWindow.requestAnimationFrame(() => {
                emitCalendarDiagnostic(
                    diagnostic,
                    "layout.animation-frame-2",
                    collectCalendarRenderDiagnostics(containerEl, calendar)
                );
            });
        });
        calendarWindow.setTimeout(() => {
            emitCalendarDiagnostic(
                diagnostic,
                "layout.after-250ms",
                collectCalendarRenderDiagnostics(containerEl, calendar)
            );
        }, 250);
        calendarWindow.setTimeout(() => {
            emitCalendarDiagnostic(
                diagnostic,
                "layout.after-1000ms",
                collectCalendarRenderDiagnostics(containerEl, calendar)
            );
        }, 1_000);
    } catch (error) {
        emitCalendarDiagnostic(diagnostic, "layout.schedule-error", {
            error,
        });
    }
};

export const scrollCalendarDateIntoView = (
    containerEl: HTMLElement,
    date: Date
): boolean => {
    const header = containerEl.querySelector<HTMLElement>(
        `.fc-col-header-cell[data-date="${formatDateLabel(date)}"]`
    );
    if (!header || typeof header.scrollIntoView !== "function") {
        return false;
    }
    header.scrollIntoView({
        behavior: "auto",
        block: "nearest",
        inline: "center",
    });
    return true;
};

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

export const CALENDAR_VIEW_SEQUENCE = ["dayGridMonth", "timeGridWeek"] as const;

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
    const diagnostic = settings?.diagnostic;
    const isDaySidebar = settings?.variant === "day-sidebar";
    const isMobile = settings?.isMobile === true;
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

    emitCalendarDiagnostic(diagnostic, "construct.start", {
        variant: settings?.variant || "primary",
        isMobile,
        requestedInitialView: settings?.initialView || null,
        effectiveInitialView: isDaySidebar
            ? "timeGridDay"
            : settings?.initialView || "timeGridWeek",
        sourceCount: eventSources.length,
        inputEventCount: eventSources.reduce(
            (total, source) => total + source.events.length,
            0
        ),
        layout: collectCalendarRenderDiagnostics(containerEl),
    });

    const calendarOptions: CalendarOptions = {
        plugins: [
            ...(isDaySidebar ? [] : [dayGridPlugin]),
            timeGridPlugin,
            interactionPlugin,
            rrulePlugin,
        ],
        initialView: isDaySidebar
            ? "timeGridDay"
            : settings?.initialView || "timeGridWeek",
        initialDate: settings?.initialDate,
        nowIndicator: true,
        scrollTimeReset: false,
        dayMaxEvents: true,
        weekNumberCalculation: "ISO",
        slotDuration: "00:15:00",
        snapDuration: "00:15:00",
        slotLabelInterval: "00:15:00",

        headerToolbar: isDaySidebar
            ? {
                  left: "prev,next",
                  center: "title",
                  right: "today",
              }
            : isMobile
            ? false
            : {
                  left: "prev,next today",
                  center: "title",
                  right: "dayGridMonth,timeGridWeek",
              },
        footerToolbar:
            !isDaySidebar && isMobile
                ? {
                      left: "prev,next today",
                      center: "title",
                      right: "dayGridMonth,timeGridWeek",
                  }
                : false,

        views: {
            ...(!isDaySidebar &&
                isMobile && {
                    dayGridMonth: {
                        titleFormat: { year: "numeric", month: "short" },
                    },
                }),
            timeGrid: {
                allDaySlot: false,
                displayEventTime: false,
                titleFormat: { week: "long" },
            },
            ...(isDaySidebar && {
                timeGridDay: {
                    type: "timeGrid",
                    duration: { days: 1 },
                    titleFormat: ({ start }) =>
                        formatDatePartsLabel(
                            start.year,
                            start.month,
                            start.day
                        ),
                },
            }),
        },
        firstDay: settings?.firstDay,
        datesSet: diagnostic
            ? (info) => {
                  emitCalendarDiagnostic(diagnostic, "dates.set", {
                      viewType: info.view.type,
                      start: info.start,
                      end: info.end,
                  });
                  settings?.datesSet?.();
              }
            : settings?.datesSet,
        eventsSet: diagnostic
            ? (events) => {
                  emitCalendarDiagnostic(diagnostic, "events.set", {
                      eventCount: events.length,
                  });
                  settings?.eventsSet?.();
              }
            : settings?.eventsSet,
        slotLabelContent: ({ date }) => formatTimeGridSlotLabel(date),
        slotLabelClassNames: ({ date }) => {
            const minutes = date.getMinutes();
            if (minutes === 0) {
                return ["ofc-time-label-major"];
            }
            return minutes === 30
                ? ["ofc-time-label-minor", "ofc-time-label-half"]
                : ["ofc-time-label-minor", "ofc-time-label-quarter"];
        },
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
                text: date.toLocaleDateString(undefined, {
                    weekday: "long",
                }),
            });
            if (!isDaySidebar) {
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
            }

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
        eventContent: ({ event, isStart }) => {
            if (event.display.includes("background")) {
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
                await select(info.start, info.end, info.view.type);
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
            if (event.extendedProps.ofcRecurring === true) {
                el.addClass("ofc-event-recurring");
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

        longPressDelay: TOUCH_LONG_PRESS_DELAY_MS,
        selectLongPressDelay: TOUCH_LONG_PRESS_DELAY_MS,
        eventLongPressDelay: TOUCH_LONG_PRESS_DELAY_MS,
    };

    let cal: Calendar;
    try {
        cal = new Calendar(containerEl, calendarOptions);
    } catch (error) {
        emitCalendarDiagnostic(diagnostic, "construct.error", { error });
        throw error;
    }

    emitCalendarDiagnostic(diagnostic, "construct.complete", {
        layout: collectCalendarRenderDiagnostics(containerEl, cal),
    });
    try {
        cal.render();
    } catch (error) {
        emitCalendarDiagnostic(diagnostic, "render.error", {
            error,
            layout: collectCalendarRenderDiagnostics(containerEl, cal),
        });
        throw error;
    }
    emitCalendarDiagnostic(
        diagnostic,
        "render.complete",
        collectCalendarRenderDiagnostics(containerEl, cal)
    );
    scheduleCalendarLayoutDiagnostics(containerEl, cal, diagnostic);
    return cal;
}
