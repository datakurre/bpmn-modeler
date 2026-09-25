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
 * concurrent save() calls — via one `pending` chain rather than separate
 * in-flight/queued promises, so there's no window where a call in between
 * would see nothing pending and start an overlapping write — so a double
 * Ctrl+S can't open two path dialogs or run two overlapping writes. A
 * follow-up save queued behind one that's already covered everything (or
 * whose Save As dialog was cancelled) is dropped rather than run.
 */
export class SaveController {
    private filePath: string | null;
    private hasBeenSaved: boolean;
    private dirty = false;
    private changeGeneration = 0;

    /** Non-null from the moment a save is requested until the last save
     * queued behind it (if any) has finished — so a call arriving at any
     * point in between always joins this instead of starting a fresh write. */
    private pending: Promise<void> | null = null;
    /** True once a follow-up save has been queued behind the current one. */
    private followUpQueued = false;
    /** Set when a Save As dialog is cancelled, so a queued follow-up (which
     * would just reopen the same dialog) is dropped instead of run. */
    private dropQueuedFollowUp = false;

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

    /**
     * Record that the document changed, e.g. from a command-stack event.
     * `changeGeneration` advances on every call (that's what a save's dirty
     * computation compares against), but `onStateChange` — which triggers an
     * `update_tab_state` IPC round trip in every editor — only fires on the
     * clean-to-dirty transition, since later edits before the next save
     * don't change what the tab's dirty flag should show.
     */
    markDirty(): void {
        this.changeGeneration += 1;
        const wasDirty = this.dirty;
        this.dirty = true;
        if (!wasDirty) {
            this.callbacks.onStateChange(this.getState());
        }
    }

    /**
     * Save the document. If a save is already running or queued, this joins
     * that same chain — queuing at most one follow-up — instead of starting
     * a second, possibly-overlapping write.
     */
    save(): Promise<void> {
        if (this.pending) {
            if (!this.followUpQueued) {
                this.followUpQueued = true;
                this.pending = this.pending.then(
                    () => this.runQueued(),
                    () => this.runQueued(),
                );
            }
            return this.pending;
        }

        this.pending = this.runGuarded();
        return this.pending;
    }

    private runGuarded(): Promise<void> {
        return this.performSave().finally(() => {
            if (!this.followUpQueued) {
                this.pending = null;
            }
        });
    }

    /**
     * Runs the one save queued behind the one that just finished — unless
     * that save already covered everything (nothing was dirty by the time
     * it finished) or its dialog was cancelled, in which case there's
     * nothing new to write and no dialog to reopen.
     */
    private runQueued(): Promise<void> {
        this.followUpQueued = false;

        if (this.dropQueuedFollowUp) {
            this.dropQueuedFollowUp = false;
            this.pending = null;
            return Promise.resolve();
        }

        if (!this.dirty) {
            this.pending = null;
            return Promise.resolve();
        }

        return this.runGuarded();
    }

    private async performSave(): Promise<void> {
        const savedGeneration = this.changeGeneration;
        const content = await this.callbacks.exportContent();

        if (this.filePath) {
            await this.callbacks.writeDocument(content);
        } else {
            const path = await this.callbacks.saveAs(content);
            if (!path) {
                // Cancelling the dialog once almost always means "not now"
                // for a queued follow-up too, which would otherwise reopen
                // the very same dialog immediately.
                this.dropQueuedFollowUp = true;
                return;
            }
            this.filePath = path;
        }

        this.hasBeenSaved = true;
        this.dirty = this.changeGeneration !== savedGeneration;
        this.callbacks.onStateChange(this.getState());
    }
}
