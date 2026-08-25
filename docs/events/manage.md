# Manage events on the calendar

Click an event to open its backing note in a normal Markdown buffer. Edit its title, recurrence fields, categories, and other content in the note.

## Moving events

Drag a single event or a simple weekly recurring event to change its date or time. For note-first files tagged `event`, Keyboard Calendar changes the timing fields in place and preserves unrelated frontmatter and note content. Parser-compatible legacy notes without that tag also preserve YAML/body content, but may be renamed to their historical date/title-derived filename during an edit.

Nth-weekday recurrence rules remain note-editable, but are not draggable because a single displayed occurrence does not define how the rule itself should change.

## Drag to change duration

Drag the endpoint of a single or simple weekly event to change its duration.

If a disk write fails, the requested change is not published as successful. Reopen or reset the calendar after resolving a filesystem error.

## Rename or remove the note

Use Obsidian's ordinary file controls to rename or remove a note. A rename changes the event's path-derived internal ID while preserving the note as the same visible event. To remove an event from the calendar, focus it in normal mode and press `x` or `Delete`; after confirmation, the backing note is moved to trash. Deleting a recurring event removes its entire series.
