export type DiagnosticLevel = "info" | "warning" | "error";

export type DiagnosticValue =
    | null
    | boolean
    | number
    | string
    | DiagnosticValue[]
    | { [key: string]: DiagnosticValue };

export interface DiagnosticEntry {
    timestamp: string;
    sessionId: string;
    level: DiagnosticLevel;
    event: string;
    details?: DiagnosticValue;
}

export interface DiagnosticStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}

export interface DiagnosticLoggerOptions {
    maxEntries?: number;
    maxSerializedCharacters?: number;
    now?: () => Date;
    sessionId?: string;
}

const DIAGNOSTIC_STORAGE_KEY = "keyboard-calendar.diagnostics.v1";
const REPORT_VERSION = 1;
const DEFAULT_MAX_ENTRIES = 160;
const DEFAULT_MAX_SERIALIZED_CHARACTERS = 192_000;
const MAX_ARRAY_ITEMS = 50;
const MAX_OBJECT_KEYS = 50;
const MAX_VALUE_DEPTH = 8;
const MAX_STRING_LENGTH = 4_000;

const redactPrivatePaths = (value: string): string =>
    value
        .replace(/\/(Users|home)\/[^/\\\s)]+/g, "/$1/<user>")
        .replace(
            /\/var\/mobile\/Containers\/Data\/Application\/[^/\\\s)]+/g,
            "/var/mobile/Containers/Data/Application/<app>"
        )
        .replace(/[A-Za-z]:\\Users\\[^\\\s)]+/gi, "<user-home>");

const sanitizeString = (value: string): string => {
    const redacted = redactPrivatePaths(value);
    return redacted.length <= MAX_STRING_LENGTH
        ? redacted
        : `${redacted.slice(0, MAX_STRING_LENGTH)}…[truncated]`;
};

const sanitizeDiagnosticValue = (
    value: unknown,
    depth = 0,
    seen: Set<object> = new Set()
): DiagnosticValue => {
    if (value === null || value === undefined) {
        return null;
    }
    if (typeof value === "string") {
        return sanitizeString(value);
    }
    if (typeof value === "boolean") {
        return value;
    }
    if (typeof value === "number") {
        return Number.isFinite(value) ? value : String(value);
    }
    if (typeof value === "bigint") {
        return value.toString();
    }
    if (typeof value === "function") {
        return `[function ${value.name || "anonymous"}]`;
    }
    if (typeof value === "symbol") {
        return value.toString();
    }
    if (value instanceof Date) {
        return Number.isNaN(value.getTime())
            ? "Invalid Date"
            : value.toISOString();
    }
    if (depth >= MAX_VALUE_DEPTH) {
        return "[maximum depth reached]";
    }
    if (value === null || typeof value !== "object") {
        return sanitizeString(String(value));
    }
    const objectValue = value as object;
    if (seen.has(objectValue)) {
        return "[circular reference]";
    }

    seen.add(objectValue);
    try {
        if (objectValue instanceof Error) {
            const cause = (objectValue as Error & { cause?: unknown }).cause;
            return {
                name: sanitizeString(objectValue.name),
                message: sanitizeString(objectValue.message),
                ...(objectValue.stack
                    ? { stack: sanitizeString(objectValue.stack) }
                    : {}),
                ...(cause === undefined
                    ? {}
                    : {
                          cause: sanitizeDiagnosticValue(
                              cause,
                              depth + 1,
                              seen
                          ),
                      }),
            };
        }
        if (Array.isArray(objectValue)) {
            const items = objectValue
                .slice(0, MAX_ARRAY_ITEMS)
                .map((item) => sanitizeDiagnosticValue(item, depth + 1, seen));
            if (objectValue.length > MAX_ARRAY_ITEMS) {
                items.push(
                    `[${objectValue.length - MAX_ARRAY_ITEMS} more items]`
                );
            }
            return items;
        }

        const result: { [key: string]: DiagnosticValue } = {};
        const keys = Object.keys(objectValue).slice(0, MAX_OBJECT_KEYS);
        for (const key of keys) {
            try {
                result[key] = sanitizeDiagnosticValue(
                    (objectValue as Record<string, unknown>)[key],
                    depth + 1,
                    seen
                );
            } catch (error) {
                result[key] = `[unreadable: ${
                    error instanceof Error ? error.message : String(error)
                }]`;
            }
        }
        if (Object.keys(objectValue).length > MAX_OBJECT_KEYS) {
            result.__truncatedKeys =
                Object.keys(objectValue).length - MAX_OBJECT_KEYS;
        }
        return result;
    } finally {
        seen.delete(objectValue);
    }
};

const isDiagnosticEntry = (value: unknown): value is DiagnosticEntry => {
    if (!value || typeof value !== "object") {
        return false;
    }
    const candidate = value as Partial<DiagnosticEntry>;
    return (
        typeof candidate.timestamp === "string" &&
        typeof candidate.sessionId === "string" &&
        (candidate.level === "info" ||
            candidate.level === "warning" ||
            candidate.level === "error") &&
        typeof candidate.event === "string"
    );
};

