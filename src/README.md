# Plugin Architecture

This fork gives desktop users a normal-tab calendar over local, full-note events. One configured folder—normally `events`—is writable. Ownership is exact: only direct children with a case-insensitive `.md` extension are indexed. Daily notes remain navigation targets from date headers rather than event stores.

Keyboard Calendar uses [FullCalendar](https://github.com/fullcalendar/fullcalendar), a "Full-sized drag & drop event calendar in JavaScript," as its calendar view. This document refers to the view library as FullCalendar without a space, or as `fullcalendar.io`, and to this plugin as Keyboard Calendar.

The active runtime supports one event source format:

-   Frontmatter of notes in the open Obsidian Vault.

The calendar layer validates this frontmatter into the internal event format used by the view. It exposes no URL/callback event-source route and makes no calendar network request.

Below is a birds-eye view of the different components of the plugin, and the interactions between them.

```
Obsidian Vault APIs* ↔ FullNoteCalendar ↔ EventCache ↔ view.ts/calendar.ts ↔ FullCalendar View*
                                            ↕
                                      LocalEventIndex

 * Components with an asterisk are not part of the plugin's code.
```

## Codemap

Following the advice in [this blog post on architecture docs](https://matklad.github.io/2021/02/06/ARCHITECTURE.md.html), the following section will list out the main modules of the code without linking out to specific file locations that may quickly become stale. Make use of code search and the TypeScript Language Server to jump around and explore the code, with this section as your guide.

### `types`

This module defines some common types used throughout the code. The most prevalent is the inherited `OFCEvent` type (short for Obsidian Full Calendar Event), which specifies the intermediate representation for all events in the plugin. FullCalendar.io uses a different event format called `EventInput`, which you can read about [in its documentation](https://fullcalendar.io/docs/event-parsing).

`OFCEvent` is derived from a [Zod parser](https://github.com/colinhacks/zod) that handles parsing/validating JavaScript objects into the expected shape of an event. You can check out the parser in `types/schema.ts`.

Translation between `OFCEvent` and `EventInput` is handled in `interop.ts`. `FullNoteCalendar` translates local note frontmatter into `OFCEvent`.

### `core`

The `core` directory's runtime consists of `LocalEventIndex` and `EventCache`.

`LocalEventIndex` holds the in-memory view of the one configured local full-note source. It assigns stable namespaced IDs from the source/path tuple and maintains matching ID and path maps across scans and vault lifecycle events.

`EventCache` coordinates that index with the view layer and `FullNoteCalendar`, which reads and writes event notes. Its main hooks are:

-   Vault and metadata hooks for direct-note create/update/rename/delete events.
-   A disk-first mutation path for create, rename/rewrite, delete, and recurrence omission.
-   Incremental materialized event updates to the active view.

Notably, while the `core` components have some knowledge of Obsidian APIs (mostly the `TFile` type), they do not hold references to the `App`, `Vault`, `MetadataCache` or any other API that deals with file I/O. File I/O is handled entirely by the narrow `FullNoteCalendar` adapter. This simplifies testing dramatically, since the Obsidian API does not need to be mocked out when testing the `EventCache` logic.

The plugin has exactly one `EventCache` instance at any given time. It is initialized and hooked up to `Vault` and `MetadataCache` listeners when the plugin is initialized, in `main.ts`.

### `calendars`

`FullNoteCalendar` is the sole local-source adapter. It handles vault I/O and parses note frontmatter into the common format without a generic calendar inheritance layer.

`FullNoteCalendar` is constructed with an `ObsidianAdapter` that handles all interactions with the Obsidian API. This adapter reduces the testing surface to the handful of operations the plugin actually uses. It also provides safe abstractions that prevent stale file copies from being written back to disk.

### `ui`

`calendar.ts` is an internal renderer boundary that accepts only materialized local `EventInput[]` sources. `view.ts` translates the cache output and owns calendar interactions. Event clicks route to ordinary Markdown notes, while source/preferences UI uses native Obsidian `Setting` and `Modal` primitives.

### `settings` and compatibility

The pure settings decoder accepts legacy persisted data before the runtime is initialized. Removed source values are reduced to source-type/version-only quarantine markers. The retired sidebar view remains registered only through `legacy_sidebar_bridge.ts` and `LegacySidebarCompatibilityView.ts` so saved workspaces can be redirected safely. Neither compatibility path recreates a source, performs a network request, or edits a note.

**Architecture Invariant**: All event-note data I/O and writes are mediated by `EventCache` and `FullNoteCalendar`. UI code may use read-only Vault folder discovery to validate native settings choices, but it must not read, move, rewrite, or delete event notes directly or call `LocalEventIndex`.
