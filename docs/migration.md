# Migration and rollback

Back up Obsidian's plugin data and workspace layout before installing this fork over an older Full Calendar release. The migration never moves, rewrites, or deletes event notes or daily-note contents, but it intentionally narrows saved settings and may rewrite a restored workspace layout. Git rollback alone cannot undo those changes.

## What changes

- Settings v2 removes CalDAV/iCloud sources and their credential fields. Only a source-type/version marker is retained.
- Settings v3 removes ICS sources and their URLs. Only a source-type/version marker is retained.
- Settings v4 removes daily-note event sources. Existing daily-note list items stay on disk and stop appearing as calendar events; date-header daily-note navigation remains.
- Settings v5 retains one writable local folder. It prefers the previously selected local source and otherwise the first valid local source. Notes belonging to discarded folder configurations are not moved.
- Settings v6 retains one desktop initial view and discards the retired mobile/three-day preference.
- Settings v7 adds a configurable ghost-event tag list, initially containing the neutral `ghost` tag.
- A saved legacy sidebar leaf is redirected into the normal main-tab calendar view. The decoder-only compatibility view and its completion marker remain until a separately approved removal gate.
- The old public Dataview `renderCalendar`/`processFrontmatter` hooks are removed. Arbitrary URL and callback event sources are no longer accepted; the internal renderer receives materialized local events only.

Only direct-child Markdown files in the selected folder are indexed after migration. Nested notes remain untouched but are not shown.

An older empty-directory source is retained as a vault-root compatibility case and may appear in settings as **Vault root (legacy)**. To replace it, choose a real non-root folder such as `events`; the folder picker does not create or newly select the vault root.

## Redacted quarantine

Removed source entries are represented only by allowlisted source-type and removal-version markers. Raw remote URLs and credential fields are not retained. These redacted markers are not aged out by restart count; removing the quarantine requires explicit user acceptance in a separate change.

## Roll back

1. Stop Obsidian before replacing plugin files.
2. Restore the backed-up plugin data and workspace layout when returning to a version that expects the older source or sidebar settings.
3. Install the matching older plugin build.
4. Reopen Obsidian and verify settings before enabling any retired remote source.

Reverting only the Git commit restores code, not settings or layout state already saved by Obsidian. Event-note and daily-note file contents do not require migration rollback because these migrations do not edit them.
