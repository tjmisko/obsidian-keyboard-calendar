import {
    LEGACY_FULL_CALENDAR_VIEW_TYPE,
    LEGACY_PRIMARY_MIGRATION_FAILED_NOTICE,
    createLegacyPrimaryMigrationRunner,
    migrateLegacyPrimaryLeaves,
    registerLegacyPrimaryCompatibilityView,
} from "./legacy_primary_bridge";

type Leaf = { id: string };

const setup = (legacy: Leaf[] = []) => {
    const legacyLeaves = [...legacy];
    const operations = {
        getLegacyLeaves: jest.fn(() => [...legacyLeaves]),
        replaceLegacyLeaf: jest.fn(async (leaf: Leaf) => {
            legacyLeaves.splice(legacyLeaves.indexOf(leaf), 1);
        }),
        requestSaveLayout: jest.fn(async () => undefined),
    };
    return { legacyLeaves, operations };
};

describe("legacy primary compatibility bridge", () => {
    it("registers the former primary type only through the decoder seam", () => {
        const register = jest.fn();
        const create = jest.fn((leaf: Leaf) => leaf);

        registerLegacyPrimaryCompatibilityView(register, create);

        expect(register).toHaveBeenCalledTimes(1);
        expect(register.mock.calls[0][0]).toBe(LEGACY_FULL_CALENDAR_VIEW_TYPE);
        expect(register.mock.calls[0][1]({ id: "old" })).toEqual({
            id: "old",
        });
    });

    it("replaces every old primary leaf before saving the layout", async () => {
        const first = { id: "first" };
        const second = { id: "second" };
        const { legacyLeaves, operations } = setup([first, second]);

        await expect(migrateLegacyPrimaryLeaves(operations)).resolves.toBe(2);

        expect(operations.replaceLegacyLeaf.mock.calls).toEqual([
            [first],
            [second],
        ]);
        expect(legacyLeaves).toEqual([]);
        expect(operations.requestSaveLayout).toHaveBeenCalledTimes(1);
    });

    it("does not save an empty migration", async () => {
        const { operations } = setup();

        await expect(migrateLegacyPrimaryLeaves(operations)).resolves.toBe(0);

        expect(operations.requestSaveLayout).not.toHaveBeenCalled();
    });

    it("reports a fixed failure and allows a retry", async () => {
        const { operations } = setup([{ id: "old" }]);
        operations.replaceLegacyLeaf.mockRejectedValueOnce(
            new Error("replace failed")
        );
        const log = jest.fn();
        const notify = jest.fn();
        const request = createLegacyPrimaryMigrationRunner(
            () => true,
            operations,
            log,
            notify
        );

        await expect(request()).resolves.toBe(false);
        expect(log).toHaveBeenCalledWith(expect.any(Error));
        expect(notify).toHaveBeenCalledWith(
            LEGACY_PRIMARY_MIGRATION_FAILED_NOTICE
        );

        await expect(request()).resolves.toBe(true);
        expect(operations.requestSaveLayout).toHaveBeenCalledTimes(1);
    });

    it("retries a failed layout save after the old leaf was replaced", async () => {
        const { legacyLeaves, operations } = setup([{ id: "old" }]);
        operations.requestSaveLayout.mockRejectedValueOnce(
            new Error("layout save failed")
        );
        const request = createLegacyPrimaryMigrationRunner(
            () => true,
            operations,
            jest.fn(),
            jest.fn()
        );

        await expect(request()).resolves.toBe(false);
        expect(legacyLeaves).toEqual([]);

        await expect(request()).resolves.toBe(true);
        expect(operations.replaceLegacyLeaf).toHaveBeenCalledTimes(1);
        expect(operations.requestSaveLayout).toHaveBeenCalledTimes(2);
    });

    it("does nothing before settings and workspace layout are ready", async () => {
        const { operations } = setup([{ id: "old" }]);
        const request = createLegacyPrimaryMigrationRunner(
            () => false,
            operations,
            jest.fn(),
            jest.fn()
        );

        await expect(request()).resolves.toBe(false);
        expect(operations.getLegacyLeaves).not.toHaveBeenCalled();
    });
});
