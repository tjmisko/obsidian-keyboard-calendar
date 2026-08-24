# Event basics

Each calendar event is a Markdown note directly inside the configured local event folder. The `.md` extension match is case-insensitive; nested notes and non-Markdown files are excluded.

A note opts into the strict note-first format with the `event` tag:

```yaml
---
date: 2026-08-22
start: 09:00
end: 10:00
tags:
  - event
  - planning
---
```

The filename is the event title unless a `title` string is present. `date` must be `YYYY-MM-DD`; `start` and `end` must be 24-hour `HH:mm` values. An end time equal to or earlier than the start represents an overnight event. Tags other than `event` and `recurring` become event categories.

If an event has a tag configured for ghost rendering but you plan to attend it, add an `attending` date matching the event date. That occurrence renders normally instead of as a ghost:

```yaml
attending: 2026-08-22
```

The value must be a `YYYY-MM-DD` date. It does not change the event schedule.

The rest of the note is yours for descriptions, links, or meeting notes. Extra frontmatter and note content are preserved when the plugin changes timing or recurrence omissions. Older event notes without the `event` tag remain parser-compatible, but new notes should use the format above.

## Create a timed event

Run **Keyboard Calendar: New Event**, or select a time range in a week or day view. Keyboard Calendar writes the note successfully before indexing it, then opens it as a normal Markdown buffer. Rename the note and edit its frontmatter normally.

Selecting a date in a month view opens that date in the day view so you can choose an exact time. Keyboard Calendar supports timed events only.

## Open an event

Click an event to open its backing Markdown note. There is no separate calendar event editor.

## Removal and completion

To remove an event, move or delete its note with Obsidian's ordinary file controls. The calendar has no delete-note action and no task checkbox UI. A legacy `completed` property remains parse-compatible and is preserved by supported edits, but it is not rendered as a task control.
