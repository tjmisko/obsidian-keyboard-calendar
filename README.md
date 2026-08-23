# Full Calendar — Lean Local Fork

Full Calendar is a desktop-only, note-first calendar for Obsidian. It renders events with [FullCalendar](https://fullcalendar.io/) while keeping every event in an ordinary Markdown note in the local vault.

This fork deliberately supports one model:

- One writable local event folder. The setup flow prefers an existing `events` folder.
- Only direct-child Markdown files (`.md`, case-insensitive) in that folder are indexed; nested notes and other file types are ignored.
- Month, week, day, and list views in a normal desktop tab.
- Click-to-open event notes, timed-event creation, supported drag/resize updates, and recurrence omission.
- Date-header links to daily notes. Daily notes are navigation targets, not event stores.
- Local-only calendar operation with no ICS, CalDAV, Google connector, remote refresh, or credential UI.

## Event notes

A minimal timed event looks like this:

```yaml
---
date: 2026-08-23
start: 09:00
end: 10:00
tags:
  - event
---
```

The filename supplies the title unless `title` is set. The rest of the note is yours; plugin-driven timing and omission changes preserve unrelated frontmatter and Markdown body content. See the [event format](docs/events/types.md) and [recurrence format](docs/events/recurring.md).

## Install and upgrade

Back up Obsidian's plugin data and workspace layout before installing this fork. Migration intentionally scrubs or narrows older remote, daily-note-event, multi-folder, mobile, and sidebar settings. It never moves, rewrites, or deletes event notes or daily-note contents, but Git rollback cannot restore settings or a workspace layout that Obsidian has already saved.

Use a release from this fork's [releases page](https://github.com/tjmisko/obsidian-full-calendar/releases), or build the repository and copy `main.js`, `manifest.json`, and `styles.css` into the vault's `.obsidian/plugins/obsidian-full-calendar/` directory. See [migration and rollback](docs/migration.md) before upgrading an existing installation.

The retained plugin ID matches the historical project for workspace/settings compatibility. The Obsidian Community Plugins listing belongs to the upstream product and is not an install or update channel for this fork.

The complete documentation starts at [docs/index.md](docs/index.md).

## Development

```sh
npm install
npm test -- --runInBand
npm run build
```

The FullCalendar library is released under the [MIT license](https://github.com/fullcalendar/fullcalendar/blob/master/LICENSE.txt). This plugin is also MIT licensed; see [LICENSE](LICENSE).
