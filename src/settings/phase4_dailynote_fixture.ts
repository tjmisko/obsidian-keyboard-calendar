import { OFCEvent } from "../types";

/**
 * Sanitized pre-cut fixture used to prove the exact Phase 4 event-count delta.
 * These bytes model an existing daily note; Phase 4 must never rewrite them.
 */
export const PHASE4_DAILY_NOTE_FIXTURE = {
    path: "Daily/2026-08-22.md",
    heading: "Calendar",
    contents: [
        "# 2026-08-22",
        "## Calendar",
        "- [ ] Planning [startTime:: 09:00] [endTime:: 10:00] [allDay:: false]",
        "- Holiday [allDay:: true]",
        "- Plain bullet",
        "## Other",
        "- Hidden [allDay:: true]",
        "",
    ].join("\n"),
} as const;

/**
 * Canonical event set produced by the removed adapter for the configured
 * heading. The plain bullet and the event under another heading were never in
 * this source.
 */
export const PHASE4_DAILY_NOTE_EVENTS: readonly OFCEvent[] = [
    {
        title: "Holiday",
        allDay: true,
        type: "single",
        date: "2026-08-22",
        endDate: null,
        completed: null,
    },
    {
        title: "Planning",
        allDay: false,
        startTime: "09:00",
        endTime: "10:00",
        type: "single",
        date: "2026-08-22",
        endDate: null,
        completed: false,
    },
];

export const PHASE4_FULL_NOTE_EVENTS: readonly OFCEvent[] = [
    {
        title: "Retained full-note planning",
        allDay: false,
        startTime: "13:00",
        endTime: "14:00",
        type: "single",
        date: "2026-08-22",
        endDate: null,
        completed: null,
    },
];
