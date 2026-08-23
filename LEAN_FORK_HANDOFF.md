# Lean Full Calendar Fork: Execution Handoff

Status: adversarially reviewed implementation plan

Planning baseline: `533d2ab` on `feat/frontmatter-note-editor`

Prepared: 2026-08-22

Inputs: connector/dependency review, local-core review, and independent adversarial review

Review outcome: connector `ACCEPT`, local-core `ACCEPT`, adversarial `ACCEPT`

## Mission

Turn this fork into a desktop-first, note-first calendar with the smallest practical maintenance and runtime surface. Keep FullCalendar as the rendering engine. Remove source adapters, editor abstractions, UI modes, and generic state machinery that do not serve the target workflow.

This is a phased cut, not a greenfield renderer rewrite. Every phase must leave the plugin buildable, testable, restart-safe, and revertible.

## Target product contract

The finished fork provides:

- Full-note events stored as Markdown files with YAML frontmatter.
- Month, week, day, and list views.
- Drag/resize updates for single and weekly local full-note events.
- Weekly and nth-weekday recurrence, `start-recurrence`, inclusive `end-recurrence`, and `omit` exclusions.
- Event clicks that replace the originating calendar leaf with a normal Markdown buffer.
- Native Obsidian command palette, Escape, Vim, Back/Forward, and recent-file behavior.
- Daily-note links in calendar date headers. Daily notes are navigation targets, not event stores.
- A minimal recurrence context menu containing “Omit this occurrence.”
- Local-only operation with no external-calendar or generic remote connector boundary.

The finished fork does not provide:

- Google Calendar’s FullCalendar rendering connector or a bundled Google API key.
- CalDAV, iCloud discovery, remote writes, or stored remote credentials.
- Events stored as list items in daily notes.
- Calendar task checkboxes or completion controls.
- A React event editor.
- A calendar sidebar view or a dedicated mobile/three-day mode.
- Calendar-driven deletion of an entire event note.
- A generic connector framework intended for hypothetical future sources.

Future Google visibility, OAuth, or two-way sync is a separate project and must not be coupled to this renderer.

## Invariants that no cut may break

### Note and recurrence invariants

- `start-recurrence` supersedes `date` when present.
- `end-recurrence` is inclusive in YAML and exclusive internally.
- `omit` contains valid `YYYY-MM-DD` values, deduplicated and sorted.
- Weekly recurrence retains local wall-clock time across DST.
- End times less than or equal to start times represent overnight events.
- Monthly `week` plus `weekday` behavior and `FRIENDLY_RECURRENCE_ANCHOR` remain stable.
- Nth-weekday recurrence remains editable through YAML and omission, but its rendered occurrences are not draggable/resizable until recurrence reconstruction is explicitly implemented and tested.
- Drag, resize, and omission edits preserve unrelated YAML and the Markdown body.
- Legacy notes without the friendly `event` tag continue through the legacy parser until a separately approved migration.
- The legacy `completed` field remains parse-compatible during the cut even after task UI disappears.

### Navigation invariants

- The command ID `full-calendar-open` and view type `full-calendar-view` remain stable.
- `CalendarView.navigation` remains `true`.
- Event open/create passes the originating `WorkspaceLeaf` through to `EventNoteEditor.open`.
- Event notes use ordinary `leaf.openFile(file)`; no modal, synthetic split, or embedded leaf returns.
- Back returns from the event-note buffer to the calendar in the same leaf.
- Grappling Hook can see normally opened event notes through Obsidian’s recent-file list.
- Modifier-click may retain its separate new/recent-leaf behavior; daily-note header navigation may retain its existing most-recent-leaf behavior. Do not generalize the event-click history contract to those paths accidentally.

### Safety invariants

- No migration or index pass edits event notes.
- No log, Notice, fixture snapshot, persisted migration output, or handoff artifact contains a real/raw user CalDAV password, bearer-style ICS URL, username, or Google key. Input-only test fixtures may use unmistakably synthetic sentinel credentials and must assert that those sentinels never reach output, logs, Notices, or snapshots.
- An unsupported saved source cannot crash plugin startup.
- Each accepted phase is one atomic implementation-and-tests commit plus, if needed, a separate documentation commit. The coordinator squashes/fixes up agent commits before acceptance.
- Do not start the next phase until the adversarial gate for the current phase passes.

## Measured baseline

Record these again immediately before Phase 1:

| Metric | Baseline |
| --- | ---: |
| `main.js` | 2,639,455 bytes |
| `main.css` / `styles.css` | 39,844 bytes |
| `package-lock.json` | 743,436 bytes |
| TypeScript source and tests under `src/` | 9,251 lines |
| Jest | 138 passed, 2 todo, 44 snapshots |

Major bundled contributors measured during planning:

- React, ReactDOM, scheduler, and object-assign: approximately 869 KB.
- `dav`: approximately 224 KB.
- CalDAV-only color/co chain: approximately 53 KB.
- The plugin’s `ical.js` parser: approximately 185 KB.
- Dead FullCalendar Google/iCalendar adapters: approximately 12 KB.

