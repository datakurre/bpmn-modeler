/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from "vitest";

// Mock requestAnimationFrame for the decorator constructor
vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
    cb(0);
    return 0;
});

describe("script-editor/index", () => {
    it("should export ScriptTextareaDecorator class", async () => {
        const module = await import("./index");
        expect(module.ScriptTextareaDecorator).toBeDefined();
        expect(module.ScriptTextareaDecorator.$inject).toEqual([
            "eventBus",
            "elementRegistry",
            "commandStack",
        ]);
    });

    it("should export ScriptEditorModule descriptor", async () => {
        const module = await import("./index");
        expect(module.ScriptEditorModule).toBeDefined();
        expect(module.ScriptEditorModule.__init__).toContain("scriptTextareaDecorator");
    });

    it("should register decorator in module descriptor", async () => {
        const module = await import("./index");
        const mod = module.ScriptEditorModule;

        expect(mod.scriptTextareaDecorator).toEqual(["type", module.ScriptTextareaDecorator]);
    });
});
