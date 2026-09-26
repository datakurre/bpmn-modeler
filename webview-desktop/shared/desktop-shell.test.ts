import { describe, it, expect, vi, beforeEach } from "vitest";
import { installReloadDocumentHandler } from "./desktop-shell";

type Listener = (event: { payload: unknown }) => void;
const listeners = new Map<string, Listener>();

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({
    listen: (name: string, cb: Listener) => {
        listeners.set(name, cb);
        return Promise.resolve(() => {});
    },
}));
vi.mock("./tab-cycle", () => ({ focusNextTab: vi.fn(), focusPreviousTab: vi.fn() }));

function emit(payload: { tabId: string; content: string; discardChanges: boolean }): void {
    listeners.get("reload-document")!({ payload });
}

describe("installReloadDocumentHandler", () => {
    beforeEach(() => listeners.clear());

    it("reloads a clean editor with the new content", () => {
        const reload = vi.fn().mockResolvedValue(undefined);
        installReloadDocumentHandler("tab-1", () => false, reload, vi.fn());

        emit({ tabId: "tab-1", content: "<new/>", discardChanges: false });

        expect(reload).toHaveBeenCalledWith("<new/>");
    });

    it("ignores a reload meant for another tab", () => {
        const reload = vi.fn().mockResolvedValue(undefined);
        installReloadDocumentHandler("tab-1", () => false, reload, vi.fn());

        emit({ tabId: "tab-2", content: "<new/>", discardChanges: true });

        expect(reload).not.toHaveBeenCalled();
    });

    it("does not reload a dirty editor unless the user agreed to discard its changes", () => {
        const reload = vi.fn().mockResolvedValue(undefined);
        installReloadDocumentHandler("tab-1", () => true, reload, vi.fn());

        emit({ tabId: "tab-1", content: "<new/>", discardChanges: false });
        expect(reload).not.toHaveBeenCalled();

        emit({ tabId: "tab-1", content: "<new/>", discardChanges: true });
        expect(reload).toHaveBeenCalledWith("<new/>");
    });

    it("reports a failed reload", async () => {
        const onError = vi.fn();
        installReloadDocumentHandler("tab-1", () => false, () => Promise.reject(new Error("bad xml")), onError);

        emit({ tabId: "tab-1", content: "x", discardChanges: false });
        await Promise.resolve();
        await Promise.resolve();

        expect(onError).toHaveBeenCalledWith("Unable to reload from disk: bad xml");
    });
});
