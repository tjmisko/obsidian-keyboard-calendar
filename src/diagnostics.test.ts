import { DiagnosticLogger, DiagnosticStorage } from "./diagnostics";

class MemoryDiagnosticStorage implements DiagnosticStorage {
    readonly values = new Map<string, string>();

    getItem(key: string): string | null {
        return this.values.get(key) || null;
    }

    setItem(key: string, value: string): void {
        this.values.set(key, value);
    }

    removeItem(key: string): void {
        this.values.delete(key);
    }
}

const fixedNow = () => new Date("2026-08-26T12:00:00.000Z");

describe("DiagnosticLogger", () => {
    it("persists bounded entries across logger sessions", () => {
        const storage = new MemoryDiagnosticStorage();
        const first = new DiagnosticLogger(storage, {
            maxEntries: 2,
            now: fixedNow,
            sessionId: "first",
        });
        first.info("discarded");
        first.warning("retained-warning", { count: 2 });
        first.info("retained-info");

        const second = new DiagnosticLogger(storage, {
            maxEntries: 2,
            now: fixedNow,
            sessionId: "second",
        });

        expect(second.getEntries()).toEqual([
            {
                timestamp: "2026-08-26T12:00:00.000Z",
                sessionId: "first",
                level: "warning",
                event: "retained-warning",
                details: { count: 2 },
            },
            {
                timestamp: "2026-08-26T12:00:00.000Z",
                sessionId: "first",
                level: "info",
                event: "retained-info",
            },
        ]);
    });

    it("serializes errors and redacts private host paths", () => {
        const logger = new DiagnosticLogger(null, {
            now: fixedNow,
            sessionId: "mobile",
        });
        const error = new Error(
            "Failed in /home/alice/Vault/.obsidian/plugins/calendar/main.js"
        );
        error.stack =
            "Error: failed\n at /Users/alice/Projects/calendar/main.js:10:2";
        const circular: { self?: unknown } = {};
        circular.self = circular;

        logger.error("calendar.render.failed", error, { circular });
        const report = logger.createReport({
            mobileContainer:
                "/var/mobile/Containers/Data/Application/ABC-123/Documents",
        });

        expect(report).not.toContain("alice");
        expect(report).not.toContain("ABC-123");
        expect(report).toContain("/home/<user>/Vault");
        expect(report).toContain("/Users/<user>/Projects");
        expect(report).toContain(
            "/var/mobile/Containers/Data/Application/<app>/Documents"
        );
        expect(report).toContain("[circular reference]");
    });

    it("falls back to memory when persistent storage is unavailable", () => {
        const storage: DiagnosticStorage = {
            getItem: () => {
                throw new Error("storage disabled");
            },
            setItem: () => {
                throw new Error("storage disabled");
            },
            removeItem: () => {
                throw new Error("storage disabled");
            },
        };

        const logger = new DiagnosticLogger(storage, {
            now: fixedNow,
            sessionId: "memory-only",
        });
        logger.info("still-recorded");

        expect(logger.persistence).toBe("memory");
        expect(logger.getEntries().map(({ event }) => event)).toEqual([
            "still-recorded",
        ]);
    });

    it("recovers persistent logging from a malformed prior payload", () => {
        const storage = new MemoryDiagnosticStorage();
        const seed = new DiagnosticLogger(storage, {
            now: fixedNow,
            sessionId: "seed",
        });
        seed.info("seed-entry");
        const [storageKey] = storage.values.keys();
        storage.values.set(storageKey, "{malformed");

        const recovered = new DiagnosticLogger(storage, {
            now: fixedNow,
            sessionId: "recovered",
        });
        recovered.info("new-entry");

        expect(recovered.persistence).toBe("local-storage");
        expect(recovered.getEntries().map(({ event }) => event)).toEqual([
            "new-entry",
        ]);
        expect(storage.values.get(storageKey)).toContain("new-entry");
    });

    it("clears persisted entries without affecting future logging", () => {
        const storage = new MemoryDiagnosticStorage();
        const logger = new DiagnosticLogger(storage, {
            now: fixedNow,
            sessionId: "clearable",
        });
        logger.info("before-clear");

        logger.clear();
        logger.info("after-clear");

        expect(logger.getEntries().map(({ event }) => event)).toEqual([
            "after-clear",
        ]);
        const reloaded = new DiagnosticLogger(storage, {
            now: fixedNow,
            sessionId: "reloaded",
        });
        expect(reloaded.getEntries().map(({ event }) => event)).toEqual([
            "after-clear",
        ]);
    });
});
