import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("./styles/default.css", () => ({}));

vi.mock("./editor", () => ({
    createEditor: vi.fn(),
    exportSchema: vi.fn(() => ({ type: "object" })),
    loadSchema: vi.fn().mockResolvedValue(undefined),
}));

describe("main", () => {
    let mockPostMessage: ReturnType<typeof vi.fn>;
    let messageListener: ((event: any) => void) | undefined;

    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        messageListener = undefined;
        mockPostMessage = vi.fn();

        vi.stubGlobal(
            "acquireVsCodeApi",
            vi.fn(() => ({
                postMessage: mockPostMessage,
                getState: vi.fn(),
                setState: vi.fn(),
            })),
        );

        vi.stubGlobal("window", {
            onload: null as any,
            addEventListener: vi.fn((type: string, handler: Function) => {
                if (type === "message") {
                    messageListener = handler as (event: any) => void;
                }
            }),
        });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("should acquire VS Code API on import", async () => {
        await import("./main");
        expect(globalThis.acquireVsCodeApi).toHaveBeenCalledOnce();
    });

    it("should set window.onload handler", async () => {
        await import("./main");
        expect(window.onload).toBeTypeOf("function");
    });

    it("should request formSchema on load", async () => {
        await import("./main");

        const loadPromise = (window.onload as Function).call(window);

        expect(mockPostMessage).toHaveBeenCalledWith({
            type: "getFormSchema",
        });

        // Resolve promise to avoid hanging
        messageListener!({
            data: { type: "formSchema", content: "{}" },
        });
        await loadPromise;
    });

    it("should add message event listener on load", async () => {
        await import("./main");

        const loadPromise = (window.onload as Function).call(window);

        expect(window.addEventListener).toHaveBeenCalledWith("message", expect.any(Function));

        messageListener!({
            data: { type: "formSchema", content: "{}" },
        });
        await loadPromise;
    });

    it("should initialize editor on receiving formSchema", async () => {
        const editorModule = await import("./editor");
        await import("./main");

        const loadPromise = (window.onload as Function).call(window);

        messageListener!({
            data: {
                type: "formSchema",
                content: '{"type":"object"}',
            },
        });
        await loadPromise;

        expect(editorModule.createEditor).toHaveBeenCalledWith(
            '{"type":"object"}',
            expect.any(Function),
        );
    });

    it("should send syncDocument when schema changes", async () => {
        const editorModule = await import("./editor");
        await import("./main");

        const loadPromise = (window.onload as Function).call(window);

        messageListener!({
            data: { type: "formSchema", content: "{}" },
        });
        await loadPromise;

        // Get the callback passed to createEditor
        const schemaChangeCb = vi.mocked(editorModule.createEditor).mock.calls[0][1] as Function;

        mockPostMessage.mockClear();
        await schemaChangeCb();

        expect(mockPostMessage).toHaveBeenCalledWith({
            type: "syncDocument",
            content: JSON.stringify({ type: "object" }, null, 4),
        });
    });

    it("should debounce subsequent schema updates", async () => {
        vi.useFakeTimers();

        const editorModule = await import("./editor");
        await import("./main");

        const loadPromise = (window.onload as Function).call(window);

        messageListener!({
            data: {
                type: "formSchema",
                content: '{"initial":true}',
            },
        });
        await loadPromise;

        // Send multiple rapid updates
        messageListener!({
            data: {
                type: "formSchema",
                content: '{"update":1}',
            },
        });
        messageListener!({
            data: {
                type: "formSchema",
                content: '{"update":2}',
            },
        });
        messageListener!({
            data: {
                type: "formSchema",
                content: '{"update":3}',
            },
        });

        await vi.advanceTimersByTimeAsync(200);

        expect(editorModule.loadSchema).toHaveBeenCalledTimes(1);
        expect(editorModule.loadSchema).toHaveBeenCalledWith('{"update":3}');

        vi.useRealTimers();
    });

    it("should handle unknown message types gracefully", async () => {
        await import("./main");

        const loadPromise = (window.onload as Function).call(window);

        messageListener!({
            data: { type: "formSchema", content: "{}" },
        });
        await loadPromise;

        // Should not throw for unknown types
        messageListener!({
            data: { type: "unknownType" },
        });
    });

    it("should handle editor initialization errors gracefully", async () => {
        const editorModule = await import("./editor");
        vi.mocked(editorModule.createEditor).mockImplementation(() => {
            throw new Error("Test init error");
        });

        const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

        await import("./main");

        const loadPromise = (window.onload as Function).call(window);

        messageListener!({
            data: { type: "formSchema", content: "{}" },
        });
        await loadPromise;

        expect(consoleSpy).toHaveBeenCalledWith("Unable to open schema: Test init error");

        consoleSpy.mockRestore();
    });

    it("should warn when loadSchema rejects", async () => {
        vi.useFakeTimers();

        const editorModule = await import("./editor");
        vi.mocked(editorModule.loadSchema).mockRejectedValue({
            warnings: ["some warning"],
        });

        const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

        await import("./main");

        const loadPromise = (window.onload as Function).call(window);

        messageListener!({
            data: { type: "formSchema", content: "{}" },
        });
        await loadPromise;

        // Trigger debounced update
        messageListener!({
            data: {
                type: "formSchema",
                content: '{"update":true}',
            },
        });

        await vi.advanceTimersByTimeAsync(200);

        expect(consoleSpy).toHaveBeenCalledWith("Schema loaded with warnings: some warning");

        consoleSpy.mockRestore();
        vi.useRealTimers();
    });

    it("should not load schema when content is empty", async () => {
        vi.useFakeTimers();

        const editorModule = await import("./editor");
        await import("./main");

        const loadPromise = (window.onload as Function).call(window);

        messageListener!({
            data: {
                type: "formSchema",
                content: '{"init":true}',
            },
        });
        await loadPromise;

        // Send empty content
        messageListener!({
            data: { type: "formSchema", content: "" },
        });

        await vi.advanceTimersByTimeAsync(200);

        expect(editorModule.loadSchema).not.toHaveBeenCalled();

        vi.useRealTimers();
    });
});