Bundle size is a useful regression signal, not the sole goal. Correctness, secret handling, note preservation, and navigation take priority.

## Team and integration model

The coordinator owns the integration branch and handoff ledger. Implementation agents work in isolated Git worktrees created from the last accepted phase.

For every phase:

1. The implementation agent receives only that phase’s contract and writes one focused candidate commit.
2. A test/migration agent adds or reviews boundary tests without broadening scope.
3. An adversarial reviewer inspects the final diff and tries legacy settings, failure paths, navigation, and destructive operations.
4. The coordinator integrates candidate work, squashes/fixes implementation and phase tests into one accepted phase commit, runs the full gate, records metrics, and either accepts or reverts that commit.

Parallel work is allowed only when file ownership does not overlap:

- Phase 1 implementation and Phase 0 fixture work may run in parallel.
- After Phase 2, ICS hardening and daily-note-source removal may run in parallel worktrees, but the coordinator integrates ICS first and resolves `main.ts`, settings, and source-union conflicts explicitly.
- React removal cannot begin until daily-note event editing is gone and native source settings exist.
- Core/index redesign is never parallelized with source or UI deletion.

Worktrees prevent filesystem clashes, not semantic conflicts. Whenever parallel candidates touch conceptual hotspots such as `src/main.ts`, the settings schema/UI, or package files, the integrated result must rerun all legacy-settings migration fixtures and every affected source-count gate. Conflict resolution itself receives adversarial review.

Each agent handoff must include:

- Commit SHA and diff stat.
- Files and packages removed or retained.
- Migration behavior and fixtures added.
- Full test/build results.
- Before/after bundle measurements.
- Manual checks performed.
- Known risks and an explicit `ACCEPT` or `REJECT` recommendation.

## Decision and acceptance ledger

Update this table in every phase handoff; an empty decision or acceptance cell is a stop condition for dependent work.

| Item | Current state | Required before proceeding |
| --- | --- | --- |
| Phase 0 safety harness | Accepted and integrated at `49d7db8`; adversarial `ACCEPT` | Complete |
| Phase 1 dead connectors | Accepted and integrated at `f4bff77`; adversarial `ACCEPT` | Complete |
| Phase 2 CalDAV removal | Accepted and integrated at `63c7b5f`; backup confirmed; adversarial `ACCEPT` | Complete |
| Phase 3 remote boundary | `REMOVE_ICS` recorded; implementation in progress | Complete the removal gate and adversarial review |
| D1 writable folders | Undecided; recommendation: one | Explicit user decision before Phase 6 design |
| D2 folder traversal | Undecided; recommendation: direct child | Explicit user decision before Phase 6 design |
| Sidebar bridge removal | Deferred compatibility work | Persisted migration marker, workspace backup, explicit acceptance or stated version boundary |
| Redacted quarantine removal | Deferred | Explicit user acceptance; never age by restart count |

### Phase 0 accepted record — 2026-08-22

- Candidate scope: pure versioned settings decode/migration, non-destructive production persistence, sanitized diagnostics/counts, registration/navigation seams, nth-weekday edit lock, recurrence/date/body preservation, and a repeatable deterministic benchmark.
- Production behavior: loading settings makes no save. Runtime sources contain only validated, currently supported sources. An unrelated settings save preserves the raw persisted source array, including valid current credentials and rejected/unknown slots; only fields explicitly changed since load are written. The future credential-removal migration remains pure and inactive.
- Migration fixtures: local-only, ICS-only, mixed local/ICS/CalDAV/daily-note, CalDAV-only, malformed roots/members, unknown types, string/numeric defaults, original raw numeric slots, and nested desktop/mobile initial-view state.
- Secret gate: four distinct synthetic CalDAV name/URL/username/password sentinels are absent from migration output, logs, Notices, and snapshots. Diagnostics expose only fixed allowlisted type buckets and counts.
- Note gate: nth-weekday occurrences are non-draggable/non-resizable in rendered inputs and rejected by the view mutation path. Recurrence edits/omissions preserve a deliberately different legacy `date`, unrelated YAML, and Markdown body.
- Automated tests: 16 suites passed; 169 passed, 2 todo; 44 snapshots passed.
- Compile/lint/build/diff: `ACCEPT` (`npm run compile`, `npm run lint`, production `npm run build`, and `git diff --check`).
- Production artifacts: `main.js` 2,658,035 bytes; `styles.css` and generated `main.css` 40,048 bytes each; `package-lock.json` 743,436 bytes. Phase 0 intentionally removes no package; the safety harness adds 18,580 bytes to the planning `main.js` baseline.
- Dependency inventory: `npm ls --omit=dev --depth=0` exited successfully. No dependency or lockfile entry changes in Phase 0; the worktree's shared `node_modules` symlink reports its already-installed transitive packages as extraneous.
- Benchmark: see `docs/phase0-safety-baseline.md`. The repeatable mocked-adapter result is startup/index median 0.376 ms and p95 0.762 ms; event-open median 0.0077 ms and p95 0.0197 ms. These are Node seam measurements, not claimed Obsidian GUI or filesystem timings.
- Manual matrix: not run in this headless worktree. No Obsidian application/vault or user data was opened. Calendar navigation, Back/Forward, Grappling Hook, restart behavior, and real-vault performance remain coordinator/manual acceptance items.
- D1/D2: still pending explicit user decisions. Recommendations remain one writable local folder and direct-child traversal. No additional local source is removed or quarantined by Phase 0.
- Rollback: revert the single Phase 0 integration commit `49d7db8`. No settings migration, workspace migration, note write, credential scrub, package deletion, or other irreversible action is activated.