/**
 * A small, synchronous log designed to survive a mobile WebView/plugin reload.
 * Entries are bounded and intentionally contain only explicitly supplied data.
 */
export class DiagnosticLogger {
    readonly sessionId: string;
    private readonly now: () => Date;
    private readonly maxEntries: number;
    private readonly maxSerializedCharacters: number;
    private entries: DiagnosticEntry[] = [];
    private storage: DiagnosticStorage | null;

    constructor(
        storage: DiagnosticStorage | null,
        options: DiagnosticLoggerOptions = {}
    ) {
        this.storage = storage;
        this.now = options.now || (() => new Date());
        this.maxEntries = Math.max(
            1,
            options.maxEntries || DEFAULT_MAX_ENTRIES
        );
        this.maxSerializedCharacters = Math.max(
            1_000,
            options.maxSerializedCharacters || DEFAULT_MAX_SERIALIZED_CHARACTERS
        );
        this.sessionId =
            options.sessionId ||
            `${this.now().toISOString()}-${Math.random()
                .toString(36)
                .slice(2, 8)}`;
        this.loadPersistedEntries();
    }

    get persistence(): "local-storage" | "memory" {
        return this.storage ? "local-storage" : "memory";
    }

    get entryCount(): number {
        return this.entries.length;
    }

    info(event: string, details?: unknown): void {
        this.record("info", event, details);
    }

    warning(event: string, details?: unknown): void {
        this.record("warning", event, details);
    }

    error(
        event: string,
        error: unknown,
        details: Record<string, unknown> = {}
    ): void {
        this.record("error", event, { ...details, error });
    }

    clear(): void {
        this.entries = [];
        if (!this.storage) {
            return;
        }
        try {
            this.storage.removeItem(DIAGNOSTIC_STORAGE_KEY);
        } catch (_error) {
            this.storage = null;
        }
    }

    createReport(context: unknown): string {
        return JSON.stringify(
            {
                reportVersion: REPORT_VERSION,
                generatedAt: this.now().toISOString(),
                currentSessionId: this.sessionId,
                persistence: this.persistence,
                context: sanitizeDiagnosticValue(context),
                entries: this.entries,
            },
            null,
            2
        );
    }

    /** Returns a detached copy for tests and diagnostic UI. */
    getEntries(): DiagnosticEntry[] {
        return JSON.parse(JSON.stringify(this.entries)) as DiagnosticEntry[];
    }

    private record(
        level: DiagnosticLevel,
        event: string,
        details?: unknown
    ): void {
        try {
            this.entries.push({
                timestamp: this.now().toISOString(),
                sessionId: this.sessionId,
                level,
                event: sanitizeString(event),
                ...(details === undefined
                    ? {}
                    : { details: sanitizeDiagnosticValue(details) }),
            });
            if (this.entries.length > this.maxEntries) {
                this.entries.splice(0, this.entries.length - this.maxEntries);
            }
            this.persist();
        } catch (_error) {
            // Diagnostics must never be capable of breaking the plugin.
        }
    }

    private loadPersistedEntries(): void {
        if (!this.storage) {
            return;
        }
        let serialized: string | null;
        try {
            serialized = this.storage.getItem(DIAGNOSTIC_STORAGE_KEY);
        } catch (_error) {
            this.storage = null;
            return;
        }
        if (!serialized) {
            return;
        }
        try {
            const parsed = JSON.parse(serialized) as {
                entries?: unknown;
            };
            if (Array.isArray(parsed.entries)) {
                this.entries = parsed.entries
                    .filter(isDiagnosticEntry)
                    .slice(-this.maxEntries)
                    .map((entry) => ({
                        timestamp: sanitizeString(entry.timestamp),
                        sessionId: sanitizeString(entry.sessionId),
                        level: entry.level,
                        event: sanitizeString(entry.event),
                        ...(entry.details === undefined
                            ? {}
                            : {
                                  details: sanitizeDiagnosticValue(
                                      entry.details
                                  ),
                              }),
                    }));
            }
        } catch (_error) {
            this.entries = [];
            try {
                this.storage.removeItem(DIAGNOSTIC_STORAGE_KEY);
            } catch (_storageError) {
                this.storage = null;
            }
        }
    }

    private persist(): void {
        if (!this.storage) {
            return;
        }
        try {
            let serialized = JSON.stringify({
                version: REPORT_VERSION,
                entries: this.entries,
            });
            while (
                serialized.length > this.maxSerializedCharacters &&
                this.entries.length > 1
            ) {
                this.entries.shift();
                serialized = JSON.stringify({
                    version: REPORT_VERSION,
                    entries: this.entries,
                });
            }
            this.storage.setItem(DIAGNOSTIC_STORAGE_KEY, serialized);
        } catch (_error) {
            this.storage = null;
        }
    }
}

export const getBrowserDiagnosticStorage = (): DiagnosticStorage | null => {
    if (typeof window === "undefined") {
        return null;
    }
    try {
        return window.localStorage;
    } catch (_error) {
        return null;
    }
};
