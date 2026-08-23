import { basename, extname, join as pathJoin } from "path";

/** Basic obsidian abstraction for any file or folder in a vault. */
export abstract class TAbstractFile {
    /**
     * @public
     */
    get path(): string {
        const parentPath = this.parent?.path || "";
        const path = pathJoin(parentPath, this.name);
        if (path.startsWith("/") && path.length > 1) {
            return path.slice(1);
        } else {
            return path;
        }
    }
    /**
     * @public
     */
    name: string = "";
    /**
     * @public
     */
    parent: TFolder | null = null;
}

/** A regular file in the vault. */
export class TFile extends TAbstractFile {
    get basename(): string {
        return basename(this.name, extname(this.name));
    }

    get extension(): string {
        const ext = extname(this.name);
        // Remove leading `.`
        if (ext.startsWith(".")) {
            return ext.slice(1);
        } else {
            return ext;
        }
    }
}

/** A folder in the vault. */
export class TFolder extends TAbstractFile {
    children: TAbstractFile[] = [];

    isRoot(): boolean {
        return this.path === "/";
    }
}

export function parseYaml(yaml: string): Record<string, unknown> | null {
    const result: Record<string, unknown> = {};
    const lines = yaml.split(/\r?\n/);
    const scalar = (raw: string): unknown => {
        const value = raw.trim();
        if (value === "null" || value === "~") return null;
        if (value === "true") return true;
        if (value === "false") return false;
        if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
        if (value.startsWith("[") && value.endsWith("]")) {
            const body = value.slice(1, -1).trim();
            return body ? body.split(",").map((item) => scalar(item)) : [];
        }
        return value.replace(/^(["'])(.*)\1$/, "$2");
    };
    for (let index = 0; index < lines.length; index += 1) {
        const match = /^([^\s][^:]*):\s*(.*)$/.exec(lines[index]);
        if (!match) continue;
        const [, key, rawValue] = match;
        if (rawValue) {
            result[key.trim()] = scalar(rawValue);
            continue;
        }
        const list: unknown[] = [];
        while (/^\s+-\s+/.test(lines[index + 1] || "")) {
            index += 1;
            list.push(scalar(lines[index].replace(/^\s+-\s+/, "")));
        }
        result[key.trim()] = list;
    }
    return Object.keys(result).length > 0 ? result : null;
}

export class Notice {
    static notices: string[] = [];

    constructor(message: string) {
        Notice.notices.push(message);
    }
}