### Phase 1 accepted record — 2026-08-22

- Integrated commit: `f4bff77` (`refactor: remove dead calendar connectors`), after Phase 0 commit `49d7db8`.
- Removed: `@fullcalendar/google-calendar`, `@fullcalendar/icalendar`, unused `ical`, unused `@types/ical`, both adapter registrations, `googleCalendarApiKey`, and the bundled Google key. Retained: `ical.js` and the plugin-owned ICS parser.
- Dependency gate: direct runtime dependencies decreased from 23 to 19. The focused lockfile change removed only the four direct dependencies and their uniquely unreachable nested `ical`/`@types/ical` Luxon, RRule, and tslib copies.
- Source/render gate: materialized single and weekly event arrays still pass unchanged to the retained Month, Week, Day, and List renderer plugins. Existing omission tests remain green.
- Isolated same-toolchain measurement: `main.js` 2,651,236 to 2,638,829 bytes, a 12,407-byte reduction; `package-lock.json` 743,436 to 736,105 bytes; CSS unchanged at 40,048 bytes in that worktree.
- Combined integration gate: 16 suites passed; 170 tests passed, 2 todo, 44 snapshots; compile, lint, production build, `git diff --check`, lock-based dependency inventory, and removed-key/import searches all passed. Integrated artifacts are `main.js` 2,633,949 bytes, `styles.css`/`main.css` 39,844 bytes, and `package-lock.json` 736,105 bytes.
- Adversarial result: `ACCEPT`. No rendered-source code path, event-count transformation, settings behavior, note write, or Phase 2 behavior changed.
- Manual matrix: no live Obsidian GUI was available. Visual event-count equivalence across all four views, recurrence omission appearance, restart behavior, and the broader navigation matrix remain release acceptance items.
- Rollback: revert the single Phase 1 commit. No persisted settings, workspace layout, note, or external state was mutated by this phase.

### Phase 2 accepted record — 2026-08-22

- Backup gate: satisfied before implementation. The user explicitly acknowledged that Obsidian, including the plugin data needed to restore the pre-migration settings, is backed up. No vault, real plugin data, `.env`, or `.secrets` file was opened in this isolated worktree.
- Migration behavior: settings version 2 is active. Legacy sources are decoded against original raw slots, numeric local defaults are resolved before filtering, CalDAV sources are removed, and only the generated `{ legacyType: "caldav", removedAtVersion: 2 }` envelope remains. Five distinct synthetic name/URL/home-URL/username/password sentinels are absent from saved output, logs, Notices, and runtime settings.
- Persistence ordering: a changed scrubbed result is awaited before cache reset/init; a failed settings write prevents runtime initialization. Already-migrated byte-equivalent settings request no write. Stale CalDAV is scrubbed even when the stored version is current, future versions are not downgraded, unrelated top-level settings are preserved, and persisted/runtime objects are separate snapshots so in-place edits remain detectable.
- Legacy boot gate: mixed, CalDAV-only, malformed-root, malformed-member, raw `icloud`, and mixed-case fixtures boot without exceptions. CalDAV-only settings pass through cache reset and population without invoking any runtime adapter. No migration/index path writes a note.
- Removed runtime/UI: `CalDAVCalendar`, CalDAV import/transport, runtime source union and initializer, authentication/source exports, iCloud/CalDAV settings options, credential inputs, and saved-source credential display. Retained legacy `caldav` strings exist only in the fixed migration bucket/envelope and synthetic tests.
- Removed dependencies: direct `dav`, `color`, `@types/dav`, `@types/color`, and `@types/co`; the focused lockfile edit also removes only their exclusively unreachable nodes. Shared development `co`/color conversion nodes may remain outside the production graph.
- Removed documentation/assets: the CalDAV page/navigation and the CalDAV/Fastmail setup GIFs and image. General Apple ICS documentation remains because ICS is still pending the Phase 3 decision.
- Automated gate: 16 suites passed; 183 tests passed, 2 todo; 44 snapshots passed. Compile, lint, production build, `git diff --check`, lock/package searches, and bundle marker searches pass.
- Same-toolchain bundle: `main.js` decreased from 2,645,628 to 2,360,993 bytes, a 284,635-byte reduction. `package-lock.json` decreased from 736,105 to 727,089 bytes. CSS is unchanged at 40,048 bytes.
- Manual matrix: not run in this headless worktree. No Obsidian application, vault, user plugin data, or network-backed calendar was opened. Calendar UI/navigation and two-restart checks remain coordinator/manual acceptance items.
- Rollback: reject/revert the single Phase 2 candidate commit and restore the user-controlled pre-migration plugin-data backup. Git alone cannot restore credentials after the activated scrub.
- Acceptance: coordinator integration and adversarial review both `ACCEPT`; the Phase 3 gate is open.
- Integrated result: commit `63c7b5f`; 16 suites passed, 183 tests passed, 2 todo, and 44 snapshots passed. Compile, lint, production build, `git diff --check`, lock-based dependency inventory, and removed-package/bundle searches passed. Integrated artifacts are `main.js` 2,350,334 bytes, `styles.css`/`main.css` 39,844 bytes, and `package-lock.json` 727,089 bytes. This is a 283,615-byte reduction from the accepted post-Phase-1 `main.js`.
- Adversarial result: `ACCEPT`, with no correctness finding. Residual acceptance is limited to the documented live-Obsidian restart, navigation, history, network-observation, and real-vault preservation checks.

