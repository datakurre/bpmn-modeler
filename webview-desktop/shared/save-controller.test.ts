import { describe, it, expect, vi } from "vitest";
import { SaveController, type SaveState } from "./save-controller";

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

describe("SaveController", () => {
    it("keeps dirty=true when a change happens while the write is pending", async () => {
        const states: SaveState[] = [];
        const write = deferred<void>();
        const controller = new SaveController(
            {
                exportContent: async () => "content-v1",
                writeDocument: () => write.promise,
                saveAs: async () => null,
                onStateChange: (s) => states.push(s),
            },
            { filePath: "/tmp/doc.bpmn", hasBeenSaved: true },
        );

        const savePromise = controller.save();
        controller.markDirty(); // edit made while the write is in flight
        write.resolve();
        await savePromise;

        expect(controller.getState().dirty).toBe(true);
    });

    it("only notifies onStateChange once across repeated markDirty calls while already dirty", () => {
        const states: SaveState[] = [];
        const controller = new SaveController(
            {
                exportContent: async () => "content",
                writeDocument: async () => {},
                saveAs: async () => null,
                onStateChange: (s) => states.push(s),
            },
            { filePath: "/tmp/doc.bpmn", hasBeenSaved: true },
        );

        controller.markDirty();
        controller.markDirty();
        controller.markDirty();

        expect(states).toHaveLength(1);
        expect(controller.getState().dirty).toBe(true);
    });

    it("leaves dirty=false when nothing changes during the save", async () => {
        const controller = new SaveController(
            {
                exportContent: async () => "content",
                writeDocument: async () => {},
                saveAs: async () => null,
                onStateChange: () => {},
            },
            { filePath: "/tmp/doc.bpmn", hasBeenSaved: true },
        );

        controller.markDirty();
        await controller.save();

        expect(controller.getState().dirty).toBe(false);
    });

    it("runs at most one Save As dialog and no overlapping writes for two quick saves", async () => {
        const write = deferred<void>();
        let concurrentWrites = 0;
        let maxConcurrentWrites = 0;
        const saveAs = vi.fn(async (_content: string) => {
            concurrentWrites += 1;
            maxConcurrentWrites = Math.max(maxConcurrentWrites, concurrentWrites);
            await write.promise;
            concurrentWrites -= 1;
            return "/tmp/new.bpmn";
        });

        const controller = new SaveController(
            {
                exportContent: async () => "content",
                writeDocument: async () => {},
                saveAs,
                onStateChange: () => {},
            },
            { filePath: null, hasBeenSaved: false },
        );

        const first = controller.save();
        const second = controller.save();

        write.resolve();
        await Promise.all([first, second]);

        expect(saveAs).toHaveBeenCalledTimes(1);
        expect(maxConcurrentWrites).toBeLessThanOrEqual(1);
    });

    it("runs a queued save that has new changes without ever overlapping the first write", async () => {
        const writes: string[] = [];
        let concurrentWrites = 0;
        let maxConcurrentWrites = 0;
        const firstWrite = deferred<void>();
        let call = 0;
        const writeDocument = vi.fn(async (content: string) => {
            concurrentWrites += 1;
            maxConcurrentWrites = Math.max(maxConcurrentWrites, concurrentWrites);
            writes.push(content);
            call += 1;
            if (call === 1) await firstWrite.promise;
            concurrentWrites -= 1;
        });

        const controller = new SaveController(
            {
                exportContent: async () => (call === 0 ? "v1" : "v2"),
                writeDocument,
                saveAs: async () => null,
                onStateChange: () => {},
            },
            { filePath: "/tmp/doc.bpmn", hasBeenSaved: true },
        );

        const first = controller.save();
        controller.markDirty(); // a real change queued behind the first save
        const second = controller.save();

        firstWrite.resolve();
        await Promise.all([first, second]);

        expect(writeDocument).toHaveBeenCalledTimes(2);
        expect(writes).toEqual(["v1", "v2"]);
        expect(maxConcurrentWrites).toBeLessThanOrEqual(1);
    });

    it("drops a queued follow-up instead of reopening a cancelled Save As dialog", async () => {
        const saveAs = vi.fn(async () => null);
        const controller = new SaveController(
            {
                exportContent: async () => "content",
                writeDocument: async () => {},
                saveAs,
                onStateChange: () => {},
            },
            { filePath: null, hasBeenSaved: false },
        );

        const first = controller.save();
        const second = controller.save();

        await Promise.all([first, second]);

        expect(saveAs).toHaveBeenCalledTimes(1);
        expect(controller.getState().filePath).toBeNull();
    });

    it("does not drop a later queued save after an earlier, unrelated Save As was cancelled", async () => {
        const saveDeferred = deferred<string | null>();
        let call = 0;
        const saveAs = vi.fn(async () => {
            call += 1;
            if (call === 1) return null; // first Ctrl+S: cancelled, nothing queued behind it
            return saveDeferred.promise; // second Ctrl+S: stays pending until resolved below
        });
        const writeDocument = vi.fn(async () => {});

        const controller = new SaveController(
            {
                exportContent: async () => "content",
                writeDocument,
                saveAs,
                onStateChange: () => {},
            },
            { filePath: null, hasBeenSaved: false },
        );

        // First Ctrl+S: cancelled, no follow-up queued behind it.
        await controller.save();

        // Second Ctrl+S: starts a Save As that stays pending...
        const second = controller.save();
        // ...an edit happens, and a third Ctrl+S queues a follow-up behind it.
        controller.markDirty();
        const third = controller.save();

        saveDeferred.resolve("/tmp/new.bpmn");
        await Promise.all([second, third]);

        expect(writeDocument).toHaveBeenCalledTimes(1);
        expect(controller.getState().dirty).toBe(false);
    });

    it("leaves dirty and filePath unchanged when saveAs fails", async () => {
        const states: SaveState[] = [];
        const controller = new SaveController(
            {
                exportContent: async () => "content",
                writeDocument: async () => {},
                saveAs: async () => {
                    throw new Error("disk full");
                },
                onStateChange: (s) => states.push(s),
            },
            { filePath: null, hasBeenSaved: false },
        );

        controller.markDirty();
        await expect(controller.save()).rejects.toThrow("disk full");

        const state = controller.getState();
        expect(state.filePath).toBeNull();
        expect(state.dirty).toBe(true);
        expect(state.hasBeenSaved).toBe(false);
    });

    it("leaves filePath and hasBeenSaved unchanged when writing to an already-saved file fails", async () => {
        const controller = new SaveController(
            {
                exportContent: async () => "content",
                writeDocument: async () => {
                    throw new Error("disk full");
                },
                saveAs: async () => "/tmp/new.bpmn",
                onStateChange: () => {},
            },
            { filePath: "/tmp/doc.bpmn", hasBeenSaved: true },
        );

        controller.markDirty();
        await expect(controller.save()).rejects.toThrow("disk full");

        const state = controller.getState();
        expect(state.filePath).toBe("/tmp/doc.bpmn");
        expect(state.dirty).toBe(true);
        expect(state.hasBeenSaved).toBe(true);
    });
});
