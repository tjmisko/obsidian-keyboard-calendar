# Getting started

## Prepare the event folder

Create an `events` folder in the vault, or choose another existing folder you want to dedicate to event notes. Open Keyboard Calendar from the command palette or ribbon. The native setup prompt asks for one [full-note event folder](calendars/local.md) and prefers `events` when it exists.

Only direct-child Markdown files are indexed; the `.md` extension match is case-insensitive. For example, `events/Planning.md` and `events/Planning.MD` are eligible, while `events/archive/Planning.md` and `events/agenda.pdf` are ignored. Choosing a folder never moves or rewrites existing notes.

Dates in week and day headers link to the corresponding daily note. The link opens an existing note or creates it through Obsidian's daily-note integration. Daily notes are navigation targets, not event stores.

## Opening the calendar

Either click on the ribbon icon, or run the "Keyboard Calendar: Open Calendar" command from the command palette.

Keyboard Calendar opens as a desktop-only normal tab. The retained compatibility bridge redirects workspace leaves saved with the retired sidebar view into a normal calendar tab; the sidebar is not an active feature.

Use Tab and Shift-Tab to cycle Month, Week, Day, and List. Press `T` for Today. Click an event to replace the calendar tab with its ordinary Markdown note; Obsidian Back returns to the calendar.

## Troubleshooting

If the view does not match the notes on disk, run `Keyboard Calendar: Reset Event Cache`, then reopen the calendar. If the problem remains, report it at [tjmisko/obsidian-keyboard-calendar](https://github.com/tjmisko/obsidian-keyboard-calendar/issues).

Before upgrading an older installation, read [Migration and rollback](migration.md) and confirm that plugin data and workspace layout are backed up.