## Phase 0 — Safety harness and non-destructive migration framework

Owner: migration/test agent

Risk: high leverage; no production feature deletion yet

Deliverables:

- Add a versioned, pure, idempotent settings decoder/migration framework and tests. Do not activate or persist credential scrubbing in a production build during this phase.
- Validate the root settings object before calling any default-calendar resolver: `calendarSources` may be missing, null, or non-array; members may be null, arrays, primitives, or malformed objects; `initialView` may be malformed.
- Separate persisted settings from supported runtime settings so malformed and currently unsupported source objects cannot reach `EventCache.init()`. Phase 0 must still initialize currently supported CalDAV and daily-note sources unchanged.
- Stop `safeParseCalendarInfo` from logging entire invalid objects.
- Add sanitized legacy-settings fixtures covering:
  - local-only;
  - ICS-only;
  - mixed local/ICS/CalDAV/daily-note;
  - CalDAV-only;
  - malformed roots, malformed members, and unknown source types;
  - old numeric and string `defaultCalendar` values;
  - nested `{ desktop, mobile }` initial-view state.
- Add test seams for view registration, command registration, and same-leaf navigation.
- Add characterization tests for current nth-weekday drag/resize behavior, then make nth-weekday occurrences explicitly non-draggable/non-resizable so they cannot collapse into single events.
- Add a note fixture where `date` and `start-recurrence` intentionally differ. Omission and drag/resize must update recurrence fields without normalizing the unrelated legacy `date` value.
- Record sanitized counts by source type only. Never record source values.
- Bucket types through a fixed allowlist (`local`, `ical`, `caldav`, `dailynote`, `unknown`); never log a raw user-controlled type string.
- Define a redacted legacy envelope containing only generated/enum metadata such as `{ legacyType: "caldav", removedAtVersion }`. Never copy a source-provided name/display label; it may itself contain an email address, username, URL, token, or password. Unknown and malformed source fields are discarded rather than copied.
- Give CalDAV fixtures four distinct synthetic sentinels for source name, URL, username, and password; assert all four are absent from migration output, logs, Notices, and snapshots.
- Resolve an old numeric `defaultCalendar` against the original validated source ordering before filtering deprecated entries, then convert it to the stable local source ID or deterministic fallback.
- Establish a repeatable performance baseline: fixed sanitized fixture set, production bundle, named start/end marks, warmup runs, at least 20 measured runs, and median/p95 for startup indexing and event opening. Record hardware/Obsidian version with the results.
- Record two product decisions in the handoff ledger before Phase 6: D1, one versus multiple writable local folders; D2, direct-child versus recursive folder semantics. Recommendation: one writable folder and explicit direct-child semantics, but never remove or quarantine an additional configured local source without user confirmation.

Migration policy:

- Phase 0 exercises migration as a pure function only. It must not rewrite `data.json`, remove a working source, or scrub credentials when the plugin reloads.
- Phase 2 activates the CalDAV-removal migration only after explicit acknowledgement that the user-controlled `data.json` backup exists.
- No legacy source object is ever quarantined unchanged. Only the allowlisted redacted envelope may be retained; URLs, usernames, passwords, and all unknown fields are discarded.
- Redacted quarantine remains until explicit user acceptance/removal rather than aging by restart count.
- Loading already-migrated settings after activation makes no write.
- No frontmatter migration is part of this program.

Gate:

- Every fixture loads without throwing.
- Pure migration output contains no synthetic sentinel credential and logging receives no raw source object.
- The selected local default remains stable when possible and falls back deterministically otherwise.
- A second migration produces byte-equivalent settings and requests no save.
- Phase 0’s production runtime leaves the original persisted source configuration unchanged.

## Phase 1 — Remove dead renderer connectors

Owner: connector agent

Risk: low

Changes:

