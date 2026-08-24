import { OFCEvent } from "../types";
import {
    dateEndpointsToFrontmatter,
    selectionRequiresDayView,
} from "./interop";

/** Route FullCalendar selection without an editor/modal boundary. */
export async function handleCalendarSelection({
    start,
    end,
    allDay,
    viewType,
    focusTitle = false,
    openDay,
    createTimedNote,
}: {
    start: Date;
    end: Date;
    allDay: boolean;
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
}): Promise<void> {
    if (selectionRequiresDayView(viewType, allDay)) {
        openDay(start);
        return;
    }
    await createTimedNote(dateEndpointsToFrontmatter(start, end, false), {
        focusTitle,
        focusEventOnReturn: true,
    });
}
