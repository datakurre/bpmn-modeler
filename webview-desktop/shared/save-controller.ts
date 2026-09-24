export interface SaveState {
    filePath: string | null;
    dirty: boolean;
    hasBeenSaved: boolean;
}

export interface SaveControllerCallbacks {
    /** Serialize the current editor content for writing to disk. */
    exportContent: () => Promise<string>;
    /** Write `content` to the already-known saved path. Rejecting leaves the controller's state unchanged. */
    writeDocument: (content: string) => Promise<void>;
    /**
     * Prompt the user for a path (the document has never been saved),
     * write `content` to it, and resolve the chosen path — or `null` if the
     * user canceled. The path is picked and written on the same side of the
     * IPC boundary (the backend), so a compromised webview never gets to
     * name an arbitrary path here.
     */
    saveAs: (content: string) => Promise<string | null>;
    /** Called after every state change (a dirtying edit, or a save's outcome). */
    onStateChange: (state: SaveState) => void;
}

/**
 * Coordinates saving a single document: tracks whether edits made during an
 * in-flight write are still unsaved once it completes, and serializes
 * concurrent save() calls so a double Ctrl+S can't open two path dialogs or
 * run two overlapping writes.
 */
export class SaveController {
    private filePath: string | null;
    private hasBeenSaved: boolean;
    private dirty = false;
    private changeGeneration = 0;
    private inFlight: Promise<void> | null = null;
    private queued: Promise<void> | null = null;

    constructor(
        private readonly callbacks: SaveControllerCallbacks,
        initial: { filePath: string | null; hasBeenSaved: boolean },
    ) {
        this.filePath = initial.filePath;
        this.hasBeenSaved = initial.hasBeenSaved;
    }

    getState(): SaveState {
        return { filePath: this.filePath, dirty: this.dirty, hasBeenSaved: this.hasBeenSaved };
    }

    /**
     * Hydrate the known file path once it's loaded asynchronously (e.g. from
     * `get_tab_document`), without treating it as a save or notifying
     * listeners.
     */
    setKnownFile(filePath: string | null, hasBeenSaved: boolean): void {
        this.filePath = filePath;
        this.hasBeenSaved = hasBeenSaved;
    }

    /** Record that the document changed, e.g. from a command-stack event. */
    markDirty(): void {
        this.changeGeneration += 1;
        this.dirty = true;
        this.callbacks.onStateChange(this.getState());
    }

    /**
     * Save the document. If a save is already running, this queues exactly
     * one follow-up save (further overlapping calls join that same queued
     * save) instead of starting a second write immediately.
     */
    save(): Promise<void> {
        if (this.inFlight) {
            if (!this.queued) {
                this.queued = this.inFlight
                    .catch(() => {})
                    .then(() => {
                        this.queued = null;
                        return this.runSave();
                    });
            }
            return this.queued;
        }
        return this.runSave();
    }

    private runSave(): Promise<void> {
        this.inFlight = this.performSave().finally(() => {
            this.inFlight = null;
        });
        return this.inFlight;
    }

    private async performSave(): Promise<void> {
        const savedGeneration = this.changeGeneration;
        const content = await this.callbacks.exportContent();

        if (this.filePath) {
            await this.callbacks.writeDocument(content);
        } else {
            const path = await this.callbacks.saveAs(content);
            if (!path) return;
            this.filePath = path;
        }

        this.hasBeenSaved = true;
        this.dirty = this.changeGeneration !== savedGeneration;
        this.callbacks.onStateChange(this.getState());
    }
}
