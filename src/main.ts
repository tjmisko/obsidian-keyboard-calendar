import { Command, Notice, Plugin, TFile, WorkspaceLeaf } from "obsidian";
import {
    CalendarView,
    FULL_CALENDAR_SIDEBAR_VIEW_TYPE,
    FULL_CALENDAR_VIEW_TYPE,
} from "./ui/view";
import { renderCalendar } from "./ui/calendar";
import { dateEndpointsToFrontmatter, toEventInput } from "./ui/interop";
import {
    DEFAULT_SETTINGS,
    FullCalendarSettings,
    FullCalendarSettingTab,
} from "./ui/settings";
import {
    OFCEvent,
    parseEvent,
    PLUGIN_SLUG,
    resolveDefaultFullNoteCalendar,
} from "./types";
import EventCache from "./core/EventCache";
import { ObsidianIO } from "./ObsidianAdapter";
import FullNoteCalendar from "./calendars/FullNoteCalendar";
import DailyNoteCalendar from "./calendars/DailyNoteCalendar";
import ICSCalendar from "./calendars/ICSCalendar";
import CalDAVCalendar from "./calendars/CalDAVCalendar";
import EventNoteEditor from "./ui/EventNoteEditor";
import {
    captureRuntimeSettingsBaseline,
    decodeSettings,
    prepareSettingsSave,
} from "./settings/migration";
import {
    registerCalendarCommands,
    registerCalendarViews,
} from "./plugin_registration";

export default class FullCalendarPlugin extends Plugin {
    settings: FullCalendarSettings = DEFAULT_SETTINGS;
    private persistedSettings: unknown = {};
    private runtimeSettingsBaseline: FullCalendarSettings =
        captureRuntimeSettingsBaseline(DEFAULT_SETTINGS);
    cache: EventCache = new EventCache({
        local: (info) =>
            info.type === "local"
                ? new FullNoteCalendar(
                      new ObsidianIO(this.app),
                      info.color,
                      info.directory
                  )
                : null,
        dailynote: (info) =>
            info.type === "dailynote"
                ? new DailyNoteCalendar(
                      new ObsidianIO(this.app),
                      info.color,
                      info.heading
                  )
                : null,
        ical: (info) =>
            info.type === "ical" ? new ICSCalendar(info.color, info.url) : null,
        caldav: (info) =>
            info.type === "caldav"
                ? new CalDAVCalendar(
                      info.color,
                      info.name,
                      {
                          type: "basic",
                          username: info.username,
                          password: info.password,
                      },
                      info.url,
                      info.homeUrl
                  )
                : null,
        FOR_TEST_ONLY: () => null,
    });

    renderCalendar = renderCalendar;
    processFrontmatter = toEventInput;
    eventNoteEditor: EventNoteEditor | null = null;

    private getDefaultFullNoteCalendar(): FullNoteCalendar | null {
        const configuredId = resolveDefaultFullNoteCalendar(
            this.settings.defaultCalendar,
            this.settings.calendarSources
        );
        const configured = configuredId
            ? this.cache.getCalendarById(configuredId)
            : null;
        if (configured instanceof FullNoteCalendar) {
            return configured;
        }
        return (
            ([...this.cache.calendars.values()].find(
                (calendar) => calendar instanceof FullNoteCalendar
            ) as FullNoteCalendar | undefined) || null
        );
    }

    async createTimedEventNote(
        partialEvent: Partial<OFCEvent>,
        targetLeaf?: WorkspaceLeaf
    ): Promise<TFile | null> {
        const calendar = this.getDefaultFullNoteCalendar();
        if (!calendar) {
            new Notice(
                "Add a full-note calendar before creating an event note."
            );
            return null;
        }
        const event = parseEvent({
            ...partialEvent,
            title: "Untitled event",
            type: "single",
            allDay: false,
        });
        const location = await this.cache.createEvent(calendar.id, event);
        const file = this.app.vault.getAbstractFileByPath(location.file.path);
        if (!(file instanceof TFile)) {
            throw new Error(
                `Created event note was not found at ${location.file.path}.`
            );
        }
        await this.eventNoteEditor?.open(file, targetLeaf);
        return file;
    }

    async openEventNote(
        eventId: string,
        targetLeaf?: WorkspaceLeaf
    ): Promise<boolean> {
        const { calendar, location } =
            this.cache.getInfoForEditableEvent(eventId);
        if (
            !(calendar instanceof FullNoteCalendar) ||
            location.lineNumber !== undefined
        ) {
            return false;
        }
        const file = this.app.vault.getAbstractFileByPath(location.path);
        if (!(file instanceof TFile)) {
            throw new Error(`Event note was not found at ${location.path}.`);
        }
        await this.eventNoteEditor?.open(file, targetLeaf);
        return true;
    }

