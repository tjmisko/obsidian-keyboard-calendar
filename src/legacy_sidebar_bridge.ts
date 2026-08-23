export const LEGACY_FULL_CALENDAR_SIDEBAR_VIEW_TYPE =
    "full-calendar-sidebar-view";
export const LEGACY_SIDEBAR_MIGRATION_VERSION = 1;
export const LEGACY_SIDEBAR_MIGRATION_FAILED_NOTICE =
    "A saved Full Calendar sidebar could not be upgraded. Restart Obsidian to retry.";

export interface LegacySidebarBridgeOperations<Leaf> {
    getPrimaryLeaves(): Leaf[];
    getLegacyLeaves(): Leaf[];
    createPrimaryLeaf(): Promise<Leaf>;
    revealPrimaryLeaf(leaf: Leaf): void;
    detachLegacyLeaf(leaf: Leaf): void;
    requestSaveLayout(): Promise<void>;
    persistMigrationVersion(version: number): Promise<void>;
}

export interface LegacySidebarBridgeResult {
    createdPrimary: boolean;
    detachedLegacyLeaves: number;
    markerPersisted: boolean;
}

export const registerLegacySidebarCompatibilityView = <Leaf, View>(
    register: (type: string, creator: (leaf: Leaf) => View) => void,
    create: (leaf: Leaf) => View
): void => {
    register(LEGACY_FULL_CALENDAR_SIDEBAR_VIEW_TYPE, create);
};

/**
 * Rewrite saved sidebar leaves only after a normal calendar leaf is known to
 * exist. The legacy view type remains registered independently as a decoder,
 * so a failed attempt never leaves Obsidian with an unknown view type.
 */
export async function migrateLegacySidebarLeaves<Leaf>(
    operations: LegacySidebarBridgeOperations<Leaf>,
    currentMigrationVersion: number
): Promise<LegacySidebarBridgeResult> {
    const legacyLeaves = operations.getLegacyLeaves();
    let createdPrimary = false;

    if (legacyLeaves.length > 0 && operations.getPrimaryLeaves().length === 0) {
        const primaryLeaf = await operations.createPrimaryLeaf();
        if (operations.getPrimaryLeaves().length === 0) {
            throw new Error("The replacement calendar view did not open.");
        }
        operations.revealPrimaryLeaf(primaryLeaf);
        createdPrimary = true;
    }

    let detachedLegacyLeaves = 0;
    for (const leaf of legacyLeaves) {
        operations.detachLegacyLeaf(leaf);
        detachedLegacyLeaves += 1;
    }

    if (operations.getLegacyLeaves().length > 0) {
        throw new Error("A legacy sidebar calendar view is still attached.");
    }

    let layoutSaved = false;
    if (legacyLeaves.length > 0) {
        await operations.requestSaveLayout();
        layoutSaved = true;
    }

    const markerPersisted =
        currentMigrationVersion < LEGACY_SIDEBAR_MIGRATION_VERSION;
    if (markerPersisted) {
        if (!layoutSaved) {
            await operations.requestSaveLayout();
        }
        await operations.persistMigrationVersion(
            LEGACY_SIDEBAR_MIGRATION_VERSION
        );
    }

    return { createdPrimary, detachedLegacyLeaves, markerPersisted };
}

/** Coalesce layout-ready and compatibility-view callbacks into one retry. */
export function createLegacySidebarMigrationRunner<Leaf>(
    isReady: () => boolean,
    getCurrentMigrationVersion: () => number,
    operations: LegacySidebarBridgeOperations<Leaf>,
    log: (error: unknown) => void,
    notify: (message: string) => void
): () => Promise<void> {
    let inFlight: Promise<void> | null = null;
    return () => {
        if (!isReady()) {
            return Promise.resolve();
        }
        if (inFlight) {
            return inFlight;
        }
        const migration = migrateLegacySidebarLeaves(
            operations,
            getCurrentMigrationVersion()
        )
            .then(() => undefined)
            .catch((error) => {
                log(error);
                notify(LEGACY_SIDEBAR_MIGRATION_FAILED_NOTICE);
            })
            .finally(() => {
                if (inFlight === migration) {
                    inFlight = null;
                }
            });
        inFlight = migration;
        return migration;
    };
}
