import { invoke } from "@tauri-apps/api/core";
import { save as saveFile } from "@tauri-apps/plugin-dialog";

import "./styles/default.css";
import { createEditor, exportSchema } from "./editor";
import { focusNextTab, focusPreviousTab } from "../../shared/tab-cycle";
import {
    formatError,
    showDesktopStatus,
    updateDesktopStatus,
} from "../../shared/desktop-editor";
import { SaveController } from "../../shared/save-controller";

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

const saveController = new SaveController(
    {
        exportContent: async () => JSON.stringify(exportSchema(), null, 2),
        writeDocument: (path, content) => invoke("write_document", { path, content }),
        pickSavePath: () =>
            saveFile({
                defaultPath: "new.form",
                filters: [{ name: "Form-JS forms", extensions: ["form"] }],
            }).then((path) => path ?? null),
        onStateChange: (state) => {
            void invoke("update_tab_state", {
                tabId,
                dirty: state.dirty,
                filePath: state.filePath ?? undefined,
                hasBeenSaved: state.hasBeenSaved,
            });
            updateStatus();
        },
    },
    { filePath: null, hasBeenSaved: false },
);

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
        saveController.setKnownFile(doc.path, doc.hasBeenSaved);

        createEditor(doc.content ?? emptySchema, () => {
            if (!initializing) {
                saveController.markDirty();
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
        await saveController.save();
    } catch (error) {
        showStatus(`Unable to save form: ${formatError(error)}`);
    }
}

function updateStatus(): void {
    updateDesktopStatus({
        ...saveController.getState(),
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
