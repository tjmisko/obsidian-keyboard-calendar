export type { OFCEvent } from "./schema";
export { parseEvent, validateEvent } from "./schema";

export {
    fullNoteSourceId,
    resolveDefaultFullNoteCalendar,
} from "./calendar_settings";
export type { CalendarInfo } from "./calendar_settings";

export const PLUGIN_SLUG = "full-calendar-plugin";