- In `src/ui/calendar.ts`, remove:
  - `@fullcalendar/google-calendar` import and plugin registration;
  - `@fullcalendar/icalendar` import and plugin registration;
  - `googleCalendarApiKey` and the hardcoded `AIza...` key.
- Remove packages:
  - `@fullcalendar/google-calendar`;
  - `@fullcalendar/icalendar`;
  - unused `ical`;
  - unused `@types/ical`.
- Keep `ical.js`; `src/calendars/parsing/ics.ts` uses it directly.

Why this is safe: `CalendarView.translateSources()` already supplies materialized `events` arrays. Neither FullCalendar connector receives a Google ID or ICS URL.

Gate:

- All four views render local single and recurring events.
- Recurrence omissions still render correctly.
- `rg` finds no Google key, `googleCalendarApiKey`, or removed adapter import.
- Full test/build/lint gate passes.
- Expected `main.js` reduction: at least 11 KB.

Rollback trigger: any rendered-source difference or event-count change.

## Phase 2 — Remove CalDAV/iCloud and credentials

Owner: connector agent

Risk: high because saved settings can crash initialization

Delete:

- `src/calendars/CalDAVCalendar.ts`.
- `src/calendars/parsing/caldav/import.ts`.
- `src/calendars/parsing/caldav/transport.ts`.
- CalDAV/iCloud branches in `src/main.ts`, settings, source components, types, and tests.
- Authentication and `CalDAVSource` exports.
- CalDAV documentation and assets once code migration is accepted.

Remove packages:

- `dav`, `@types/dav`, and `@types/co`.
- `color` and `@types/color` after confirming no remaining import.

Required sequencing:

1. Land Phase 0 migration first.
2. Obtain explicit acknowledgement that a user-controlled `data.json` backup exists before deploying or reloading any build that activates the scrub.
3. Validate the settings root, resolve a numeric legacy default against the original validated ordering, then migrate/filter saved sources before `cache.reset()` or `EventCache.init()`.
4. Scrub credentials from active saved settings and retain at most the allowlisted redacted envelope.
5. Never include source objects in logs or errors.
6. Delete runtime and UI code only after legacy-settings boot tests pass.

Concrete code/package inventory includes `src/main.ts`, `src/ui/settings.ts`, `src/ui/components/AddCalendarSource.tsx`, `src/ui/components/CalendarSetting.tsx`, `src/types/calendar_settings.ts`, `src/types/index.ts`, `src/core/EventCache.test.ts`, `package.json`, and `package-lock.json`. Documentation cleanup includes `README.md`, `src/README.md`, `docs/calendars/caldav.md`, the CalDAV/Fastmail assets, and `mkdocs.yml`; deprecated Google-connector docs/assets belong to Phase 1 or Phase 9.

Gate:

- Old mixed and CalDAV-only settings boot without a network call or exception.
- Local default-calendar selection remains correct.
- Active saved output and the redacted envelope contain no source-provided CalDAV name, URL, username, or password.
- The UI exposes no CalDAV or iCloud option.
- Bundle contains no `dav`, `co`, or CalDAV-only color chain.
- Expected net `main.js` reduction from the accepted post-Phase-1 baseline: at least 250,000 decimal bytes, with absence of the removed packages confirmed in the esbuild metafile. Rebaseline if necessary rather than failing on a fragile absolute byte target.

Rollback trigger: startup crash, secret retained/leaked unexpectedly, changed local source selection, or any note write. Rollback requires both reverting the phase commit and restoring the user-controlled pre-migration `data.json`; Git alone cannot reverse a saved credential scrub.

## Phase 3 — Decide, then isolate and harden optional read-only ICS

Owner: remote-boundary agent

Risk: medium/high; remote URLs may be bearer secrets

Formal decision — 2026-08-22: `REMOVE_ICS`. The pinned Obsidian API exposes only fully materialized response bodies and accepts no abort signal, streaming control, timeout, or byte limit. The current `ical.js` parser is synchronous. Browser streaming would lose Obsidian's cross-origin request behavior, while a desktop Node transport would not cover the plugin's supported mobile runtime. A dual native transport plus worker parser is disproportionate to this lean fork, and no qualifying bounded design was demonstrated. The finished product is therefore local-only.

First run a technical spike and record one formal branch decision:

- `KEEP_ICS`: demonstrate a genuinely abortable, byte-bounded transport plus off-main-thread parsing or a parser with a strict pre-parse bound proven not to stall the main thread.
- `REMOVE_ICS`: if that proof is unavailable or disproportionate, delete ICS runtime/UI/packages and make the product local-only.

`obsidian.request()` currently returns a complete response without abort/streaming control, and `ical.js` parsing is synchronous. `Promise.race`, a post-response length check, or a post-parse event-count limit does not satisfy the hard timeout/stall gate.

If `KEEP_ICS`, retain:

- `src/calendars/ICSCalendar.ts`.
- `src/calendars/parsing/ics.ts`.
- `src/calendars/RemoteCalendar.ts` until Phase 8 narrows or replaces it.
- `ical.js`, Luxon, and required recurrence support.

