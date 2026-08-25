import type { WorkspaceLeaf } from "obsidian";
import type FullCalendarPlugin from "../main";
import { CalendarView } from "./view";

/** A fixed single-day calendar surface intended for Obsidian's right sidebar. */
export class DayCalendarView extends CalendarView {
    constructor(leaf: WorkspaceLeaf, plugin: FullCalendarPlugin) {
        super(leaf, plugin, "day-sidebar");
    }
}
