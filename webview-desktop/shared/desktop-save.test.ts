import { describe, it, expect, vi } from "vitest";
import { createDesktopSaveController } from "./desktop-save";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
    invoke: (...args: unknown[]) => invokeMock(...args),
}));

const reportTabDirtyMock = vi.fn();
vi.mock("./desktop-shell", () => ({
    reportTabDirty: (...args: unknown[]) => reportTabDirtyMock(...args),
}));

describe("createDesktopSaveController", () => {
    it("writes through write_document keyed by tabId once already saved", async () => {
        invokeMock.mockReset().mockResolvedValue(undefined);
        const controller = createDesktopSaveController({
            tabId: "tab-1",
            exportContent: async () => "content",
            defaultName: "diagram.bpmn",
            filterName: "BPMN diagrams",
            extension: "bpmn",
            onStatus: vi.fn(),
        });
        controller.setKnownFile("/tmp/diagram.bpmn", true);

        await controller.save();

        expect(invokeMock).toHaveBeenCalledWith("write_document", {
            tabId: "tab-1",
            content: "content",
        });
    });

    it("prompts via save_document_as with the given defaults when never saved", async () => {
        invokeMock.mockReset().mockResolvedValue("/tmp/new.bpmn");
        const controller = createDesktopSaveController({
            tabId: "tab-2",
            exportContent: async () => "content",
            defaultName: "diagram.bpmn",
            filterName: "BPMN diagrams",
            extension: "bpmn",
            onStatus: vi.fn(),
        });

        await controller.save();

        expect(invokeMock).toHaveBeenCalledWith("save_document_as", {
            tabId: "tab-2",
            content: "content",
            defaultName: "diagram.bpmn",
            filterName: "BPMN diagrams",
            extension: "bpmn",
        });
    });

    it("reports dirty state via reportTabDirty and calls the extra onStateChange callback", () => {
        reportTabDirtyMock.mockReset();
        const onStatus = vi.fn();
        const onStateChange = vi.fn();
        const controller = createDesktopSaveController({
            tabId: "tab-3",
            exportContent: async () => "content",
            defaultName: "diagram.bpmn",
            filterName: "BPMN diagrams",
            extension: "bpmn",
            onStatus,
            onStateChange,
        });

        controller.markDirty();

        expect(reportTabDirtyMock).toHaveBeenCalledWith("tab-3", true, onStatus);
        expect(onStateChange).toHaveBeenCalledWith(expect.objectContaining({ dirty: true }));
    });
});
