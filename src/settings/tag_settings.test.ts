import {
    decodeGhostEventTags,
    eventHasGhostTag,
    parseGhostEventTagsInput,
} from "./tag_settings";

describe("ghost event tags", () => {
    it("uses a neutral default when the setting is absent", () => {
        expect(decodeGhostEventTags(undefined)).toEqual(["ghost"]);
        expect(decodeGhostEventTags("jen")).toEqual(["ghost"]);
    });

    it("normalizes configured tags while allowing an empty list", () => {
        expect(decodeGhostEventTags([" Jen ", "#SKIP", "jen", 42])).toEqual([
            "jen",
            "skip",
        ]);
        expect(decodeGhostEventTags([])).toEqual([]);
        expect(parseGhostEventTagsInput(" Jen, #skip\nmaybe ")).toEqual([
            "jen",
            "skip",
            "maybe",
        ]);
    });

    it("matches event tags case-insensitively", () => {
        expect(eventHasGhostTag(["Dance", "JEN"], ["jen"])).toBe(true);
        expect(eventHasGhostTag(["Dance"], ["jen"])).toBe(false);
        expect(eventHasGhostTag(["jen"], [])).toBe(false);
    });
});
