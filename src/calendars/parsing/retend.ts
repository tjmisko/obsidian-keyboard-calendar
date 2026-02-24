/**
 * Parser and serializer for .retend and .schedule files.
 *
 * File format: 96 lines per day (15-min slots from 00:00 to 23:45).
 * Each line: `YYYY-MM-DD | HH:MM | <{Category} (Title)>`
 *
 * Consecutive identical {category, title} slots merge into single events.
 * Empty/placeholder slots use `<{Category} (Title)>` or `<{} ()>`.
 */

export interface RetendSlot {
    date: string;
    time: string;
    category: string;
    title: string;
}

export interface RetendEvent {
    date: string;
    startTime: string;
    endTime: string;
    category: string;
    title: string;
    startLine: number;
    endLine: number;
}

const SLOT_REGEX =
    /^(\d{4}-\d{2}-\d{2}) \| (\d{2}:\d{2}) \| <\{([^}]*)\} \(([^)]*)\)>$/;

const PLACEHOLDER_CATEGORY = "Category";
const PLACEHOLDER_TITLE = "Title";
const SLOTS_PER_DAY = 96;
const MINUTES_PER_SLOT = 15;

export function parseSlotLine(line: string): RetendSlot | null {
    const match = line.match(SLOT_REGEX);
    if (!match) {
        return null;
    }
    return {
        date: match[1],
        time: match[2],
        category: match[3],
        title: match[4],
    };
}

export function isEmptySlot(slot: RetendSlot): boolean {
    return (
        (slot.category === PLACEHOLDER_CATEGORY &&
            slot.title === PLACEHOLDER_TITLE) ||
        (slot.category === "" && slot.title === "")
    );
}

function addMinutesToTime(time: string, minutes: number): string {
    const [h, m] = time.split(":").map(Number);
    const totalMinutes = h * 60 + m + minutes;
    const newH = Math.floor(totalMinutes / 60) % 24;
    const newM = totalMinutes % 60;
    return `${String(newH).padStart(2, "0")}:${String(newM).padStart(2, "0")}`;
}

export function parseRetendFile(contents: string): RetendEvent[] {
    const lines = contents.split("\n");
    const slots: (RetendSlot | null)[] = lines.map(parseSlotLine);

    const events: RetendEvent[] = [];
    let i = 0;

    while (i < slots.length) {
        const slot = slots[i];
        if (!slot || isEmptySlot(slot)) {
            i++;
            continue;
        }

        const startLine = i;
        const { date, time: startTime, category, title } = slot;

        // Walk forward while same category+title
        let j = i + 1;
        while (j < slots.length) {
            const next = slots[j];
            if (!next || next.category !== category || next.title !== title) {
                break;
            }
            j++;
        }

        const lastSlot = slots[j - 1]!;
        const endTime = addMinutesToTime(lastSlot.time, MINUTES_PER_SLOT);

        events.push({
            date,
            startTime,
            endTime,
            category,
            title,
            startLine,
            endLine: j - 1,
        });

        i = j;
    }

    return events;
}

export function serializeSlot(slot: RetendSlot): string {
    return `${slot.date} | ${slot.time} | <{${slot.category}} (${slot.title})>`;
}

export function serializeRetendFile(slots: RetendSlot[]): string {
    return slots.map(serializeSlot).join("\n");
}

export function emptyRetendFile(date: string): string {
    const slots: RetendSlot[] = [];
    for (let i = 0; i < SLOTS_PER_DAY; i++) {
        slots.push({
            date,
            time: slotIndexToTime(i),
            category: PLACEHOLDER_CATEGORY,
            title: PLACEHOLDER_TITLE,
        });
    }
    return serializeRetendFile(slots);
}

export function writeEventToSlots(
    slots: RetendSlot[],
    startIdx: number,
    endIdx: number,
    category: string,
    title: string
): RetendSlot[] {
    return slots.map((slot, i) => {
        if (i >= startIdx && i <= endIdx) {
            return { ...slot, category, title };
        }
        return slot;
    });
}

export function clearSlots(
    slots: RetendSlot[],
    startIdx: number,
    endIdx: number
): RetendSlot[] {
    return slots.map((slot, i) => {
        if (i >= startIdx && i <= endIdx) {
            return {
                ...slot,
                category: PLACEHOLDER_CATEGORY,
                title: PLACEHOLDER_TITLE,
            };
        }
        return slot;
    });
}

export function timeToSlotIndex(time: string): number {
    const [h, m] = time.split(":").map(Number);
    return h * 4 + Math.floor(m / MINUTES_PER_SLOT);
}

export function slotIndexToTime(index: number): string {
    const h = Math.floor(index / 4);
    const m = (index % 4) * MINUTES_PER_SLOT;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function dateFromFilename(filename: string): string | null {
    const match = filename.match(/(\d{4}-\d{2}-\d{2})\.(retend|schedule)$/);
    return match ? match[1] : null;
}

export function parseRetendSlots(contents: string): RetendSlot[] {
    return contents
        .split("\n")
        .map(parseSlotLine)
        .filter((s): s is RetendSlot => s !== null);
}
