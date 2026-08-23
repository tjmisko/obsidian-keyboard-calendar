# Event basics

Each calendar event is a Markdown note in a configured local calendar folder. The note opts into the calendar with frontmatter like this:

```yaml
---
date: 2026-08-22
start: 09:00
end: 10:00
tags:
  - event
---
```

The filename is the event title by default, and the rest of the note is yours for descriptions, links, or meeting notes. Extra frontmatter and note content are preserved when the plugin changes an event's timing.

## Create a timed event

Run **Full Calendar: Create new event**, or select a time range in a week or day view. Full Calendar creates an `Untitled event` note and opens it as a normal Markdown buffer. Rename the note and edit its frontmatter normally.

Selecting a date in a month view, or an all-day slot, opens that date in the day view so you can choose an exact time.

## Open an event

Click an event to open its backing Markdown note. There is no separate calendar event editor.
