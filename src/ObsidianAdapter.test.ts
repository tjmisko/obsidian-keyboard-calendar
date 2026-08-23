import { TFile } from "obsidian";

import { FileBuilder } from "../test_helpers/FileBuilder";
import { MockAppBuilder } from "../test_helpers/AppBuilder";
import { ObsidianIO } from "./ObsidianAdapter";

const deferred = <T>() => {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((onResolve, onReject) => {
        resolve = onResolve;
        reject = onReject;
    });
    return { promise, resolve, reject };
};

const setup = () => {
    const app = MockAppBuilder.make()
        .file("Event.md", new FileBuilder().text("before"))
        .done();
    const file = app.vault.getAbstractFileByPath("Event.md");
    if (!(file instanceof TFile)) throw new Error("Missing test event file.");
    return { app, file, io: new ObsidianIO(app) };
};

describe("ObsidianIO.rewrite", () => {
    it("returns tuple metadata only after the exact rewritten bytes persist", async () => {
        const { app, file, io } = setup();
        const modifyGate = deferred<void>();
        let persistedBytes: string | undefined;
        const modify = jest
            .spyOn(app.vault, "modify")
            .mockImplementation(async (target, bytes) => {
                await modifyGate.promise;
                expect(target).toBe(file);
                persistedBytes = bytes;
            });
        const sentinel = { persisted: true };

        let settled = false;
        const rewrite = io
            .rewrite(file, (page) => [`${page}after`, sentinel])
            .finally(() => {
                settled = true;
            });
        await Promise.resolve();
        await Promise.resolve();

        expect(modify).toHaveBeenCalledTimes(1);
        expect(modify).toHaveBeenCalledWith(file, "before\nafter");
        expect(settled).toBe(false);
        expect(persistedBytes).toBeUndefined();

        modifyGate.resolve();
        await expect(rewrite).resolves.toBe(sentinel);
        expect(persistedBytes).toBe("before\nafter");
    });

    it("rejects a tuple rewrite without returning metadata or changing bytes", async () => {
        const { app, file, io } = setup();
        const error = new Error("write rejected");
        const modify = jest.spyOn(app.vault, "modify").mockRejectedValue(error);
        let resolved: unknown;

        const rewrite = io
            .rewrite(file, () => ["after", { persisted: true }])
            .then((value) => {
                resolved = value;
            });

        await expect(rewrite).rejects.toBe(error);
        expect(resolved).toBeUndefined();
        expect(modify).toHaveBeenCalledTimes(1);
        expect(await app.vault.read(file)).toBe("before\n");
    });

    it("persists a non-tuple rewrite exactly once", async () => {
        const { app, file, io } = setup();
        let persistedBytes: string | undefined;
        const modify = jest
            .spyOn(app.vault, "modify")
            .mockImplementation(async (target, bytes) => {
                expect(target).toBe(file);
                persistedBytes = bytes;
            });

        await expect(io.rewrite(file, () => "after")).resolves.toBeUndefined();

        expect(modify).toHaveBeenCalledTimes(1);
        expect(modify).toHaveBeenCalledWith(file, "after");
        expect(persistedBytes).toBe("after");
    });
});
