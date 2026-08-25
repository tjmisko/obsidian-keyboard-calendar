import {
    decodeEventTagColors,
    decodeGhostEventTags,
    eventHasGhostTag,
    parseEventTagInput,
    parseGhostEventTagsInput,
    resolveEventTagColor,
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

describe("event tag colors", () => {
    it("normalizes valid rules and drops malformed or duplicate entries", () => {
        expect(
            decodeEventTagColors([
                { tag: " #Work ", color: "#AABBCC" },
                { tag: "work", color: "#000000" },
                { tag: "dance", color: "not-a-color" },
                { tag: "social", color: "#abc" },
                null,
            ])
        ).toEqual([
            { tag: "work", color: "#aabbcc" },
            { tag: "social", color: "#abc" },
        ]);
        expect(decodeEventTagColors({ work: "#aabbcc" })).toEqual([]);
        expect(parseEventTagInput(" ##Work ")).toBe("work");
    });

    it("uses the first configured rule matching any event tag", () => {
        const rules = [
            { tag: "urgent", color: "#ff0000" },
            { tag: "work", color: "#0000ff" },
        ];
        expect(resolveEventTagColor(["WORK", "urgent"], rules)).toBe("#ff0000");
        expect(resolveEventTagColor(["personal"], rules)).toBeNull();
        expect(resolveEventTagColor(undefined, rules)).toBeNull();
    });
});
