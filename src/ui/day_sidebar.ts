export interface DayCalendarController {
    goToDate(date: Date): void;
}

export interface DaySidebarOperations<Leaf> {
    getExistingLeaves(): Leaf[];
    getRightLeaf(): Leaf;
    setDayView(leaf: Leaf): Promise<void>;
    getDayView(leaf: Leaf): DayCalendarController | null;
    revealLeaf(leaf: Leaf): void;
}

/** Reuse one Day Calendar leaf or initialize it in Obsidian's right dock. */
export async function activateDayCalendarSidebar<Leaf>(
    date: Date,
    operations: DaySidebarOperations<Leaf>
): Promise<Leaf> {
    let leaf = operations.getExistingLeaves()[0];
    if (!leaf) {
        leaf = operations.getRightLeaf();
        await operations.setDayView(leaf);
    }
    operations.revealLeaf(leaf);
    operations.getDayView(leaf)?.goToDate(date);
    return leaf;
}
