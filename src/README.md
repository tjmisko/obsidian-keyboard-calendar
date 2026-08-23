# Plugin Architecture

Obsidian Full Calendar's goal is to give users a robust calendar view into their Obsidian Vault. It displays and modifies events stored in full-note frontmatter. Calendar operation is local-only; daily notes remain navigation targets from date headers rather than event stores.

Obsidian Full Calendar takes its name from [FullCalendar](https://github.com/fullcalendar/fullcalendar), a "Full-sized drag & drop event calendar in JavaScript." This plugin uses FullCalendar as its calendar view. While the naming can be ambiguous, this document will always refer to the FullCalendar view library without any spaces, or as `fullcalendar.io`. The plugin will be referred to either as "the plugin", "Full Calendar" with a space, or "Obsidian Full Calendar".

The plugin supports one event source format:

-   Frontmatter of notes in the open Obsidian Vault.

The calendar layer validates this frontmatter into the internal event format used by the view.

Below is a birds-eye view of the different components of the plugin, and the interactions between them.

```
                 ┌──────────────┐
                 │              │
┌────────────┐   │              │       ┌─────────────┐     ┌──────────────┐
│            ├───►              ├───────►             ├─────►              │
│ EventStore │   │  EventCache  │       │ view.ts +   │     │ FullCalendar │
│            ◄───┤              ◄───────┤ calendar.ts ◄─────┤ View*        │
└────────────┘   │              │       │             │     │              │
                 │              │       └─────────────┘     └──────────────┘
             ┌──►└──────▲──┬────┘
             │          │  │
             │          │  │
             │    ┌─────┴──▼─────┐
             │    │              │
             │    │  Calendars   │
             │    │              │
             │    └─▲──┬─────▲───┘
             │      │  │     │
 ┌───────────┴──────┴──▼──┐  │
 │                        │  │
 │Obsidian Vault APIs*    ◄──┘
 │                        │
 └────────────────────────┘
 * Components with an asterisk are not part of the plugin's code.
```

## Codemap

Following the advice in [this blog post on architecture docs](https://matklad.github.io/2021/02/06/ARCHITECTURE.md.html), the following section will list out the main modules of the code without linking out to specific file locations that may quickly become stale. Make use of code search and the TypeScript Language Server to jump around and explore the code, with this section as your guide.

### `types`

This module defines some common types used throughout the code. The most prevalent is `OFCEvent`, short for Obsidian Full Calendar Event, that specifies the intermediate representation for all events in the plugin. Note that FullCalendar.io uses a different event format called `EventInput`, which you can read about [in their documentation](https://fullcalendar.io/docs/event-parsing).

`OFCEvent` is derived from a [Zod parser](https://github.com/colinhacks/zod) that handles parsing/validating JavaScript objects into the expected shape of an event. You can check out the parser in `types/schema.ts`.

Translation between `OFCEvent` and `EventInput` is handled in `interop.ts`. Each `Calendar` subclass (see below) handles its own translation from its source format into `OFCEvent`.

### `core`

The `core` directory consists of two classes, `EventStore` and `EventCache`. These two classes comprise the plugin's main event-managing logic.

The `EventStore` is the source of truth for events in the plugin. Its interface is similar to a simplified database that stores events, calendars and file locations. Files and calendars are one-to-many relationships: every event is related to exactly one calendar and at most one file, but calendars and files can have many events within them. The `EventStore` allows for efficient querying of events grouped by calendars and files. Every event in the `EventStore` has an ID generated when it enters the cache.

The `EventCache` manages the state stored in the `EventStore`. Its main job is coordinating with both the view layer and the `Calendar`s which read events from the vault. The `EventCache` has two main hooks to update the `EventStore`:

-   Hook (via `MetadataCache.on('update')`) for when a file has changed so that it can tell `Calendar`s to re-parse that file.
-   Hook for when an event with a given ID has been modified from the view.
    Other components can subscribe to state updates on the `EventCache`. Right now, the view is the only subscriber, but in the future it may be possible for other plugins to subscribe to updates.

Notably, while the `core` components have some knowledge of Obsidian APIs (mostly the `TFile` type), they do not hold references to the `App`, `Vault`, `MetadataCache` or any other API that deals with file I/O. File I/O is handled entirely by the `Calendar` subclasses. This simplifies testing dramatically, since the Obsidian API does not need to be mocked out when testing the `EventCache` logic.

The plugin has exactly one `EventCache` instance at any given time. It is initialized and hooked up to `Vault` and `MetadataCache` listeners when the plugin is initialized, in `main.ts`.

### `calendars`

`FullNoteCalendar` handles vault I/O and parses note frontmatter into the common format. It derives from `EditableCalendar`.

`EditableCalendar`s are constructed with references to an `ObsidianAdapter` instance that handles all interactions with the Obsidian API. This adapter is useful for testing, since it reduces the surface area of APIs to be mocked from the entire API to a handful of functions that the plugin actually uses. It also allows for useful and safe abstractions on top of the Obsidian API, so that its harder for Calendars to do incorrect things, like write a stale copy of a file back to disk.

### `ui`

While `core` and `calendars` make up the Model in the `MVC` pattern, the Views and Controllers are currently both living in the `ui` directory. The view connector to the FullCalendar library lives in `calendar.ts`. Most of the controller logic that interfaces with the `EventCache` lives, somewhat confusingly, in `view.ts`, which also instantiates the Obsidian plugin View. Auxilliary views, like the edit/create modal and settings selectors, are React components that live in their own `.tsx` files and are mounted into the DOM when needed.

**Architecture Invariant**: All interactions with event data should be mediated by the `EventCache`. Code in the `ui` directory should not reference or call out to the `EventStore`, Obsidian Vault APIs, or `Calendar` subclasses.
