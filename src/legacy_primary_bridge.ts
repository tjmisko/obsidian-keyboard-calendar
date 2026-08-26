export const LEGACY_FULL_CALENDAR_VIEW_TYPE = "full-calendar-view";
export const LEGACY_PRIMARY_MIGRATION_FAILED_NOTICE =
    "A saved Full Calendar view could not be upgraded. Restart Obsidian to retry.";

export interface LegacyPrimaryBridgeOperations<Leaf> {
    getLegacyLeaves(): Leaf[];
    replaceLegacyLeaf(leaf: Leaf): Promise<void>;
    requestSaveLayout(): Promise<void>;
}

export const registerLegacyPrimaryCompatibilityView = <Leaf, View>(
    register: (type: string, creator: (leaf: Leaf) => View) => void,
    create: (leaf: Leaf) => View
): void => {
    register(LEGACY_FULL_CALENDAR_VIEW_TYPE, create);
};

/** Rewrite primary leaves saved before the Keyboard Calendar ID migration. */
export async function migrateLegacyPrimaryLeaves<Leaf>(
    operations: LegacyPrimaryBridgeOperations<Leaf>
): Promise<number> {
    const legacyLeaves = operations.getLegacyLeaves();
    for (const leaf of legacyLeaves) {
        await operations.replaceLegacyLeaf(leaf);
    }
    if (operations.getLegacyLeaves().length > 0) {
        throw new Error("A legacy primary calendar view is still attached.");
    }
    if (legacyLeaves.length > 0) {
        await operations.requestSaveLayout();
    }
    return legacyLeaves.length;
}

/** Coalesce layout-ready and compatibility-view callbacks into one retry. */
export function createLegacyPrimaryMigrationRunner<Leaf>(
    isReady: () => boolean,
    operations: LegacyPrimaryBridgeOperations<Leaf>,
    log: (error: unknown) => void,
    notify: (message: string) => void
): () => Promise<boolean> {
    let inFlight: Promise<boolean> | null = null;
    let layoutSavePending = false;
    return () => {
        if (!isReady()) {
            return Promise.resolve(false);
        }
        if (inFlight) {
            return inFlight;
        }
        const migration = migrateLegacyPrimaryLeaves(operations)
            .then(async (migratedLeaves) => {
                if (layoutSavePending && migratedLeaves === 0) {
                    await operations.requestSaveLayout();
                }
                layoutSavePending = false;
                return true;
            })
            .catch((error) => {
                // A failed layout save can occur after setViewState has
                // removed every observable legacy leaf. Remember that work
                // so an in-session retry still persists the rewritten state.
                layoutSavePending = true;
                log(error);
                notify(LEGACY_PRIMARY_MIGRATION_FAILED_NOTICE);
                return false;
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
