# Recurring events

Add `recurring` to the event note's tags and describe the schedule in frontmatter. This timed example repeats every Monday:

```yaml
---
start: 09:00
end: 10:00
weekday: monday
tags:
  - event
  - recurring
---
```

Optional `start-recurrence` and `end-recurrence` dates bound the schedule. Add `week: 1` through `week: 5` for an nth-weekday monthly rule.

```yaml
start-recurrence: 2026-08-01
end-recurrence: 2026-12-31
week: 2
weekday: tuesday
```

`start-recurrence` supersedes a legacy `date` value when both are present. `end-recurrence` is inclusive: an event can occur on that date. If no start is supplied, weekly recurrence is unbounded and nth-weekday recurrence uses a stable internal anchor.

Right-click a displayed recurring event and choose **Omit this occurrence** to append a `YYYY-MM-DD` value to the note's `omit` list. The plugin deduplicates and sorts omissions.

Simple weekly recurrences can be dragged or resized while retaining local wall-clock time across daylight-saving changes. Nth-weekday recurrences are deliberately non-draggable; edit their frontmatter or omit an occurrence instead. An end time equal to or earlier than the start represents an overnight duration.
