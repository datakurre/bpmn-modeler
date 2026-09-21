import { invoke } from "@tauri-apps/api/core";
import { save as saveFile } from "@tauri-apps/plugin-dialog";

import "./styles/default.css";
import { createEditor, exportSchema } from "./editor";
import { focusNextTab, focusPreviousTab } from "../../shared/tab-cycle";
import {
    basenameOf,
    formatError,
    showDesktopStatus,
    updateDesktopStatus,
} from "../../shared/desktop-editor";

interface TabDocument {
    tabId: string;
    kind: "bpmn" | "dmn" | "form";
    path: string | null;
    content: string | null;
    hasBeenSaved: boolean;
}

const tabId = new URLSearchParams(location.search).get("tabId") ?? "";

const emptySchema = JSON.stringify(
    {
        components: [],
        type: "default",
        id: "new-form",
        schemaVersion: 19,
    },
    null,
    2,
);

let filePath: string | null = null;
let dirty = false;
let hasBeenSaved = false;
let initializing = true;

window.addEventListener("load", () => {
    void initialize();
});

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

async function initialize(): Promise<void> {
    try {
        const doc = await invoke<TabDocument>("get_tab_document", { tabId });
        filePath = doc.path;
        hasBeenSaved = doc.hasBeenSaved;

        createEditor(doc.content ?? emptySchema, () => {
            if (!initializing) {
                dirty = true;
                void invoke("update_tab_state", { tabId, dirty: true });
                updateStatus();
            }
        });
        initializing = false;
        document.body.classList.add("desktop-ready");
        updateStatus();
    } catch (error) {
        showStatus(`Unable to open form: ${formatError(error)}`);
    }
}

window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
        hideShortcutsHelp();
        return;
    }

    const modifierPressed = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();

    if (modifierPressed && key === "q") {
        event.preventDefault();
        void invoke("quit_app");
    } else if (modifierPressed && key === "s") {
        event.preventDefault();
        void saveDocument();
    } else if (modifierPressed && key === "tab") {
        event.preventDefault();
        void (event.shiftKey ? focusPreviousTab() : focusNextTab());
    }
});

async function saveDocument(): Promise<void> {
    try {
        if (!filePath) {
            filePath =
                (await saveFile({
                    defaultPath: "new.form",
                    filters: [{ name: "Form-JS forms", extensions: ["form"] }],
                })) ?? null;
        }

        if (!filePath) return;

        await invoke("write_document", {
            path: filePath,
            content: JSON.stringify(exportSchema(), null, 2),
        });
        dirty = false;
        hasBeenSaved = true;

        await invoke("update_tab_state", {
            tabId,
            dirty: false,
            filePath,
            hasBeenSaved: true,
        });
        updateStatus();
    } catch (error) {
        showStatus(`Unable to save form: ${formatError(error)}`);
    }
}

function updateStatus(): void {
    updateDesktopStatus({
        filePath,
        dirty,
        hasBeenSaved,
        defaultFilename: "Untitled.form",
    });
}

function showStatus(message: string): void {
    showDesktopStatus(message);
}

function showShortcutsHelp(x: number, y: number): void {
    const help = document.getElementById("desktop-shortcuts-help");
    if (!help) return;

    help.hidden = false;
    const left = Math.min(x, window.innerWidth - help.offsetWidth - 8);
    const top = Math.min(y, window.innerHeight - help.offsetHeight - 8);
    help.style.left = `${Math.max(8, left)}px`;
    help.style.top = `${Math.max(8, top)}px`;
}

function hideShortcutsHelp(): void {
    const help = document.getElementById("desktop-shortcuts-help");
    if (help) help.hidden = true;
}
