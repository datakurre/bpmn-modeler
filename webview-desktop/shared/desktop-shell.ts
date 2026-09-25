import { invoke } from "@tauri-apps/api/core";
import { formatError } from "./desktop-editor";
import { focusNextTab, focusPreviousTab } from "./tab-cycle";

export type EditorKind = "bpmn" | "dmn" | "form";

export interface TabDocument {
    tabId: string;
    kind: EditorKind;
    path: string | null;
    content: string | null;
    hasBeenSaved: boolean;
}

/** The tab this editor webview was opened for, from its `?tabId=` query param. */
export function getTabIdFromLocation(): string {
    return new URLSearchParams(location.search).get("tabId") ?? "";
}

/**
 * Push a tab's dirty flag to the backend (so the shell's tab dot and the
 * close/quit confirmation see it). This is inherently best-effort — it's a
 * separate IPC round trip from the shell's close/quit calls, on a different
 * webview's channel, so nothing here guarantees it lands before a same-instant
 * close or quit — but a failure should surface rather than vanish as an
 * unhandled rejection.
 */
export function reportTabDirty(tabId: string, dirty: boolean, onError: (message: string) => void): void {
    invoke("update_tab_state", { tabId, dirty }).catch((error: unknown) => {
        onError(`Unable to sync tab state: ${formatError(error)}`);
    });
}

export function showShortcutsHelp(x: number, y: number): void {
    const help = document.getElementById("desktop-shortcuts-help");
    if (!help) return;

    help.hidden = false;
    const left = Math.min(x, window.innerWidth - help.offsetWidth - 8);
    const top = Math.min(y, window.innerHeight - help.offsetHeight - 8);
    help.style.left = `${Math.max(8, left)}px`;
    help.style.top = `${Math.max(8, top)}px`;
}

export function hideShortcutsHelp(): void {
    const help = document.getElementById("desktop-shortcuts-help");
    if (help) help.hidden = true;
}

/** Wires the right-click shortcuts popup and dismisses it on an outside click. */
export function installShortcutsHelp(): void {
    window.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        showShortcutsHelp(event.clientX, event.clientY);
    });

    window.addEventListener("click", (event) => {
        const help = document.getElementById("desktop-shortcuts-help");
        if (help && !help.contains(event.target as Node)) {
            hideShortcutsHelp();
        }
    });
}

export interface CommonKeyboardHandlers {
    onSave: () => void;
    /** Extra work to do on Escape, run after the shortcuts popup is hidden. */
    onEscape?: () => void;
}

/** Wires the Escape / Ctrl+Q / Ctrl+S / Ctrl+Tab shortcuts shared by every editor. */
export function installCommonKeyboardHandlers(handlers: CommonKeyboardHandlers): void {
    window.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            hideShortcutsHelp();
            handlers.onEscape?.();
            return;
        }

        const modifierPressed = event.ctrlKey || event.metaKey;
        const key = event.key.toLowerCase();

        if (modifierPressed && key === "q") {
            event.preventDefault();
            void invoke("quit_app");
            return;
        }

        if (modifierPressed && key === "s") {
            event.preventDefault();
            handlers.onSave();
            return;
        }

        if (modifierPressed && key === "tab") {
            event.preventDefault();
            void (event.shiftKey ? focusPreviousTab() : focusNextTab());
        }
    });
}
