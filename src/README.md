# Plugin Architecture

Obsidian Full Calendar's goal is to give desktop users a robust normal-tab calendar view into their Obsidian Vault. It displays and modifies events stored in full-note frontmatter. Calendar operation is local-only; daily notes remain navigation targets from date headers rather than event stores. The retired sidebar view type exists only in a narrow workspace-layout compatibility bridge.

Obsidian Full Calendar takes its name from [FullCalendar](https://github.com/fullcalendar/fullcalendar), a "Full-sized drag & drop event calendar in JavaScript." This plugin uses FullCalendar as its calendar view. While the naming can be ambiguous, this document will always refer to the FullCalendar view library without any spaces, or as `fullcalendar.io`. The plugin will be referred to either as "the plugin", "Full Calendar" with a space, or "Obsidian Full Calendar".

The plugin supports one event source format:

-   Frontmatter of notes in the open Obsidian Vault.

The calendar layer validates this frontmatter into the internal event format used by the view.

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

This module defines some common types used throughout the code. The most prevalent is `OFCEvent`, short for Obsidian Full Calendar Event, that specifies the intermediate representation for all events in the plugin. Note that FullCalendar.io uses a different event format called `EventInput`, which you can read about [in their documentation](https://fullcalendar.io/docs/event-parsing).

`OFCEvent` is derived from a [Zod parser](https://github.com/colinhacks/zod) that handles parsing/validating JavaScript objects into the expected shape of an event. You can check out the parser in `types/schema.ts`.

Translation between `OFCEvent` and `EventInput` is handled in `interop.ts`. `FullNoteCalendar` translates local note frontmatter into `OFCEvent`.

### `core`

The `core` directory's runtime consists of `LocalEventIndex` and `EventCache`.

`LocalEventIndex` holds the in-memory view of the one configured local full-note source. It admits only direct-child Markdown notes, assigns stable namespaced IDs from the source/path tuple, and maintains matching ID and path maps across scans and vault lifecycle events.

`EventCache` coordinates that index with the view layer and `FullNoteCalendar`, which reads and writes event notes. Its main hooks are:

-   Vault and metadata hooks for direct-note create/update/rename/delete events.
-   Hook for when an event with a given ID has been modified from the view.
    Other components can subscribe to state updates on the `EventCache`. Right now, the view is the only subscriber, but in the future it may be possible for other plugins to subscribe to updates.

Notably, while the `core` components have some knowledge of Obsidian APIs (mostly the `TFile` type), they do not hold references to the `App`, `Vault`, `MetadataCache` or any other API that deals with file I/O. File I/O is handled entirely by the narrow `FullNoteCalendar` adapter. This simplifies testing dramatically, since the Obsidian API does not need to be mocked out when testing the `EventCache` logic.

The plugin has exactly one `EventCache` instance at any given time. It is initialized and hooked up to `Vault` and `MetadataCache` listeners when the plugin is initialized, in `main.ts`.

### `calendars`

`FullNoteCalendar` is the sole local-source adapter. It handles vault I/O and parses note frontmatter into the common format without a generic calendar inheritance layer.

`FullNoteCalendar` is constructed with an `ObsidianAdapter` that handles all interactions with the Obsidian API. This adapter reduces the testing surface to the handful of operations the plugin actually uses. It also provides safe abstractions that prevent stale file copies from being written back to disk.

### `ui`

While `core` and `calendars` make up the Model in the `MVC` pattern, the Views and Controllers are currently both living in the `ui` directory. The view connector to the FullCalendar library lives in `calendar.ts`. Most of the controller logic that interfaces with the `EventCache` lives, somewhat confusingly, in `view.ts`, which also instantiates the Obsidian plugin View. Event interactions route to ordinary Markdown notes, and source/preferences UI uses native Obsidian `Setting` and `Modal` primitives.

**Architecture Invariant**: All event-note data I/O and writes are mediated by `EventCache` and `FullNoteCalendar`. UI code may use read-only Vault folder discovery to validate native settings choices, but it must not read, move, rewrite, or delete event notes directly or call `LocalEventIndex`.