Changes:

- Make local-only startup and rendering perform zero remote work and emit zero remote-revalidation logs.
- Remove revalidation from calendar mouse-enter.
- Refresh once after initial source population and through the explicit revalidate command.
- Scope concurrency and errors per ICS source rather than one global stuck flag. Audit `EventCache`, `Calendar`, and `CalendarView`, because they participate in refresh and source IDs.
- Replace URL-derived calendar IDs/names with opaque stable source IDs. Redact every payload/source debug log and remove `window.fc`/`window.cache` debug globals so URLs cannot leak indirectly.
- Enforce HTTPS or normalized `webcal` to HTTPS.
- Use the proven abortable transport and byte bound before parsing; enforce event-count/recurrence bounds as defense in depth after parsing.
- Fail a malformed or slow feed without blocking local rendering or other feeds.

Tests:

- Zero-source no-op and no-log behavior.
- Successful read-only feed load and refresh.
- Concurrent refresh deduplication and manual-force behavior.
- Network failure isolation.
- Malformed and oversized feed rejection.
- Duplicate UID/recurrence-ID handling.
- Google-generated ICS, DST, timezone, and omission fixtures.

Gate for `KEEP_ICS`:

- Local-only startup makes zero network requests.
- Hovering the calendar makes zero network requests.
- One failing ICS source does not block local events or another ICS source.
- No log contains a source URL or query token.
- No main-thread stall is observed on bounded fixtures.

Gate for `REMOVE_ICS`:

- Remove `ICSCalendar`, `RemoteCalendar` if unused, `ical.js` if unused, ICS settings/UI, all remote refresh paths, and all URL-derived identifiers.
- Local-only startup and rendering make zero network requests and contain no generic remote connector path.

The coordinator records `KEEP_ICS` or `REMOVE_ICS` before Phase 4 and updates the target contract, Phases 6 and 8 types/settings, package list, manual matrix, and final size target accordingly. Do not carry both designs forward speculatively.

## Phase 4 — Remove DailyNoteCalendar but keep daily-note links

Owner: local-feature agent

Risk: medium

Delete:

- `src/calendars/DailyNoteCalendar.ts` and its tests.
- The `dailynote` source initializer and source schema branch.
- Daily-note event-source controls in settings and React components.
- Inline-list event parsing, serialization, modification, and task-line behavior.

Retain:

- `CalendarView.getDailyNotePath` and `CalendarView.openDailyNote`.
- `dailyNotePath`, `openDailyNote`, and date-header link rendering.
- `obsidian-daily-notes-interface` and `moment` while those links depend on them.

Prune only adapter methods proven unused by full-note storage after deletion.

Migration behavior:

- Existing daily-note list items remain untouched on disk and simply stop appearing as events.
- If a removed daily-note source is configured, show a source-type-only migration Notice; do not include note paths or contents.
- Preserve only the allowlisted redacted envelope until explicit user acceptance/removal.

Gate:

- Date headers still open or create the correct daily note.
- No metadata listener parses inline daily-note event items.
- No daily note is edited during migration or startup.
- Full-note create/open/drag/resize/omit remains unchanged.
- Record the baseline daily-note-source event set, assert exactly that set disappears, and assert normalized full-note and retained-ICS event sets are unchanged.

Rollback trigger: daily-note navigation failure, any daily-note content mutation, unexpected full-note/retained-ICS event-set change, or a disappearance delta different from the recorded daily-note-source set.

## Phase 5 — Remove task UI and calendar event editor

Owner: local-feature agent

Risk: medium

Task cut:

- Delete `src/ui/tasks/index.ts`.
- Remove task callbacks, checkbox DOM, context actions, CSS, and only the task-specific FullCalendar extended properties `isTask` and `taskCompleted`.
- Preserve `categories`, `ofcRecurrence`, recurrence bounds, and skip-date metadata; `fromEventApi()` needs them to preserve recurrence during edits.
- Retain schema compatibility for `completed` during this program; ignore it in UI.
- Add preservation tests showing plugin-driven event changes do not remove unrelated `completed` YAML.

Context-menu cut:

- Retain “Omit this occurrence” for recurring local notes.
- Remove calendar-driven “Delete”; it deletes the entire event note and is too destructive for the lean surface.
- Ordinary event click remains the path to the note.
- Retained remote ICS events expose no editable action.
- Remove `@ladle/react` and story-only setup here if deleting `EditEvent.stories.tsx` leaves no remaining stories.

Editor cut:

- Delete `src/ui/event_modal.ts`, `src/ui/components/EditEvent.tsx`, its stories, and `launchEditModal` routing.
- Remove already-dead `launchCreateModal` code.
- Make click routing explicitly discriminate local full-note events from read-only ICS events.

Gate:

