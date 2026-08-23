import { Command, Notice, Plugin, TFile, WorkspaceLeaf } from "obsidian";
import { CalendarView, FULL_CALENDAR_VIEW_TYPE } from "./ui/view";
import { renderCalendar } from "./ui/calendar";
import { dateEndpointsToFrontmatter, toEventInput } from "./ui/interop";
import {
    DEFAULT_SETTINGS,
    FullCalendarSettings,
    FullCalendarSettingTab,
} from "./ui/settings";
import { OFCEvent, parseEvent, PLUGIN_SLUG } from "./types";
import EventCache from "./core/EventCache";
import { ObsidianIO } from "./ObsidianAdapter";
import FullNoteCalendar from "./calendars/FullNoteCalendar";
import EventNoteEditor from "./ui/EventNoteEditor";
import {
    capturePersistedSettings,
    captureRuntimeSettingsBaseline,
    commitSettingsBeforeRuntime,
    loadMigratedSettingsBeforeRuntime,
} from "./settings/migration";
import {
    registerCalendarCommands,
    registerCalendarViews,
    reportEventNoteCreationFailure,
} from "./plugin_registration";
import {
    LEGACY_FULL_CALENDAR_SIDEBAR_VIEW_TYPE,
    createLegacySidebarMigrationRunner,
    registerLegacySidebarCompatibilityView,
} from "./legacy_sidebar_bridge";
import { LegacySidebarCompatibilityView } from "./ui/LegacySidebarCompatibilityView";

export default class FullCalendarPlugin extends Plugin {
    settings: FullCalendarSettings = DEFAULT_SETTINGS;
    private persistedSettings: unknown = {};
    private runtimeSettingsBaseline: FullCalendarSettings =
        captureRuntimeSettingsBaseline(DEFAULT_SETTINGS);
    private settingsLoaded = false;
    private requestLegacySidebarMigration: () => Promise<void> = () =>
        Promise.resolve();
    cache: EventCache = new EventCache(
        (info) =>
            new FullNoteCalendar(
                new ObsidianIO(this.app),
                info.color,
                info.directory
            )
    );

    renderCalendar = renderCalendar;
    processFrontmatter = toEventInput;
    eventNoteEditor: EventNoteEditor | null = null;

