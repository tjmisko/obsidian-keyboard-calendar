# Recurring events

Add `recurring` to the event note's tags and describe the schedule in frontmatter. This example repeats every Monday:

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

Right-click a displayed recurring event and choose **Omit this occurrence** to append that date to the note's `omit` list. Simple weekly recurrences can also be dragged or resized. Nth-weekday recurrences are not draggable; edit their frontmatter instead.
