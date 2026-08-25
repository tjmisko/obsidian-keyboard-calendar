# Getting started

## Prepare the event folder

Create an `events` folder in the vault, or choose another existing folder you want to dedicate to event notes. Open Keyboard Calendar from the command palette or ribbon. The native setup prompt asks for one [full-note event folder](calendars/local.md) and prefers `events` when it exists.

Only direct-child Markdown files are indexed; the `.md` extension match is case-insensitive. For example, `events/Planning.md` and `events/Planning.MD` are eligible, while `events/archive/Planning.md` and `events/agenda.pdf` are ignored. Choosing a folder never moves or rewrites existing notes.

Dates in week and day headers link to the corresponding daily note. The link opens an existing note or creates it through Obsidian's daily-note integration. Daily notes are navigation targets, not event stores.

## Opening the calendar

Either click on the ribbon icon, or run the "Keyboard Calendar: Open Calendar" command from the command palette.

Keyboard Calendar opens Month and Week as a desktop-only normal tab. Run "Keyboard Calendar: Open Day Calendar" to reveal the separate Day Calendar in Obsidian's right sidebar. Selecting a date in Month also opens the sidebar at that date. The retained compatibility bridge still redirects workspace leaves saved with the retired full-calendar sidebar type; that legacy type is distinct from the active Day Calendar.

Use Tab and Shift-Tab to switch between Month and Week in the main tab. Press `T` for Today. In Week and the Day Calendar sidebar, use `+` (or `=`) and `-` to expand and contract the shared time-row height. Minute labels thin out automatically at compact zoom levels. Clicking an event in the main calendar replaces that tab with its ordinary Markdown note; clicking one in the Day Calendar opens the note in the main workspace and leaves the sidebar intact.

## Troubleshooting

If the view does not match the notes on disk, run `Keyboard Calendar: Reset Event Cache`, then reopen the calendar. If the problem remains, report it at [tjmisko/obsidian-keyboard-calendar](https://github.com/tjmisko/obsidian-keyboard-calendar/issues).

Before upgrading an older installation, read [Migration and rollback](migration.md) and confirm that plugin data and workspace layout are backed up.
