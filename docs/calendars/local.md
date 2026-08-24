# Local calendar with full notes as events

Keep each event as a separate Markdown note in one configured vault folder. This is the only event source in the lean fork. The setup flow prefers an existing `events` folder.

Only Markdown files directly inside the configured folder are eligible; the `.md` extension match is case-insensitive. Nested notes and non-Markdown files are never indexed. A note appears only when its frontmatter matches the [event format](../events/types.md); the `event` tag opts a note into the strict note-first format.

You may add unrelated frontmatter and any Markdown content, such as descriptions, links, or meeting notes. Supported calendar edits preserve that content.

New timed event notes start with an `Untitled event` filename and open as ordinary Markdown buffers so you can name and edit them normally. Keyboard Calendar never offers a calendar action that deletes the backing note.

Changing or removing the configured folder affects settings only. It never moves, rewrites, or deletes existing notes. Notes outside the selected folder remain on disk but are not displayed.
