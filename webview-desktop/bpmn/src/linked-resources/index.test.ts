import { describe, it, expect } from "vitest";

describe("linked-resources/index", () => {
    it("should export LinkedResourceOverlays class", async () => {
        const module = await import("./index");
        expect(module.LinkedResourceOverlays).toBeDefined();
        expect(module.LinkedResourceOverlays.$inject).toEqual(["overlays", "eventBus"]);
    });

    it("should export LinkedResourceOverlaysModule descriptor", async () => {
        const module = await import("./index");
        expect(module.LinkedResourceOverlaysModule).toBeDefined();
        expect(module.LinkedResourceOverlaysModule.__init__).toContain("linkedResourceOverlays");
    });
});