    async createTimedEventNote(
        partialEvent: Partial<OFCEvent>,
        targetLeaf?: WorkspaceLeaf
    ): Promise<TFile | null> {
        if (!this.cache.hasLocalCalendar()) {
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
        const location = await this.cache.createEvent(event);
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
        const details = this.cache.getInfoForFullNoteEvent(eventId);
        if (!details) {
            return false;
        }
        const { location } = details;
        const file = this.app.vault.getAbstractFileByPath(location.path);
        if (!(file instanceof TFile)) {
            throw new Error(`Event note was not found at ${location.path}.`);
        }
        await this.eventNoteEditor?.open(file, targetLeaf);
        return true;
    }

    async activateView() {
        const leaves = this.app.workspace.getLeavesOfType(
            FULL_CALENDAR_VIEW_TYPE
        );
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

    private configureLegacySidebarMigration(): void {
        this.requestLegacySidebarMigration = createLegacySidebarMigrationRunner(
            () => this.settingsLoaded && this.app.workspace.layoutReady,
            () => this.settings.legacySidebarMigrationVersion || 0,
            {
                getPrimaryLeaves: () =>
                    this.app.workspace.getLeavesOfType(FULL_CALENDAR_VIEW_TYPE),
                getLegacyLeaves: () =>
                    this.app.workspace.getLeavesOfType(
                        LEGACY_FULL_CALENDAR_SIDEBAR_VIEW_TYPE
                    ),
                createPrimaryLeaf: async () => {
                    const leaf = this.app.workspace.getLeaf("tab");
                    await leaf.setViewState({
                        type: FULL_CALENDAR_VIEW_TYPE,
                        active: true,
                    });
                    return leaf;
                },
                revealPrimaryLeaf: (leaf) =>
                    this.app.workspace.revealLeaf(leaf),
                detachLegacyLeaf: (leaf) => leaf.detach(),
                requestSaveLayout: async () => {
                    await this.app.workspace.requestSaveLayout();
                },
                persistMigrationVersion: async (version) => {
                    await this.persistLegacySidebarMigrationVersion(version);
                },
            },
            console.error,
            (message) => new Notice(message)
        );
    }

    async onload() {
        this.configureLegacySidebarMigration();
        // Register both the active view and the decoder-only legacy view before
        // the first await so restored workspaces never encounter an unknown
        // persisted view type.
        registerCalendarViews<WorkspaceLeaf, CalendarView>(
            (type, creator) => this.registerView(type, creator),
            (leaf) => new CalendarView(leaf, this)
        );
        registerLegacySidebarCompatibilityView<
            WorkspaceLeaf,
            LegacySidebarCompatibilityView
        >(
            (type, creator) => this.registerView(type, creator),
            (leaf) =>
                new LegacySidebarCompatibilityView(leaf, () => {
                    void this.requestLegacySidebarMigration();
                })
        );

        await this.loadSettings((settings) =>
            this.cache.reset(settings.calendarSources)
        );
        this.settingsLoaded = true;
        this.app.workspace.onLayoutReady(() => {
            void this.requestLegacySidebarMigration();
        });

        this.eventNoteEditor = new EventNoteEditor(this.app);

        this.registerEvent(
            this.app.metadataCache.on("changed", (file) => {
                void this.cache
                    .fileUpdated(file)
                    .catch((error) =>
                        console.error(
                            "Could not refresh changed event note",
                            error
                        )
                    );
            })
        );

        this.registerEvent(
            this.app.vault.on("rename", (file, oldPath) => {
                if (file instanceof TFile) {
                    console.debug("FILE RENAMED", file.path);
                    void this.cache
                        .fileRenamed(file, oldPath)
                        .catch((error) =>
                            console.error(
                                "Could not refresh renamed event note",
                                error
                            )
                        );
                }
            })
        );

        this.registerEvent(
            this.app.vault.on("delete", (file) => {
                if (file instanceof TFile) {
                    console.debug("FILE DELETED", file.path);
                    this.cache.fileDeleted(file.path);
                }
            })
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
                            ).catch(reportEventNoteCreationFailure);
                            return;
                        }
                        case "full-calendar-reset":
                            this.cache.reset(this.settings.calendarSources);
                            this.app.workspace.detachLeavesOfType(
                                FULL_CALENDAR_VIEW_TYPE
                            );
                            new Notice("Full Calendar has been reset.");
                            return;
                        case "full-calendar-open":
                            void this.activateView();
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
    }

    async loadSettings(
        initializeRuntime?: (settings: FullCalendarSettings) => void
    ) {
        await loadMigratedSettingsBeforeRuntime(
            () => this.loadData(),
            (settings) => this.saveData(settings),
            (settings) => {
                this.settings = settings;
                this.persistedSettings = capturePersistedSettings(settings);
                this.runtimeSettingsBaseline = captureRuntimeSettingsBaseline(
                    this.settings
                );
                initializeRuntime?.(this.settings);
            },
            console.debug,
            (message: string) => new Notice(message)
        );
    }

    private async persistLegacySidebarMigrationVersion(version: number) {
        await commitSettingsBeforeRuntime(
            this.persistedSettings,
            this.runtimeSettingsBaseline,
            {
                ...this.settings,
                legacySidebarMigrationVersion: version,
            },
            (persisted) => this.saveData(persisted),
            (settings, persisted, baseline) => {
                this.settings = settings;
                this.persistedSettings = persisted;
                this.runtimeSettingsBaseline = baseline;
            },
            () => undefined
        );
    }

    async updateSettings(nextSettings: FullCalendarSettings) {
        await commitSettingsBeforeRuntime(
            this.persistedSettings,
            this.runtimeSettingsBaseline,
            nextSettings,
            (persisted) => this.saveData(persisted),
            (settings, persisted, baseline) => {
                // Commit runtime state only after persistence succeeds. If
                // refresh later fails, memory and disk remain aligned.
                this.settings = settings;
                this.persistedSettings = persisted;
                this.runtimeSettingsBaseline = baseline;
            },
            async (settings) => {
                this.cache.reset(settings.calendarSources);
                await this.cache.populate();
                this.cache.resync();
            },
            console.error,
            (message) => new Notice(message)
        );
    }
}
