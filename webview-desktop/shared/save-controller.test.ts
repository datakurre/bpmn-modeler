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
                pickSavePath: async () => null,
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

    it("leaves dirty=false when nothing changes during the save", async () => {
        const controller = new SaveController(
            {
                exportContent: async () => "content",
                writeDocument: async () => {},
                pickSavePath: async () => null,
                onStateChange: () => {},
            },
            { filePath: "/tmp/doc.bpmn", hasBeenSaved: true },
        );

        controller.markDirty();
        await controller.save();

        expect(controller.getState().dirty).toBe(false);
    });

    it("runs at most one path dialog and no overlapping writes for two quick saves", async () => {
        const pickSavePath = vi.fn(async () => "/tmp/new.bpmn");
        const write = deferred<void>();
        const writeDocument = vi.fn(() => write.promise);
        let concurrentWrites = 0;
        let maxConcurrentWrites = 0;
        const trackedWrite = vi.fn(async (path: string, content: string) => {
            concurrentWrites += 1;
            maxConcurrentWrites = Math.max(maxConcurrentWrites, concurrentWrites);
            await writeDocument(path, content);
            concurrentWrites -= 1;
        });

        const controller = new SaveController(
            {
                exportContent: async () => "content",
                writeDocument: trackedWrite,
                pickSavePath,
                onStateChange: () => {},
            },
            { filePath: null, hasBeenSaved: false },
        );

        const first = controller.save();
        const second = controller.save();

        write.resolve();
        await Promise.all([first, second]);

        expect(pickSavePath).toHaveBeenCalledTimes(1);
        expect(maxConcurrentWrites).toBeLessThanOrEqual(1);
    });

    it("leaves dirty and filePath unchanged when the write fails", async () => {
        const states: SaveState[] = [];
        const controller = new SaveController(
            {
                exportContent: async () => "content",
                writeDocument: async () => {
                    throw new Error("disk full");
                },
                pickSavePath: async () => "/tmp/new.bpmn",
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
});
