# Phase 0 safety and performance baseline

Captured: 2026-08-22

This baseline is intentionally sanitized and repeatable. It reads no Obsidian vault and contains no user settings, paths, URLs, usernames, passwords, tokens, or note contents.

## Reproduction

Run:

```sh
npm run benchmark:phase0
```

The command first creates the production bundle, then runs the benchmark with five warmup iterations and 25 measured iterations. The harness uses named `performance` marks:

- `phase0-startup-index:start` / `phase0-startup-index:end`
- `phase0-event-open:start` / `phase0-event-open:end`

The fixed fixture contains 250 generated single events split evenly between all-day and timed events. Startup/index constructs and populates `EventCache` through an in-memory read-only calendar adapter. Event-open invokes `EventNoteEditor.open` against an ordinary mocked originating leaf. Each sample verifies the expected event count or open call as part of the test.

## Captured result

| Operation | Median | p95 |
| --- | ---: | ---: |
| Startup/index | 0.376 ms | 0.762 ms |
| Event open | 0.0077 ms | 0.0197 ms |

Environment:

- Apple M1 Pro, 8 CPU cores, 16 GiB RAM, aarch64
- Fedora Asahi Linux kernel `7.1.6-400.asahi.fc44.aarch64+16k`
- Node.js `v22.23.1`; npm `11.4.1`
- Plugin `0.10.7`; manifest minimum Obsidian version `0.16.3`
- Production bundle: `main.js` 2,658,035 bytes; `styles.css` 40,048 bytes

## Interpretation and unavailable measurements

The numbers characterize deterministic code seams and can detect gross regressions when the same command and fixture are reused. They do not include real vault enumeration, disk I/O, Electron rendering, FullCalendar rendering, plugin-to-plugin interaction, or Obsidian history behavior.

No Obsidian GUI was available in this worktree, so the installed Obsidian version and real-vault startup/index/event-open timings are unavailable rather than estimated. The manual navigation, restart, data-preservation, and performance acceptance matrices remain required before release. Future acceptance compares the same harness and records real Obsidian measurements separately; the two datasets must not be conflated.
