import type { OFCEvent } from "../types";

export interface LocalEventSource {
    sourceId: string;
    directory: string;
}

export interface LocalEventFile {
    path: string;
}

/** Read-only boundary used by the shadow index. */
export interface LocalEventReadAdapter {
    listFiles(): readonly LocalEventFile[] | Promise<readonly LocalEventFile[]>;
    readEvent(path: string): Promise<OFCEvent | null>;
}

export interface LocalEventRecord {
    kind: "local";
    id: string;
    path: string;
    sourceId: string;
    event: OFCEvent;
}

export interface LocalEventIndexSnapshot {
    epoch: number;
    revision: number;
    source: LocalEventSource | null;
    recordsById: ReadonlyMap<string, LocalEventRecord>;
    idByPath: ReadonlyMap<string, string>;
}

export type LocalEventIndexApplyResult = "applied" | "stale";

const cloneEvent = (event: OFCEvent): OFCEvent =>
    JSON.parse(JSON.stringify(event)) as OFCEvent;

const cloneRecord = (record: LocalEventRecord): LocalEventRecord => ({
    ...record,
    event: cloneEvent(record.event),
});

const normalizedDirectory = (directory: string): string =>
    directory.replace(/^\/+|\/+$/g, "");

export const isDirectChildMarkdownPath = (
    directory: string,
    path: string
): boolean => {
    if (!path || path.startsWith("/") || !/\.md$/i.test(path)) {
        return false;
    }
    const normalized = normalizedDirectory(directory);
    if (!normalized) {
        return !path.includes("/");
    }
    const prefix = `${normalized}/`;
    if (!path.startsWith(prefix)) {
        return false;
    }
    const relativePath = path.slice(prefix.length);
    return relativePath.length > 0 && !relativePath.includes("/");
};

/** Collision-safe deterministic ID for the configured source/path tuple. */
export const localEventRecordId = (sourceId: string, path: string): string =>
    `local-event:${encodeURIComponent(sourceId)}:${encodeURIComponent(path)}`;

/**
 * Read-only shadow index for exactly one configured local source.
 *
 * No production listener or cache uses this class in Phase 8A. Reads build an
 * off-side snapshot and publish only when their source epoch and request tokens
 * are still current.
 */
export class LocalEventIndex {
    private source: LocalEventSource | null;
    private records = new Map<string, LocalEventRecord>();
    private paths = new Map<string, string>();
    private currentEpoch = 0;
    private currentRevision = 0;
    private requestSequence = 0;
    private latestSnapshotRequest = 0;
    private latestMutationRequest = 0;
    private pathRequestTokens = new Map<string, number>();

    constructor(source: LocalEventSource | null) {
        this.source = source ? { ...source } : null;
    }

    get recordsById(): ReadonlyMap<string, LocalEventRecord> {
        return new Map(
            [...this.records].map(([id, record]) => [id, cloneRecord(record)])
        );
    }

    get idByPath(): ReadonlyMap<string, string> {
        return new Map(this.paths);
    }

    get epoch(): number {
        return this.currentEpoch;
    }

    get revision(): number {
        return this.currentRevision;
    }

    get snapshot(): LocalEventIndexSnapshot {
        return {
            epoch: this.currentEpoch,
            revision: this.currentRevision,
            source: this.source ? { ...this.source } : null,
            recordsById: this.recordsById,
            idByPath: this.idByPath,
        };
    }

    reset(source: LocalEventSource | null): void {
        this.currentEpoch += 1;
        this.requestSequence += 1;
        this.latestSnapshotRequest = this.requestSequence;
        this.latestMutationRequest = this.requestSequence;
        this.pathRequestTokens.clear();
        this.source = source ? { ...source } : null;
        this.records.clear();
        this.paths.clear();
        this.currentRevision += 1;
        this.assertInvariants();
    }

