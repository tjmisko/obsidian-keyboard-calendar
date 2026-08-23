# Full Calendar Plugin

![Obsidian Downloads](https://img.shields.io/badge/dynamic/json?logo=obsidian&color=%23483699&label=downloads&query=%24%5B%22obsidian-full-calendar%22%5D.downloads&url=https%3A%2F%2Fraw.githubusercontent.com%2Fobsidianmd%2Fobsidian-releases%2Fmaster%2Fcommunity-plugin-stats.json)

Keep your calendar in your vault! This plugin integrates the [FullCalendar](https://github.com/fullcalendar/fullcalendar) library into your Obsidian Vault so that you can keep your ever-changing daily schedule and special events and plans alongside your tasks and notes, and link freely between all of them. Each event is stored as a separate note with special frontmatter so you can take notes, form connections and add context to any event on your calendar.

This lean fork reads events only from the local Obsidian vault: from frontmatter on full event notes or from event lists in daily notes. It performs no calendar network requests.

Remote ICS and CalDAV sources are no longer supported. On first load, settings migration v3 removes those saved source objects and retains only redacted type/version markers. Rollback requires the pre-migration Obsidian backup and a plugin version from before the source removal.

You can find the full documentation [here](https://obsidian-community.github.io/obsidian-full-calendar/)!

![Sample Calendar](https://raw.githubusercontent.com/obsidian-community/obsidian-full-calendar/main/docs/assets/sample-calendar.png)

The FullCalendar library is released under the [MIT license](https://github.com/fullcalendar/fullcalendar/blob/master/LICENSE.txt) by [Adam Shaw](https://github.com/arshaw). It's an awesome piece of work, and it would not have been possible to make something like this plugin so easily without it.

[![Support me on Ko-Fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/M4M1GQ84A)

## Installation

Full Calendar is available from the Obsidian Community Plugins list -- just search for "Full Calendar" paste this link into your browser: `obsidian://show-plugin?id=obsidian-full-calendar`.

### Manual Installation

You can also head over to the [releases page](https://github.com/obsidian-community/obsidian-full-calendar/releases) and unzip the latest release inside of the `.obsidian/plugins` directory inside your vault.
