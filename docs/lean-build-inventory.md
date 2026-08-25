# Lean build and dependency inventory

This is the reproducible Phase 9 build record for the desktop, local-note fork. It contains no vault data or user settings.

## Reproduce

```sh
npm run build:metafile
npm ls --omit=dev --depth=0 --package-lock-only
wc -c main.js styles.css main.css package-lock.json docs/lean-esbuild-metafile.json
sha256sum docs/lean-esbuild-metafile.json
```

`npm run build:metafile` performs the TypeScript check and production build, then writes the tracked, path-normalized [lean-esbuild-metafile.json](lean-esbuild-metafile.json). Use a normal physical npm install for reproduction; module paths in the artifact are repository/package-relative. Two consecutive generations produced byte-identical output.

## Final artifacts

| Artifact | Decimal bytes |
| --- | ---: |
| `main.js` | 1,224,886 |
| `styles.css` | 41,997 |
| generated `main.css` | 41,997 |
| `package-lock.json` | 324,154 |
| `docs/lean-esbuild-metafile.json` | 53,232 |

The metafile SHA-256 is `afb858e98f7a730e512cba3ae9c73cd99bb8a0e6d4377678d5c681f7112871d0`. It contains 106 inputs and two outputs. Normal module resolution keeps `rrule`'s nested `tslib` distinct from the root package, and collision-checked normalization fails instead of overwriting two paths. The JavaScript bundle is below the rebaselined 1.30 MB target.

## Direct runtime dependencies

The lock-only production inventory exits successfully with 10 direct dependencies:

- `@fullcalendar/core@5.11.4`
- `@fullcalendar/daygrid@5.11.4`
- `@fullcalendar/interaction@5.11.4`
- `@fullcalendar/rrule@5.11.2`
- `@fullcalendar/timegrid@5.11.4`
- `luxon@2.5.2`
- `moment@2.29.4`
- `obsidian-daily-notes-interface@0.9.4`
- `rrule@2.7.2`
- `zod@3.21.4`

`moment` and `obsidian-daily-notes-interface` remain solely for date-header daily-note navigation. `rrule`/Luxon support recurrence and time conversion. `tslib` remains transitively reachable from retained libraries but is no longer a direct dependency. FullCalendar internally bundles Preact; this is not the removed React/ReactDOM application surface.

The lock refresh reduces package entries from 378 to 338: 40 packages leave, with zero additions or package-version changes. The removed closure is the unused TypeScript ESLint parser/plugin plus ESLint, glob, tsutils-only dependencies, and the retired FullCalendar List view. `react-is` remains dev-only through Jest.

## Static convergence and allowlists

The following searches use file-only output so they cannot print a legacy secret-bearing value:

```sh
rg -l -i '\b(caldav|icloud|ical|ics|bearer)\b' src package.json manifest.json
rg -l -i 'full-calendar-sidebar-view|legacy.*sidebar|mobile|three.?day|timeGrid3Days' src package.json manifest.json
rg -l -i 'DailyNote|daily.note|dailynote' src package.json manifest.json
rg -l -i 'isTask|taskCompleted|ofc-task|checkbox' src package.json manifest.json
rg -l -i '\breact-dom\b|\breact\b|node_modules/react|@types/react' src package.json manifest.json
rg -l 'requestUrl|XMLHttpRequest|WebSocket|EventSourceInput|\bfetch\(' src --glob '!**/*.test.ts'
```

The explicit residual allowlist is:

| Term family | Allowed locations | Reason |
| --- | --- | --- |
| CalDAV/ICS/iCloud | `src/settings/migration.ts` and its test | Versioned source-type-only decoder/quarantine and synthetic leak fixtures |
| Retired sidebar/mobile view | `src/legacy_sidebar_bridge.ts`, `src/ui/LegacySidebarCompatibilityView.ts`, registration in `src/main.ts`, migration decoder, and their tests | Decoder-only persisted-workspace bridge and completion marker remain; the active Day Calendar uses a distinct sidebar view type |
| Daily note | `src/ui/daily_note_navigation.ts`, date-header renderer/view/CSS, `obsidian-daily-notes-interface`, migration decoder/fixture, and tests | Retained navigation only; never an event source |
| EventStore/line lookup | `src/performance/phase8b_local_index_benchmark.test.ts` | Test-local archived old-index oracle only |
| Task/checkbox vocabulary | Negative assertions in renderer/interop tests only | Proves the removed task surface stays absent |
| Retired month-click key | One migration persistence test only | Decoder omits the behavior; the save merge preserves an untouched key as functionally inactive compatibility data |
| `defaultCalendar` | Version-5 migration/tests and the calendar-settings compatibility helper | Legacy selection/scrub vocabulary only; runtime owns exactly one local source |
| FullCalendar JSON-feed/network symbols | Dormant code in generated `main.js`, attributed by the metafile to FullCalendar common/core | The first-party URL/callback source boundary is removed; this fork passes only materialized local event arrays |
| `eventStore` | FullCalendar internals in generated `main.js` (attributed by the metafile) and the archived test oracle | Third-party renderer internals and test-only characterization, not the removed production `EventStore` layer |
| `completed` | Event schema, frontmatter preservation paths, and compatibility tests | Retained parser-compatible metadata; there is no task/checkbox UI |

There are no non-test runtime credential-field matches, no non-test network API matches, no active remote source class, and no removed connector/React/deep-equal input in the metafile. The renderer accepts only already-materialized local event arrays; there is no URL or callback event-source boundary.

These are static and deterministic Node/build proofs. Live Obsidian network observation, note-open latency, navigation/history, and two-restart acceptance remain pending in the manual release matrix.
