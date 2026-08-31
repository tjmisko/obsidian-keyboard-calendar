# Keyboard Calendar

Keyboard Calendar is a keyboard-first calendar for Obsidian on desktop and mobile by [Tristan Misko](https://github.com/tjmisko). It renders events with [FullCalendar](https://fullcalendar.io/) while keeping every event in an ordinary Markdown note in the local vault.

This fork deliberately supports one model:

- One writable local event folder. The setup flow prefers an existing `events` folder.
- Only direct-child Markdown files (`.md`, case-insensitive) in that folder are indexed; nested notes and other file types are ignored.
- Month and responsive, horizontally scrollable week views in the main workspace, with a dedicated day view in Obsidian's right sidebar or mobile drawer.
- Click-to-open event notes, timed-event creation, modal move/scale updates, recurrence controls, and confirmed deletion.
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

Back up Obsidian's plugin data and workspace layout before installing this fork. Migration intentionally scrubs or narrows older remote, daily-note-event, multi-folder, separate-mobile-view, and legacy-sidebar settings. It never moves, rewrites, or deletes event notes or daily-note contents, but Git rollback cannot restore settings or a workspace layout that Obsidian has already saved.

Use a release from this fork's [releases page](https://github.com/tjmisko/obsidian-keyboard-calendar/releases), or build the repository and copy `main.js`, `manifest.json`, and `styles.css` into the vault's `.obsidian/plugins/obsidian-keyboard-calendar/` directory. See [migration and rollback](docs/migration.md) before upgrading an existing installation.

The repository, package, manifest ID, and install directory all use `obsidian-keyboard-calendar`. Saved primary calendar leaves created under the former ID are rewritten through a decoder-only compatibility view. The Obsidian Community Plugins listing belongs to the upstream product and is not an install or update channel for this fork.

The complete documentation starts at [docs/index.md](docs/index.md).

## Keyboard navigation

The calendar opens in event-oriented normal mode. The mode chip in the toolbar shows `Normal`, `Insert`, `Grab`, or `Scale`.

- In normal mode, Down/`j` and Up/`k` move to the next and previous event by start time; equal starts follow their rendered order. Left/`h` and Right/`l` move spatially. Moving backward from the first event opens the previous week, and moving forward from the last event opens the next week. Counts repeat event movement, `Enter` opens the focused event, and `x` or `Delete` opens a confirmation before moving its note to trash.
- Press `o` on a focused recurring occurrence to confirm omitting it. Press `a` on a focused unattended ghost occurrence to confirm attendance. Enter activates the initially focused confirmation button; Tab then Enter cancels, as do Escape and the dialog's close button.
- Press `m` on a focused single timed event in the week view or Day Calendar sidebar to enter grab mode. Arrow keys or `h`, `j`, `k`, and `l` slide the event by 15 minutes or one day while preserving its duration; counts repeat a move. `Enter` confirms the position without opening the note, while `Escape` exits and leaves the event at its moved position.
- Press `s` to enter scale mode for the same editable events. Up/`k` and Down/`j` move only the bottom edge in 15-minute steps while the top stays fixed. `Enter` or `Escape` persists the result. In normal mode, `u` undoes a completed move or scale; `U` or `Ctrl+r` redoes it. In normal, grab, or scale mode, `zt`, `zz`, and `zb` align the focused event at the top, center, or bottom of the viewport.
- `yy` yanks the focused rendered occurrence. `p` creates a concrete copy at the focused event's start with the same duration and tags. The new note uses `Original filename (copied event).md`, adding a numeric suffix if needed.
- Press `i` in the week view or Day Calendar sidebar to enter blockwise insert mode at the current quarter-hour. Press `Escape` to return to normal mode and focus the event nearest the selected block.

Insert-mode commands are:

- Arrow keys or `h`, `j`, `k`, and `l`: move left, down, up, and right. Vertical movement stops at the day's boundary; horizontal movement continues into adjacent dates.
- A count repeats a movement: `3j` moves 45 minutes down, `2h` moves two days back, and `2l` moves two days forward. A counted `G` selects an absolute hour, so `18G` selects 18:00–18:15.
- `PageUp` and `PageDown`: move by one visible page of time cells.
- `Home` and `End`: move to the first or last visible day at the current time.
- `gg` and `G`: move to the first or last time cell of the day.
- `zt`, `zz`, and `zb`: align the selected cell at the top, center, or bottom of the viewport. `zh` and `zl` scroll horizontally when the grid overflows.
- `p`: paste the yanked event starting at the selected cell.
- `Enter`: start a 15-minute event draft. Counted up/down (or `k`/`j`) resizes it, counted left/right (or `h`/`l`) moves it by days, and a second `Enter` creates the event note. `Escape` cancels the draft and returns to normal mode.

Calendar navigation only captures keys while the calendar is the active Obsidian leaf and no editor, input, or modal is active. The **Previous View** and **Next View** commands are available for Obsidian hotkeys and move by the active calendar's natural interval: a day, week, or month. In the main tab, `Tab` and `Shift+Tab` switch between Month and Week; `t` returns the active calendar to today. Run **Keyboard Calendar: Open Day Calendar** to reveal the fixed day view in the right sidebar. In the Week view and Day Calendar, `+` (or `=`) expands the 15-minute rows and `-` contracts them; quarter-hour and then half-hour gutter labels disappear automatically at compact levels.

Right-click any event for a context menu with confirmed deletion. Recurring occurrences also offer omission; unattended events matching a configured ghost tag offer an attendance action. Recurring blocks carry a small repeat badge. Settings can assign ordered colors to tags; the first matching tag-color rule overrides the event-folder color.

## Mobile and touch

Week remains a seven-day calendar on narrow screens. Each day has a readable minimum width, so the grid scrolls horizontally: portrait phones show fewer days while landscape phones reveal more of the same week. The active or focused date is brought into view after calendar navigation, and rotating the device resizes the existing view without changing its date range.

Run **Keyboard Calendar: Open Day Calendar** to reveal the fixed day view in Obsidian's right drawer. Touch selection and event dragging use a 400 ms long press so an ordinary horizontal gesture can scroll the week first.

## Development

```sh
npm install
npm test -- --runInBand
npm run build
```

The FullCalendar library is released under the [MIT license](https://github.com/fullcalendar/fullcalendar/blob/master/LICENSE.txt). This plugin is also MIT licensed; see [LICENSE](LICENSE).