- Local click opens the normal buffer; remote click never enters editable-note code.
- Selection creates a full-note event.
- Drag, resize, and recurrence omission work for supported single/weekly events; nth-weekday recurrence is visibly non-draggable and remains editable through YAML/omission.
- Unrelated frontmatter and note body remain byte-equivalent.
- No calendar action can delete an entire note.
- Right-click exposes no Delete item, and no remaining command, callback, or calendar-UI path can invoke `FullNoteCalendar.deleteEvent`.

## Phase 6 — Replace React settings and remove React

Owner: native-settings agent

Risk: medium; largest bundle win

Do not design this phase until D1 is recorded and Phase 3 has recorded `KEEP_ICS` or `REMOVE_ICS`. Then replace source/settings UI using Obsidian `Setting` and `Modal` primitives for:

- The confirmed one-or-multiple local full-note folder model and colors.
- Optional read-only ICS URL/color only under `KEEP_ICS`.
- Default writable local calendar only if D1 retains multiple local sources.
- First day and desktop initial view.

Then delete:

- `src/ui/ReactModal.ts`.
- `src/ui/components/AddCalendarSource.tsx`.
- `src/ui/components/CalendarSetting.tsx`.
- Remaining TSX stories.
- Rewrite and retain `src/ui/onboard.ts` so it invokes the native source-add flow; it is useful but currently calls a React-backed helper.

Remove packages/config:

- `react`, `react-dom`, and their type packages.
- `@ladle/react` and story-only setup if they did not already leave in Phase 5.
- TypeScript JSX configuration after the last TSX file is gone.

Gate:

- Add/remove/recolor the confirmed local source model and, under `KEEP_ICS`, ICS sources; select a local default only when relevant; save, restart, and reload successfully.
- Invalid URLs/directories cannot be persisted through unsafe casts.
- No `.tsx`, React import, ReactDOM import, or React package remains.
- Expected net `main.js` reduction from the accepted pre-Phase-6 baseline: at least 800,000 decimal bytes, plus absence of React/ReactDOM/scheduler/object-assign in the metafile and runtime dependency tree. Rebaseline the final absolute target after replacement code is measured.

## Phase 7 — Make the surface desktop-only

Owner: view-surface agent

Risk: medium because workspace layouts persist view types

Remove:

- `FULL_CALENDAR_SIDEBAR_VIEW_TYPE` as an active feature.
- Open-sidebar command and secondary registration.
- `CalendarView.inSidebar`, `forceNarrow`, mobile toolbar branches, `timeGrid3Days`, and mobile initial-view setting.
- Sidebar/mobile-specific CSS and documentation.

Compatibility bridge:

- Register or detect the old sidebar view type and redirect/detach it safely during layout-ready. Retain that decoder until a persisted migration marker and explicit user acceptance permit removal, or until a separately stated version boundary.
- Keep `full-calendar-view` and `full-calendar-open` stable.
- Migrate nested initial-view settings explicitly rather than relying on shallow `Object.assign`.
- Set `manifest.json` to desktop-only only after the compatibility test passes.
- Before eventual shim removal, capture a user-controlled workspace-layout backup and test restore both with the bridge present and after removal. Reverting code does not undo a workspace layout already rewritten.

Gate:

- A saved workspace containing both old view types restores without an unknown/broken leaf.
- The open-calendar hotkey still works after two restarts.
- Calendar → event note → Back returns to the calendar.
- Grappling Hook alternate-file behavior for the event-note buffer remains normal.

## Phase 8 — Simplify EventCache/EventStore last

Owner: core-index agent

Risk: highest; do not combine with feature deletion

Do not begin until Phases 1–7 are accepted and the final source set is frozen to `local` under `REMOVE_ICS` or `local | ics` under `KEEP_ICS`.

Target model:

```ts
type LocalEventRecord = {
    kind: "local";
    id: string;
    path: string;
    sourceId: string;
    event: OFCEvent;
};

type RemoteEventRecord = { // KEEP_ICS only
    kind: "ics";
    id: string;
    sourceId: string;
    event: OFCEvent;
};
```

Use stable, namespaced IDs, a record map by ID, and a local path-to-ID map. Replace generic relationships and line-number indexing only after a shadow index proves equivalence.

Candidate deletions after shadow equivalence:

- `OneToMany` and daily-note line indexes.
- Generic source initializer maps.
- `EditableCalendar`/`RemoteCalendar` inheritance in favor of narrow local and ICS adapters.
- Cross-calendar move support if the product is reduced to one writable folder.
- Generic add/move wrappers that no longer have multiple editable source types.

Required shadow phase:

- Run old and new local indexes read-only over the same fixtures.
- Compare normalized `{ sourceId, path, event }` sets.
- Perform no writes from either index.
- Use path-based local IDs that are stable across reparses and namespaced ICS UIDs. A rename intentionally emits remove-old/add-new because the path changes.
- Exercise rename, delete, rapid modify, and failed write paths.

Decision gates before implementation:

- Confirm the D1/D2 decisions recorded before Phase 6. Current initial scan is direct-only while update matching is recursive; treat any newly visible nested event as a migration, not an incidental fix.

