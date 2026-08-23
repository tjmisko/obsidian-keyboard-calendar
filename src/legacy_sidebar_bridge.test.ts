import {
    LEGACY_FULL_CALENDAR_SIDEBAR_VIEW_TYPE,
    LEGACY_SIDEBAR_MIGRATION_FAILED_NOTICE,
    LEGACY_SIDEBAR_MIGRATION_VERSION,
    createLegacySidebarMigrationRunner,
    migrateLegacySidebarLeaves,
    registerLegacySidebarCompatibilityView,
} from "./legacy_sidebar_bridge";

type Leaf = { id: string; type: "primary" | "legacy" };

const setup = ({
    primary = [],
    legacy = [],
    createFailure,
    saveFailure,
    markerFailure,
    createWithoutPrimary = false,
}: {
    primary?: Leaf[];
    legacy?: Leaf[];
    createFailure?: Error;
    saveFailure?: Error;
    markerFailure?: Error;
    createWithoutPrimary?: boolean;
}) => {
    const primaryLeaves = [...primary];
    const legacyLeaves = [...legacy];
    const order: string[] = [];
    const operations = {
        getPrimaryLeaves: jest.fn(() => [...primaryLeaves]),
        getLegacyLeaves: jest.fn(() => [...legacyLeaves]),
        createPrimaryLeaf: jest.fn(async () => {
            order.push("create-primary");
            if (createFailure) throw createFailure;
            const leaf = { id: "created", type: "primary" } as const;
            if (!createWithoutPrimary) primaryLeaves.push(leaf);
            return leaf;
        }),
        revealPrimaryLeaf: jest.fn((leaf: Leaf) => {
            order.push(`reveal:${leaf.id}`);
        }),
        detachLegacyLeaf: jest.fn((leaf: Leaf) => {
            order.push(`detach:${leaf.id}`);
            legacyLeaves.splice(legacyLeaves.indexOf(leaf), 1);
        }),
        requestSaveLayout: jest.fn(async () => {
            order.push("save-layout");
            if (saveFailure) throw saveFailure;
        }),
        persistMigrationVersion: jest.fn(async (version: number) => {
            order.push(`persist-marker:${version}`);
            if (markerFailure) throw markerFailure;
        }),
    };
    return { operations, order, primaryLeaves, legacyLeaves };
};

