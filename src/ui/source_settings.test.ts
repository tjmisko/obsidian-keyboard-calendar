import { MockAppBuilder } from "../../test_helpers/AppBuilder";
import { FileBuilder } from "../../test_helpers/FileBuilder";
import {
    DEFAULT_SETTINGS,
    FullCalendarSettings,
    migrateSettings,
} from "../settings/migration";
import {
    getConfiguredLocalSource,
    listEventFolders,
    preferredEventFolder,
    removeLocalSource,
    saveLocalSourceSelection,
    SettingsWriter,
    validateLocalSourceSelection,
} from "./source_settings";

const makeApp = () =>
    MockAppBuilder.make()
        .file("not-a-folder.md", new FileBuilder())
        .folder(new MockAppBuilder("work"))
        .folder(new MockAppBuilder("events"))
        .done();

const settings = (): FullCalendarSettings => ({
    ...DEFAULT_SETTINGS,
    initialView: { desktop: "dayGridMonth", mobile: "listWeek" },
    firstDay: 1,
    timeFormat24h: true,
});

const localRoot = {
    type: "local" as const,
    directory: "",
    color: "#123456",
};

const writer = (initial = settings()) => {
    const result: SettingsWriter & {
        updateSettings: jest.Mock<Promise<void>, [FullCalendarSettings]>;
    } = {
        settings: initial,
        updateSettings: jest.fn(async (next) => {
            result.settings = next;
        }),
    };
    return result;
};

describe("native single-folder settings model", () => {
    it("lists only real non-root folders and prefers events", () => {
        const app = makeApp();

        expect(listEventFolders(app.vault)).toEqual(["events", "work"]);
        expect(preferredEventFolder(app.vault)).toBe("events");
        expect(preferredEventFolder(app.vault, "work")).toBe("work");
    });

    it("rejects arbitrary paths, files, root, aliases, and invalid colors", () => {
        const app = makeApp();

        expect(
            validateLocalSourceSelection(app.vault, "missing", "#123456")
        ).toBeNull();
        expect(
            validateLocalSourceSelection(
                app.vault,
                "not-a-folder.md",
                "#123456"
            )
        ).toBeNull();
        expect(
            validateLocalSourceSelection(app.vault, "/", "#123456")
        ).toBeNull();
        expect(
            validateLocalSourceSelection(app.vault, "events/../work", "#123456")
        ).toBeNull();
        expect(
            validateLocalSourceSelection(app.vault, "events", "red")
        ).toBeNull();
    });

    it("can display a retained legacy root source without accepting it as a new choice", () => {
        const app = makeApp();
        const legacy = settings();
        legacy.calendarSources = [localRoot];

        expect(getConfiguredLocalSource(legacy)).toEqual(localRoot);
        expect(
            validateLocalSourceSelection(app.vault, "/", localRoot.color)
        ).toBeNull();
    });

    it("adds, changes, recolors, and removes exactly one source", async () => {
        const app = makeApp();
        const target = writer();

        await expect(
            saveLocalSourceSelection(target, app.vault, "events", "#AABBCC")
        ).resolves.toEqual({
            type: "local",
            directory: "events",
            color: "#aabbcc",
        });
        expect(getConfiguredLocalSource(target.settings)).toEqual({
            type: "local",
            directory: "events",
            color: "#aabbcc",
        });

        await saveLocalSourceSelection(target, app.vault, "work", "#112233");
        await saveLocalSourceSelection(target, app.vault, "work", "#445566");
        expect(target.settings.calendarSources).toEqual([
            { type: "local", directory: "work", color: "#445566" },
        ]);
        expect(target.settings.initialView).toEqual({
            desktop: "dayGridMonth",
            mobile: "listWeek",
        });
        expect(target.settings.firstDay).toBe(1);
        expect(target.settings.timeFormat24h).toBe(true);

        await removeLocalSource(target);
        expect(target.settings.calendarSources).toEqual([]);
        expect(target.updateSettings).toHaveBeenCalledTimes(4);
    });

    it("does not save or mutate for an invalid selection", async () => {
        const app = makeApp();
        const target = writer();
        const original = JSON.stringify(target.settings);

        await expect(
            saveLocalSourceSelection(target, app.vault, "missing", "#123456")
        ).resolves.toBeNull();
        expect(target.updateSettings).not.toHaveBeenCalled();
        expect(JSON.stringify(target.settings)).toBe(original);
    });

    it("does not mutate live settings when persistence rejects", async () => {
        const app = makeApp();
        const target = writer();
        const original = JSON.stringify(target.settings);
        target.updateSettings.mockRejectedValue(new Error("save rejected"));

        await expect(
            saveLocalSourceSelection(target, app.vault, "events", "#123456")
        ).rejects.toThrow("save rejected");
        expect(JSON.stringify(target.settings)).toBe(original);

        target.settings = {
            ...target.settings,
            calendarSources: [
                { type: "local", directory: "events", color: "#123456" },
            ],
        };
        const configured = JSON.stringify(target.settings);
        await expect(removeLocalSource(target)).rejects.toThrow(
            "save rejected"
        );
        expect(JSON.stringify(target.settings)).toBe(configured);
    });

    it("reloads a saved source and preferences idempotently", async () => {
        const app = makeApp();
        const target = writer();
        await saveLocalSourceSelection(target, app.vault, "events", "#123456");

        const firstLoad = migrateSettings(target.settings, jest.fn());
        const restart = migrateSettings(firstLoad.settings, jest.fn());

        expect(firstLoad.settings.calendarSources).toEqual([
            { type: "local", directory: "events", color: "#123456" },
        ]);
        expect(firstLoad.settings.initialView).toEqual({
            desktop: "dayGridMonth",
            mobile: "listWeek",
        });
        expect(restart.settings).toEqual(firstLoad.settings);
        expect(restart.saveRequested).toBe(false);
    });
});
