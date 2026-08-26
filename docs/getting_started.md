# Getting started

## Prepare the event folder

Create an `events` folder in the vault, or choose another existing folder you want to dedicate to event notes. Open Keyboard Calendar from the command palette or ribbon. The native setup prompt asks for one [full-note event folder](calendars/local.md) and prefers `events` when it exists.

Only direct-child Markdown files are indexed; the `.md` extension match is case-insensitive. For example, `events/Planning.md` and `events/Planning.MD` are eligible, while `events/archive/Planning.md` and `events/agenda.pdf` are ignored. Choosing a folder never moves or rewrites existing notes.

Dates in week and day headers link to the corresponding daily note. The link opens an existing note or creates it through Obsidian's daily-note integration. Daily notes are navigation targets, not event stores.

## Opening the calendar

Either click on the ribbon icon, or run the "Keyboard Calendar: Open Calendar" command from the command palette.

Keyboard Calendar opens Month and Week in the main workspace on desktop and mobile. Run "Keyboard Calendar: Open Day Calendar" to reveal the separate Day Calendar in Obsidian's right sidebar or mobile drawer. Selecting a date in Month also opens the day surface at that date. The retained compatibility bridge still redirects workspace leaves saved with the retired full-calendar sidebar type; that legacy type is distinct from the active Day Calendar.

Use Tab and Shift-Tab to switch between Month and Week in the main tab. Press `T` for Today. In Week and the Day Calendar sidebar, use `+` (or `=`) and `-` to expand and contract the shared time-row height. Minute labels thin out automatically at compact zoom levels. Clicking an event in the main calendar replaces that tab with its ordinary Markdown note; clicking one in the Day Calendar opens the note in the main workspace and leaves the sidebar intact.

Week always spans seven days. On a narrow screen its day columns retain a readable minimum width and the grid scrolls horizontally, naturally showing fewer days in portrait and more in landscape. Touch selection and event dragging begin after a 400 ms long press so normal swipes can pan the calendar.

## Troubleshooting

If the view does not match the notes on disk, run `Keyboard Calendar: Reset Event Cache`, then reopen the calendar. If the problem remains, report it at [tjmisko/obsidian-keyboard-calendar](https://github.com/tjmisko/obsidian-keyboard-calendar/issues).

If the calendar is blank or fails to render—especially on mobile—reproduce the problem and then run `Keyboard Calendar: Show Diagnostic Report` from the command palette. Tap **Copy report** and review the text before sharing it. The bounded log survives plugin and app reloads when WebView storage is available. It records plugin/runtime versions, device and viewport information, calendar lifecycle checkpoints, element dimensions and computed layout styles, event counts, and errors. It intentionally does not record note contents, event titles, configured folder paths, or event/source IDs, although an unexpected error message can contain additional context.

Use **Clear saved log** in the report dialog before reproducing a problem when you want a short, clean trace.

Before upgrading an older installation, read [Migration and rollback](migration.md) and confirm that plugin data and workspace layout are backed up.
