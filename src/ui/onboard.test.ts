jest.mock("obsidian");
jest.mock("./settings", () => ({
    LocalCalendarSourceModal: class LocalCalendarSourceModal {},
}));

import { Notice } from "obsidian";
import { MockAppBuilder } from "../../test_helpers/AppBuilder";
import { DEFAULT_SETTINGS, FullCalendarSettings } from "../settings/migration";
import { completeOnboarding } from "./onboard";

const makeApp = () =>
    MockAppBuilder.make().folder(new MockAppBuilder("events")).done();

describe("native onboarding", () => {
    beforeEach(() => {
        (Notice as any).notices = [];
    });

    it("persists the selected real folder before activating the view", async () => {
        const app = makeApp();
        const order: string[] = [];
        const plugin = {
            settings: {
                ...DEFAULT_SETTINGS,
                initialView: { ...DEFAULT_SETTINGS.initialView },
            },
            updateSettings: jest.fn(async function (
                this: { settings: FullCalendarSettings },
                next: FullCalendarSettings
            ) {
                order.push("persist");
                this.settings = next;
            }),
            activateView: jest.fn(async () => {
                order.push("activate");
            }),
        };

        const source = await completeOnboarding(
            app,
            plugin as any,
            "events",
            "#123456"
        );

        expect(source).toEqual({
            type: "local",
            directory: "events",
            color: "#123456",
        });
        expect(order).toEqual(["persist", "activate"]);
        expect(plugin.settings.calendarSources).toEqual([source]);
    });

    it("does not activate or mutate when persistence fails", async () => {
        const app = makeApp();
        const initial = {
            ...DEFAULT_SETTINGS,
            initialView: { ...DEFAULT_SETTINGS.initialView },
        };
        const plugin = {
            settings: initial,
            updateSettings: jest.fn(async () => {
                throw new Error("persist failed");
            }),
            activateView: jest.fn(),
        };

        await expect(
            completeOnboarding(app, plugin as any, "events", "#123456")
        ).rejects.toThrow("persist failed");
        expect(plugin.settings).toBe(initial);
        expect(plugin.activateView).not.toHaveBeenCalled();
    });

    it("keeps the saved source when opening the calendar fails", async () => {
        const app = makeApp();
        const plugin = {
            settings: {
                ...DEFAULT_SETTINGS,
                initialView: { ...DEFAULT_SETTINGS.initialView },
            },
            updateSettings: jest.fn(async function (
                this: { settings: FullCalendarSettings },
                next: FullCalendarSettings
            ) {
                this.settings = next;
            }),
            activateView: jest.fn(async () => {
                throw new Error("view failed");
            }),
        };
        const log = jest.spyOn(console, "error").mockImplementation(() => {});

        const source = await completeOnboarding(
            app,
            plugin as any,
            "events",
            "#123456"
        );

        expect(source?.directory).toBe("events");
        expect(plugin.settings.calendarSources).toEqual([source]);
        expect((Notice as any).notices).toEqual([
            "The event folder was saved, but the calendar could not open.",
        ]);
        log.mockRestore();
    });
});