    async populate(
        adapter: LocalEventReadAdapter
    ): Promise<LocalEventIndexApplyResult> {
        const source = this.source ? { ...this.source } : null;
        const epoch = this.currentEpoch;
        const request = ++this.requestSequence;
        this.latestSnapshotRequest = request;

        let parsed: Array<{ path: string; event: OFCEvent | null }> = [];
        try {
            const files = source ? await adapter.listFiles() : [];
            const ownedPaths = files
                .map(({ path }) => path)
                .filter((path) =>
                    source
                        ? isDirectChildMarkdownPath(source.directory, path)
                        : false
                )
                .sort((left, right) => left.localeCompare(right));
            if (new Set(ownedPaths).size !== ownedPaths.length) {
                throw new Error("Duplicate path returned by local event scan.");
            }

            parsed = source
                ? await Promise.all(
                      ownedPaths.map(async (path) => ({
                          path,
                          event: await adapter.readEvent(path),
                      }))
                  )
                : [];
        } catch (error) {
            if (this.snapshotRequestIsCurrent(epoch, request)) {
                throw error;
            }
            return "stale";
        }

        if (!this.snapshotRequestIsCurrent(epoch, request)) {
            return "stale";
        }

        const records = new Map<string, LocalEventRecord>();
        const paths = new Map<string, string>();
        if (source) {
            for (const { path, event } of parsed) {
                if (!event) {
                    continue;
                }
                const id = localEventRecordId(source.sourceId, path);
                if (records.has(id)) {
                    throw new Error(`Duplicate local event ID: ${id}`);
                }
                records.set(id, {
                    kind: "local",
                    id,
                    path,
                    sourceId: source.sourceId,
                    event: cloneEvent(event),
                });
                paths.set(path, id);
            }
        }

        this.records = records;
        this.paths = paths;
        this.currentRevision += 1;
        this.assertInvariants();
        return "applied";
    }

    async refresh(
        path: string,
        adapter: LocalEventReadAdapter
    ): Promise<LocalEventIndexApplyResult> {
        const source = this.source ? { ...this.source } : null;
        if (!source || !isDirectChildMarkdownPath(source.directory, path)) {
            return "applied";
        }
        const epoch = this.currentEpoch;
        const request = ++this.requestSequence;
        this.latestMutationRequest = request;
        this.pathRequestTokens.set(path, request);

        let event: OFCEvent | null;
        try {
            event = await adapter.readEvent(path);
        } catch (error) {
            if (this.requestIsCurrent(epoch, path, request)) {
                throw error;
            }
            return "stale";
        }
        if (!this.requestIsCurrent(epoch, path, request)) {
            return "stale";
        }

        this.removePath(path);
        if (event) {
            const id = localEventRecordId(source.sourceId, path);
            this.records.set(id, {
                kind: "local",
                id,
                path,
                sourceId: source.sourceId,
                event: cloneEvent(event),
            });
            this.paths.set(path, id);
        }
        this.currentRevision += 1;
        this.assertInvariants();
        return "applied";
    }

    async rename(
        oldPath: string,
        newPath: string,
        adapter: LocalEventReadAdapter
    ): Promise<LocalEventIndexApplyResult> {
        this.deletePath(oldPath);
        return this.refresh(newPath, adapter);
    }

    deletePath(path: string): boolean {
        if (
            !this.source ||
            !isDirectChildMarkdownPath(this.source.directory, path)
        ) {
            return false;
        }
        const request = ++this.requestSequence;
        this.latestMutationRequest = request;
        this.pathRequestTokens.set(path, request);
        const removed = this.removePath(path);
        if (removed) {
            this.currentRevision += 1;
            this.assertInvariants();
        }
        return removed;
    }

    assertInvariants(): void {
        if (this.records.size !== this.paths.size) {
            throw new Error("Local event record/path index sizes differ.");
        }
        if (!this.source && this.records.size > 0) {
            throw new Error("Local event records exist without a source.");
        }
        for (const [id, record] of this.records) {
            if (
                id !== record.id ||
                !this.source ||
                record.sourceId !== this.source.sourceId ||
                !isDirectChildMarkdownPath(
                    this.source.directory,
                    record.path
                ) ||
                id !== localEventRecordId(record.sourceId, record.path) ||
                this.paths.get(record.path) !== id
            ) {
                throw new Error(`Invalid local event record invariant: ${id}`);
            }
        }
        for (const [path, id] of this.paths) {
            if (this.records.get(id)?.path !== path) {
                throw new Error(`Invalid local path index invariant: ${path}`);
            }
        }
    }

    private requestIsCurrent(
        epoch: number,
        path: string,
        request: number
    ): boolean {
        return (
            epoch === this.currentEpoch &&
            this.pathRequestTokens.get(path) === request &&
            this.latestSnapshotRequest <= request
        );
    }

    private snapshotRequestIsCurrent(epoch: number, request: number): boolean {
        return (
            epoch === this.currentEpoch &&
            request === this.latestSnapshotRequest &&
            this.latestMutationRequest <= request
        );
    }

    private removePath(path: string): boolean {
        const id = this.paths.get(path);
        if (!id) {
            return false;
        }
        this.paths.delete(path);
        this.records.delete(id);
        return true;
    }
}
