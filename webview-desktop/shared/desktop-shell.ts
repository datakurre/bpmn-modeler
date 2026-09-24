import { invoke } from "@tauri-apps/api/core";
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
