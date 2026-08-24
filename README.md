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

## Keyboard navigation

The calendar opens in event-oriented normal mode. The mode chip in the toolbar shows `Normal` or `Insert`.

- In normal mode, Arrow keys or `h`, `j`, `k`, and `l` move spatially between events; counts repeat a move (for example, `3j`). `Enter` opens the focused event.
- Press `i` in a week or day view to enter blockwise insert mode at the current quarter-hour. Press `Escape` to return to normal mode and focus the event nearest the selected block.

Insert-mode commands are:

- Arrow keys or `h`, `j`, `k`, and `l`: move left, down, up, and right. Vertical movement stops at the day's boundary; horizontal movement continues into adjacent dates.
- A count repeats a movement: `3j` moves 45 minutes down, `2h` moves two days back, and `2l` moves two days forward. A counted `G` selects an absolute hour, so `18G` selects 18:00–18:15.
- `PageUp` and `PageDown`: move by one visible page of time cells.
- `Home` and `End`: move to the first or last visible day at the current time.
- `gg` and `G`: move to the first or last time cell of the day.
- `zt`, `zz`, and `zb`: align the selected cell at the top, center, or bottom of the viewport. `zh` and `zl` scroll horizontally when the grid overflows.
- `Enter`: start a 15-minute event draft. Counted up/down (or `k`/`j`) resizes it, counted left/right (or `h`/`l`) moves it by days, and a second `Enter` creates the event note. `Escape` cancels the draft and returns to normal mode.

Calendar navigation only captures keys while the calendar is the active Obsidian leaf and no editor, input, or modal is active. `Tab` and `Shift+Tab` cycle calendar views, and `t` returns to today.

## Development

```sh
npm install
npm test -- --runInBand
npm run build
```

The FullCalendar library is released under the [MIT license](https://github.com/fullcalendar/fullcalendar/blob/master/LICENSE.txt). This plugin is also MIT licensed; see [LICENSE](LICENSE).
