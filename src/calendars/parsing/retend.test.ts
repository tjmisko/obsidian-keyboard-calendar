import {
    parseSlotLine,
    isEmptySlot,
    parseRetendFile,
    serializeSlot,
    serializeRetendFile,
    emptyRetendFile,
    writeEventToSlots,
    clearSlots,
    timeToSlotIndex,
    slotIndexToTime,
    dateFromFilename,
    parseRetendSlots,
    RetendSlot,
} from "./retend";

describe("retend parser", () => {
    describe("parseSlotLine", () => {
        it("should parse a valid slot line", () => {
            const line = "2026-02-23 | 09:00 | <{Work} (Deep focus)>";
            const slot = parseSlotLine(line);
            expect(slot).toEqual({
                date: "2026-02-23",
                time: "09:00",
                category: "Work",
                title: "Deep focus",
            });
        });

        it("should parse a placeholder slot line", () => {
            const line = "2026-02-23 | 00:00 | <{Category} (Title)>";
            const slot = parseSlotLine(line);
            expect(slot).toEqual({
                date: "2026-02-23",
                time: "00:00",
                category: "Category",
                title: "Title",
            });
        });

        it("should parse an empty category/title slot", () => {
            const line = "2026-02-23 | 12:00 | <{} ()>";
            const slot = parseSlotLine(line);
            expect(slot).toEqual({
                date: "2026-02-23",
                time: "12:00",
                category: "",
                title: "",
            });
        });

        it("should return null for invalid lines", () => {
            expect(parseSlotLine("not a valid line")).toBeNull();
            expect(parseSlotLine("")).toBeNull();
            expect(parseSlotLine("2026-02-23 | 09:00 | Work")).toBeNull();
        });
    });

    describe("isEmptySlot", () => {
        it("should return true for placeholder slots", () => {
            expect(
                isEmptySlot({
                    date: "2026-02-23",
                    time: "00:00",
                    category: "Category",
                    title: "Title",
                })
            ).toBe(true);
        });

        it("should return true for empty category and title", () => {
            expect(
                isEmptySlot({
                    date: "2026-02-23",
                    time: "00:00",
                    category: "",
                    title: "",
                })
            ).toBe(true);
        });

        it("should return false for non-empty slots", () => {
            expect(
                isEmptySlot({
                    date: "2026-02-23",
                    time: "09:00",
                    category: "Work",
                    title: "Meeting",
                })
            ).toBe(false);
        });
    });

    describe("timeToSlotIndex / slotIndexToTime", () => {
        it("should convert 00:00 to index 0", () => {
            expect(timeToSlotIndex("00:00")).toBe(0);
        });

        it("should convert 23:45 to index 95", () => {
            expect(timeToSlotIndex("23:45")).toBe(95);
        });

        it("should convert 09:30 to index 38", () => {
            expect(timeToSlotIndex("09:30")).toBe(38);
        });

        it("should convert index 0 to 00:00", () => {
            expect(slotIndexToTime(0)).toBe("00:00");
        });

        it("should convert index 95 to 23:45", () => {
            expect(slotIndexToTime(95)).toBe("23:45");
        });

        it("should round-trip all indices", () => {
            for (let i = 0; i < 96; i++) {
                expect(timeToSlotIndex(slotIndexToTime(i))).toBe(i);
            }
        });
    });

    describe("serializeSlot", () => {
        it("should serialize a slot back to line format", () => {
            const slot: RetendSlot = {
                date: "2026-02-23",
                time: "09:00",
                category: "Work",
                title: "Deep focus",
            };
            expect(serializeSlot(slot)).toBe(
                "2026-02-23 | 09:00 | <{Work} (Deep focus)>"
            );
        });
    });

    describe("emptyRetendFile", () => {
        it("should generate 96 lines", () => {
            const contents = emptyRetendFile("2026-02-23");
            const lines = contents.split("\n");
            expect(lines).toHaveLength(96);
        });

        it("should start at 00:00 and end at 23:45", () => {
            const contents = emptyRetendFile("2026-02-23");
            const lines = contents.split("\n");
            expect(lines[0]).toBe("2026-02-23 | 00:00 | <{Category} (Title)>");
            expect(lines[95]).toBe("2026-02-23 | 23:45 | <{Category} (Title)>");
        });

        it("should round-trip through parse and serialize", () => {
            const date = "2026-02-23";
            const contents = emptyRetendFile(date);
            const slots = parseRetendSlots(contents);
            expect(serializeRetendFile(slots)).toBe(contents);
        });
    });

    describe("parseRetendFile", () => {
        it("should return no events for an empty file", () => {
            const contents = emptyRetendFile("2026-02-23");
            const events = parseRetendFile(contents);
            expect(events).toHaveLength(0);
        });

        it("should parse a single event spanning multiple slots", () => {
            const slots = parseRetendSlots(emptyRetendFile("2026-02-23"));
            const modified = writeEventToSlots(
                slots,
                36,
                39,
                "Work",
                "Meeting"
            );
            const contents = serializeRetendFile(modified);
            const events = parseRetendFile(contents);

            expect(events).toHaveLength(1);
            expect(events[0]).toEqual({
                date: "2026-02-23",
                startTime: "09:00",
                endTime: "10:00",
                category: "Work",
                title: "Meeting",
                startLine: 36,
                endLine: 39,
            });
        });

        it("should parse two adjacent events with different categories", () => {
            const slots = parseRetendSlots(emptyRetendFile("2026-02-23"));
            let modified = writeEventToSlots(slots, 36, 39, "Work", "Meeting");
            modified = writeEventToSlots(modified, 40, 43, "Break", "Lunch");
            const contents = serializeRetendFile(modified);
            const events = parseRetendFile(contents);

            expect(events).toHaveLength(2);
            expect(events[0].category).toBe("Work");
            expect(events[0].endTime).toBe("10:00");
            expect(events[1].category).toBe("Break");
            expect(events[1].startTime).toBe("10:00");
            expect(events[1].endTime).toBe("11:00");
        });

        it("should merge consecutive slots with same category and title", () => {
            const slots = parseRetendSlots(emptyRetendFile("2026-02-23"));
            const modified = writeEventToSlots(slots, 0, 7, "Sleep", "Night");
            const contents = serializeRetendFile(modified);
            const events = parseRetendFile(contents);

            expect(events).toHaveLength(1);
            expect(events[0].startTime).toBe("00:00");
            expect(events[0].endTime).toBe("02:00");
        });

        it("should handle a single 15-minute slot", () => {
            const slots = parseRetendSlots(emptyRetendFile("2026-02-23"));
            const modified = writeEventToSlots(slots, 48, 48, "Quick", "Call");
            const contents = serializeRetendFile(modified);
            const events = parseRetendFile(contents);

            expect(events).toHaveLength(1);
            expect(events[0].startTime).toBe("12:00");
            expect(events[0].endTime).toBe("12:15");
        });
    });

    describe("writeEventToSlots / clearSlots", () => {
        it("should write an event into the specified range", () => {
            const slots = parseRetendSlots(emptyRetendFile("2026-02-23"));
            const modified = writeEventToSlots(
                slots,
                36,
                39,
                "Work",
                "Meeting"
            );

            expect(modified[36].category).toBe("Work");
            expect(modified[36].title).toBe("Meeting");
            expect(modified[39].category).toBe("Work");
            expect(modified[35].category).toBe("Category");
            expect(modified[40].category).toBe("Category");
        });

        it("should clear slots back to placeholder", () => {
            const slots = parseRetendSlots(emptyRetendFile("2026-02-23"));
            const written = writeEventToSlots(slots, 36, 39, "Work", "Meeting");
            const cleared = clearSlots(written, 36, 39);

            expect(cleared[36].category).toBe("Category");
            expect(cleared[36].title).toBe("Title");
        });
    });

    describe("dateFromFilename", () => {
        it("should extract date from .retend filename", () => {
            expect(dateFromFilename("2026-02-23.retend")).toBe("2026-02-23");
        });

        it("should extract date from .schedule filename", () => {
            expect(dateFromFilename("2026-02-23.schedule")).toBe("2026-02-23");
        });

        it("should extract date from path with directory", () => {
            expect(dateFromFilename("retend/2026-02-23.retend")).toBe(
                "2026-02-23"
            );
        });

        it("should return null for invalid filenames", () => {
            expect(dateFromFilename("notes.md")).toBeNull();
            expect(dateFromFilename("2026-02-23.txt")).toBeNull();
        });
    });
});
