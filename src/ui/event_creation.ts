import { OFCEvent } from "../types";
import {
    dateEndpointsToFrontmatter,
    selectionRequiresDayView,
} from "./interop";

/** Route FullCalendar selection without an editor/modal boundary. */
export async function handleCalendarSelection({
    start,
    end,
    viewType,
    focusTitle = false,
    openDay,
    createTimedNote,
    proposeTimedEvent,
}: {
    start: Date;
    end: Date;
    viewType: string;
    focusTitle?: boolean;
    openDay: (date: Date) => void;
    createTimedNote: (
        event: Partial<OFCEvent>,
        options: {
            focusTitle: boolean;
            focusEventOnReturn: boolean;
        }
    ) => Promise<void>;
    /**
     * Touch surfaces confirm a pointer selection before writing a note, since
     * a held finger selects as easily as it scrolls. Keyboard insert mode
     * (focusTitle) is deliberate and still creates directly.
     */
    proposeTimedEvent?: (start: Date, end: Date) => void;
}): Promise<void> {
    if (selectionRequiresDayView(viewType)) {
        openDay(start);
        return;
    }
    if (proposeTimedEvent && !focusTitle) {
        proposeTimedEvent(start, end);
        return;
    }
    await createTimedNote(dateEndpointsToFrontmatter(start, end), {
        focusTitle,
        focusEventOnReturn: true,
    });
}