Gate:

- Shadow source-scoped `{ sourceId, path, event }` sets are identical for the chosen semantics; generated IDs are not compared across renames.
- No duplicates or count differences appear after restart, rename, or rapid file changes.
- Indexing never writes a note.
- A failed disk mutation cannot leave the in-memory index claiming success.
- p95 startup/index/open time does not regress by more than 20%.

Rollback trigger: any event-set mismatch, duplicate, note write during indexing, or cache/disk divergence.

## Phase 9 — Final convergence and documentation

Owner: cleanup/documentation agent

- Remove dead types, docs, screenshots, GIFs, CSS, commands, tests, and package entries.
- Rewrite `README.md`, `src/README.md`, settings docs, and event format docs around the lean product contract.
- Generate a final esbuild metafile and dependency inventory.
- Verify removed source names, packages, keys, credential fields, sidebar types, task UI, and React references are absent from active runtime source initialization, UI, and dependencies. Allowlist only the versioned legacy decoder/compatibility shim, fixtures, migration documentation, and changelog until their explicit removal gate.
- Keep a short migration/rollback note for users of this fork.

Final targets:

- Rebaselined `main.js` target at or below approximately 1.50 MB with `KEEP_ICS`, and lower under `REMOVE_ICS`; record decimal bytes and the esbuild metafile rather than treating the planning estimate as a correctness assertion.
- Zero network activity and zero remote logs for local-only configuration.
- No stored CalDAV credentials after accepted migration.
- No React runtime, CalDAV stack, dead FullCalendar connector, daily-note event parser, task UI, sidebar view, or synthetic editor code.
- Full test/build/lint gate and manual acceptance matrix pass twice across Obsidian restarts.

## Mandatory automated gate for every phase

```sh
npm test -- --runInBand
npm run compile
npm run lint
npm run build
git diff --check
```

Also record (include `main.css` only if it exists):

```sh
wc -c main.js styles.css package-lock.json
test ! -f main.css || wc -c main.css
npm ls --omit=dev --depth=0
```

Phase-specific searches must prove removed keys, packages, classes, view types, and imports are absent. Searches must never print secret-bearing settings values.

## Manual acceptance matrix

Run after every user-visible phase:

1. Open the calendar with the existing command/hotkey.
2. Cycle Month → Week → Day → List with Tab and backward with Shift-Tab.
3. Press `T` and verify Today.
4. Verify Day title is long form and Week title is `Week NN`.
5. Open an event note; verify a normal Markdown buffer replaces the calendar leaf.
6. Verify Escape does not navigate away and the command palette works normally.
7. Verify Back returns to the calendar and Forward returns to the event note.
8. Verify Grappling Hook can select the event note as an alternate file.
9. Create an event by selection and by command.
10. Drag and resize single, overnight, and weekly events; verify nth-weekday occurrences are non-draggable rather than converted to single events.
11. Omit one recurring occurrence and verify YAML plus rendered result.
12. Verify unrelated YAML and note body remain unchanged.
13. Open/create a daily note from a date header.
14. Restart Obsidian twice and repeat open/back/hotkey checks.
15. From Phase 3 onward and only under `KEEP_ICS`, test one valid, one failing, and one slow/malformed feed without exposing its URL.

## Global adversarial stop and rollback rules

Reject and revert the current phase immediately if any of these occurs:

- Old settings cannot boot.
- A full-note/retained-ICS event’s path, title, date, time, recurrence, or source-scoped normalized set differs unexpectedly. Phase 4’s exactly measured daily-note-source disappearance is the sole planned count delta.
- A migration or index writes an event note or daily note.
- Unrelated frontmatter/body content changes.
- Back/Forward, `full-calendar-open`, command palette, Escape, or same-leaf behavior regresses.
- A secret or full remote URL reaches logs, fixtures, Notices, or commits.
- The console shows an unhandled error.
- Local-only mode performs a network request.
- p95 startup/index/event-open time regresses by more than 20%.
- The bundle fails to shrink commensurately with a dependency-removal phase.

Code rollback is by reverting the single accepted phase commit. For any phase that mutates persisted settings or workspace layout, also restore the relevant user-controlled pre-migration backup; Git alone cannot reverse those writes. Retain backups and redacted quarantine until the user explicitly accepts/removes them.

## Handoff start point

The next implementation turn starts with Phase 0 and Phase 1 only:

- Spawn a migration/test agent for Phase 0 fixtures, pure migration behavior, settings-root validation, decisions, and performance baselines. The production path remains non-destructive.
- Spawn a connector implementation agent for Phase 1 in a separate worktree.
- Spawn an adversarial reviewer after both commits are ready.
- Integrate Phase 0 first, then Phase 1.
- Stop and report metrics before beginning CalDAV removal.

Do not begin or deploy Phase 2 merely because Phase 1 compiles. Phase 2 requires explicit acknowledgement that the settings backup exists and the migration gate is accepted; credential scrubbing is activated only then.
