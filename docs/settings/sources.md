# Manage sources

Full Calendar uses one writable vault folder for full-note events. In settings, choose an existing folder and an event color. The native folder picker prefers `events` when that folder exists and validates the folder again before saving.

Only direct-child Markdown files are indexed, with a case-insensitive `.md` extension match. Nested notes and non-Markdown files remain untouched and invisible to the calendar. You can later change the folder or color, or remove the folder configuration. Removing or changing the configuration changes settings only; it never moves, rewrites, or deletes notes.

When settings migration v5 finds several older local sources, it keeps the previously selected default local folder when possible and otherwise keeps the first valid folder. The discarded configuration is represented only by a redacted version marker; event-note files are untouched.

Daily-note event sources, URL sources, and credential-bearing sources are not available. Daily-note date-header navigation is configured by Obsidian's daily-note settings, not as a calendar source.

An older empty-directory configuration may appear as **Vault root (legacy)**. It remains readable for compatibility, but editing it requires selecting an existing non-root folder.