describe("legacy sidebar compatibility bridge", () => {
    it("registers the old type only through the decoder shim seam", () => {
        const register = jest.fn();
        const create = jest.fn((leaf: Leaf) => leaf);

        registerLegacySidebarCompatibilityView(register, create);

        expect(register).toHaveBeenCalledTimes(1);
        expect(register.mock.calls[0][0]).toBe(
            LEGACY_FULL_CALENDAR_SIDEBAR_VIEW_TYPE
        );
        expect(
            register.mock.calls[0][1]({ id: "old", type: "legacy" })
        ).toEqual({ id: "old", type: "legacy" });
    });

    it("keeps an existing primary leaf and detaches every legacy leaf before marking", async () => {
        const primary = { id: "main", type: "primary" } as const;
        const legacy = [
            { id: "old-one", type: "legacy" } as const,
            { id: "old-two", type: "legacy" } as const,
        ];
        const { operations, order, primaryLeaves } = setup({
            primary: [primary],
            legacy,
        });

        await expect(
            migrateLegacySidebarLeaves(operations, 0)
        ).resolves.toEqual({
            createdPrimary: false,
            detachedLegacyLeaves: 2,
            markerPersisted: true,
        });
        expect(primaryLeaves).toEqual([primary]);
        expect(operations.createPrimaryLeaf).not.toHaveBeenCalled();
        expect(operations.revealPrimaryLeaf).not.toHaveBeenCalled();
        expect(order).toEqual([
            "detach:old-one",
            "detach:old-two",
            "save-layout",
            `persist-marker:${LEGACY_SIDEBAR_MIGRATION_VERSION}`,
        ]);
    });

    it("opens and verifies one primary tab before detaching a legacy-only layout", async () => {
        const { operations, order, primaryLeaves } = setup({
            legacy: [
                { id: "old-one", type: "legacy" },
                { id: "old-two", type: "legacy" },
            ],
        });

        await migrateLegacySidebarLeaves(operations, 0);

        expect(primaryLeaves).toHaveLength(1);
        expect(operations.createPrimaryLeaf).toHaveBeenCalledTimes(1);
        expect(order).toEqual([
            "create-primary",
            "reveal:created",
            "detach:old-one",
            "detach:old-two",
            "save-layout",
            `persist-marker:${LEGACY_SIDEBAR_MIGRATION_VERSION}`,
        ]);
    });

    it("marks an empty layout once and is idempotent on the next restart", async () => {
        const first = setup({});
        await migrateLegacySidebarLeaves(first.operations, 0);
        expect(first.operations.persistMigrationVersion).toHaveBeenCalledWith(
            LEGACY_SIDEBAR_MIGRATION_VERSION
        );
        expect(first.operations.requestSaveLayout).toHaveBeenCalledTimes(1);

        const second = setup({});
        await migrateLegacySidebarLeaves(
            second.operations,
            LEGACY_SIDEBAR_MIGRATION_VERSION
        );
        expect(
            second.operations.persistMigrationVersion
        ).not.toHaveBeenCalled();
    });

    it("still handles a restored legacy layout when the marker is current or future", async () => {
        for (const marker of [LEGACY_SIDEBAR_MIGRATION_VERSION, 17]) {
            const { operations, legacyLeaves } = setup({
                primary: [{ id: "main", type: "primary" }],
                legacy: [{ id: `restored-${marker}`, type: "legacy" }],
            });
            await migrateLegacySidebarLeaves(operations, marker);
            expect(legacyLeaves).toEqual([]);
            expect(operations.persistMigrationVersion).not.toHaveBeenCalled();
        }
    });

    it("does not detach or mark when opening the replacement fails", async () => {
        const legacy = { id: "old", type: "legacy" } as const;
        const { operations, legacyLeaves } = setup({
            legacy: [legacy],
            createFailure: new Error("open failed"),
        });
        await expect(migrateLegacySidebarLeaves(operations, 0)).rejects.toThrow(
            "open failed"
        );
        expect(legacyLeaves).toEqual([legacy]);
        expect(operations.detachLegacyLeaf).not.toHaveBeenCalled();
        expect(operations.persistMigrationVersion).not.toHaveBeenCalled();
    });

    it("does not detach when a resolved replacement is not discoverable", async () => {
        const { operations, legacyLeaves } = setup({
            legacy: [{ id: "old", type: "legacy" }],
            createWithoutPrimary: true,
        });

        await expect(migrateLegacySidebarLeaves(operations, 0)).rejects.toThrow(
            "did not open"
        );
        expect(legacyLeaves).toHaveLength(1);
        expect(operations.revealPrimaryLeaf).not.toHaveBeenCalled();
        expect(operations.detachLegacyLeaf).not.toHaveBeenCalled();
        expect(operations.persistMigrationVersion).not.toHaveBeenCalled();
    });

    it("does not mark a partial detach and can retry the remaining shim", async () => {
        const state = setup({
            primary: [{ id: "main", type: "primary" }],
            legacy: [
                { id: "first", type: "legacy" },
                { id: "second", type: "legacy" },
            ],
        });
        const detach =
            state.operations.detachLegacyLeaf.getMockImplementation()!;
        state.operations.detachLegacyLeaf
            .mockImplementationOnce(detach)
            .mockImplementationOnce(() => {
                throw new Error("detach failed");
            });

        await expect(
            migrateLegacySidebarLeaves(state.operations, 0)
        ).rejects.toThrow("detach failed");
        expect(state.legacyLeaves.map(({ id }) => id)).toEqual(["second"]);
        expect(state.operations.persistMigrationVersion).not.toHaveBeenCalled();

        state.operations.detachLegacyLeaf.mockImplementation(detach);
        await migrateLegacySidebarLeaves(state.operations, 0);
        expect(state.legacyLeaves).toEqual([]);
        expect(state.operations.persistMigrationVersion).toHaveBeenCalledTimes(
            1
        );
    });

    it("leaves the marker retryable when layout or marker persistence fails", async () => {
        const layoutFailure = setup({
            primary: [{ id: "main", type: "primary" }],
            legacy: [{ id: "old", type: "legacy" }],
            saveFailure: new Error("layout save failed"),
        });
        await expect(
            migrateLegacySidebarLeaves(layoutFailure.operations, 0)
        ).rejects.toThrow("layout save failed");
        expect(
            layoutFailure.operations.persistMigrationVersion
        ).not.toHaveBeenCalled();
        await expect(
            migrateLegacySidebarLeaves(layoutFailure.operations, 0)
        ).rejects.toThrow("layout save failed");
        expect(
            layoutFailure.operations.persistMigrationVersion
        ).not.toHaveBeenCalled();
        expect(
            layoutFailure.operations.requestSaveLayout
        ).toHaveBeenCalledTimes(2);

        layoutFailure.operations.requestSaveLayout.mockResolvedValueOnce();
        await migrateLegacySidebarLeaves(layoutFailure.operations, 0);
        expect(
            layoutFailure.operations.requestSaveLayout
        ).toHaveBeenCalledTimes(3);
        expect(
            layoutFailure.operations.persistMigrationVersion
        ).toHaveBeenCalledTimes(1);

        const markerFailure = setup({
            markerFailure: new Error("marker save failed"),
        });
        await expect(
            migrateLegacySidebarLeaves(markerFailure.operations, 0)
        ).rejects.toThrow("marker save failed");
        expect(
            markerFailure.operations.persistMigrationVersion
        ).toHaveBeenCalledTimes(1);
    });

    it("coalesces callbacks and reports a fixed failure before allowing retry", async () => {
        let release: (() => void) | undefined;
        const pending = new Promise<void>((resolve) => {
            release = resolve;
        });
        const state = setup({});
        state.operations.persistMigrationVersion.mockImplementationOnce(
            async () => pending
        );
        const log = jest.fn();
        const notify = jest.fn();
        const request = createLegacySidebarMigrationRunner(
            () => true,
            () => 0,
            state.operations,
            log,
            notify
        );

        const first = request();
        const concurrent = request();
        expect(first).toBe(concurrent);
        await Promise.resolve();
        await Promise.resolve();
        expect(state.operations.persistMigrationVersion).toHaveBeenCalledTimes(
            1
        );
        release?.();
        await first;

        state.operations.persistMigrationVersion.mockRejectedValueOnce(
            new Error("marker failed")
        );
        await request();
        expect(log).toHaveBeenCalledWith(expect.any(Error));
        expect(notify).toHaveBeenCalledWith(
            LEGACY_SIDEBAR_MIGRATION_FAILED_NOTICE
        );

        state.operations.persistMigrationVersion.mockResolvedValueOnce();
        await request();
        expect(state.operations.persistMigrationVersion).toHaveBeenCalledTimes(
            3
        );
    });

    it("does nothing before settings and workspace layout are ready", async () => {
        const state = setup({
            legacy: [{ id: "old", type: "legacy" }],
        });
        const request = createLegacySidebarMigrationRunner(
            () => false,
            () => 0,
            state.operations,
            jest.fn(),
            jest.fn()
        );

        await request();

        expect(state.operations.getLegacyLeaves).not.toHaveBeenCalled();
        expect(state.operations.createPrimaryLeaf).not.toHaveBeenCalled();
        expect(state.operations.persistMigrationVersion).not.toHaveBeenCalled();
    });
});
