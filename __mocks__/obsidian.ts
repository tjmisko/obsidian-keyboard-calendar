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

export class MarkdownView {
    editor: any;
    file: TFile | null = null;
    editMode?: any;

    constructor(editor: any = {}) {
        this.editor = editor;
    }

    async save(): Promise<void> {}
}

export class Modal {
    app: any;
    containerEl: any = {};
    modalEl: any = {};
    contentEl: any = {};

    constructor(app: any) {
        this.app = app;
    }

    open(): void {
        this.onOpen();
    }

    close(): void {
        this.onClose();
    }

    onOpen(): void {}

    onClose(): void {}
}

export function parseYaml(yaml: string): Record<string, string> | null {
    const [k, ...v] = yaml.split(":");
    if (!k || !v) {
        return null;
    }
    return Object.fromEntries([[k.trim(), v.join(":").trim()]]);
}

export class Notice {
    static notices: string[] = [];

    constructor(message: string) {
        Notice.notices.push(message);
    }
}
