# Getting started

## Choose an event folder

Open Full Calendar from the command palette or ribbon for the first time and the native setup prompt asks you to choose one existing vault folder for [full-note events](calendars/local). If an `events` folder exists, it is selected by default. The folder choice is saved before the calendar opens. Events remain separate Markdown notes with frontmatter, and calendar operation is local to the vault.

Dates in week and day headers link to the corresponding daily note. The link opens an existing note or creates it through Obsidian's daily-note integration. Daily notes are navigation targets, not event stores.

## Opening the calendar

Either click on the ribbon icon, or run the "Full Calendar: Open Calendar" command from the command palette.

![Open calendar](assets/open-calendar.gif)

Full Calendar is a desktop-only normal-tab view. Existing workspace layouts
saved with the older sidebar view are redirected to a normal calendar tab by a
retained compatibility bridge; the sidebar is no longer an active feature.
Back up Obsidian before upgrading. Git rollback cannot restore a migrated
workspace layout or the discarded mobile initial-view preference, and the
compatibility shim remains to handle saved legacy sidebar leaves.

## Troubleshooting

If something is not working as expected, you should first try to clear the cache with the command `Full Calendar: Reset Event Cache`. If that didn't fix your problem, then feel free to [submit an issue on GitHub](https://github.com/obsidian-community/obsidian-full-calendar/issues).