    async activateView() {
        const leaves = this.app.workspace
            .getLeavesOfType(FULL_CALENDAR_VIEW_TYPE)
            .filter((l) => (l.view as CalendarView).inSidebar === false);
        let leaf: WorkspaceLeaf;
        if (leaves.length === 0) {
            leaf = this.app.workspace.getLeaf("tab");
            await leaf.setViewState({
                type: FULL_CALENDAR_VIEW_TYPE,
                active: true,
            });
        } else {
            leaf = leaves[0];
            this.app.workspace.revealLeaf(leaf);
            await (leaf.view as CalendarView).onOpen();
        }
        this.app.workspace.revealLeaf(leaf);
    }
    async onload() {
        await this.loadSettings();

        this.eventNoteEditor = new EventNoteEditor(this.app);

        this.cache.reset(this.settings.calendarSources);

        this.registerEvent(
            this.app.metadataCache.on("changed", (file) => {
                this.cache.fileUpdated(file);
            })
        );

        this.registerEvent(
            this.app.vault.on("rename", async (file, oldPath) => {
                if (file instanceof TFile) {
                    console.debug("FILE RENAMED", file.path);
                    this.cache.calendars.forEach((calendar) => {
                        if (calendar instanceof FullNoteCalendar) {
                            calendar.fileRenamed(oldPath, file.path);
                        }
                    });
                    this.cache.deleteEventsAtPath(oldPath);
                    await this.cache.fileUpdated(file);
                }
            })
        );

        this.registerEvent(
            this.app.vault.on("delete", (file) => {
                if (file instanceof TFile) {
                    console.debug("FILE DELETED", file.path);
                    this.cache.deleteEventsAtPath(file.path);
                }
            })
        );

        // @ts-ignore
        window.cache = this.cache;

        registerCalendarViews<WorkspaceLeaf, CalendarView>(
            (type, creator) => this.registerView(type, creator),
            (leaf, inSidebar) => new CalendarView(leaf, this, inSidebar)
        );

        this.addRibbonIcon(
            "calendar-glyph",
            "Open Full Calendar",
            async (_: MouseEvent) => {
                await this.activateView();
            }
        );

        this.addSettingTab(new FullCalendarSettingTab(this.app, this));

        registerCalendarCommands<Command>(
            (command) => this.addCommand(command),
            ({ id, name }) => ({
                id,
                name,
                callback: () => {
                    switch (id) {
                        case "full-calendar-new-event": {
                            const start = new Date();
                            start.setMinutes(0, 0, 0);
                            const end = new Date(
                                start.getTime() + 60 * 60 * 1000
                            );
                            void this.createTimedEventNote(
                                dateEndpointsToFrontmatter(start, end, false)
                            );
                            return;
                        }
                        case "full-calendar-reset":
                            this.cache.reset(this.settings.calendarSources);
                            this.app.workspace.detachLeavesOfType(
                                FULL_CALENDAR_VIEW_TYPE
                            );
                            this.app.workspace.detachLeavesOfType(
                                FULL_CALENDAR_SIDEBAR_VIEW_TYPE
                            );
                            new Notice("Full Calendar has been reset.");
                            return;
                        case "full-calendar-revalidate":
                            this.cache.revalidateRemoteCalendars(true);
                            return;
                        case "full-calendar-open":
                            void this.activateView();
                            return;
                        case "full-calendar-open-sidebar":
                            if (
                                this.app.workspace.getLeavesOfType(
                                    FULL_CALENDAR_SIDEBAR_VIEW_TYPE
                                ).length
                            ) {
                                return;
                            }
                            void this.app.workspace
                                .getRightLeaf(false)
                                .setViewState({
                                    type: FULL_CALENDAR_SIDEBAR_VIEW_TYPE,
                                });
                            return;
                    }
                },
            })
        );

        (this.app.workspace as any).registerHoverLinkSource(PLUGIN_SLUG, {
            display: "Full Calendar",
            defaultMod: true,
        });
    }

    onunload() {
        this.eventNoteEditor = null;
        this.app.workspace.detachLeavesOfType(FULL_CALENDAR_VIEW_TYPE);
        this.app.workspace.detachLeavesOfType(FULL_CALENDAR_SIDEBAR_VIEW_TYPE);
    }

    async loadSettings() {
        const loaded = await this.loadData();
        // Phase 0 is intentionally read-only: decode a safe runtime view but
        // leave the persisted source configuration byte-for-byte untouched.
        this.settings = decodeSettings(loaded).settings;
        this.persistedSettings = loaded;
        this.runtimeSettingsBaseline = captureRuntimeSettingsBaseline(
            this.settings
        );
    }

    async saveSettings() {
        new Notice("Resetting the event cache with new settings...");
        const prepared = prepareSettingsSave(
            this.persistedSettings,
            this.runtimeSettingsBaseline,
            this.settings
        );
        if (prepared.changed) {
            await this.saveData(prepared.persisted);
            this.persistedSettings = prepared.persisted;
        }
        this.runtimeSettingsBaseline = prepared.runtimeBaseline;
        this.cache.reset(this.settings.calendarSources);
        await this.cache.populate();
        this.cache.resync();
    }
}
