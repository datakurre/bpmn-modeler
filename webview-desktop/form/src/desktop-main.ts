import { invoke } from "@tauri-apps/api/core";

import "./styles/default.css";
import { createEditor, exportSchema } from "./editor";
import {
    formatError,
    hasContent,
    showDesktopStatus,
    updateDesktopStatus,
} from "../../shared/desktop-editor";
import { createDesktopSaveController } from "../../shared/desktop-save";
import {
    getTabIdFromLocation,
    installCommonKeyboardHandlers,
    installDirtyQueryResponder,
    installShortcutsHelp,
    type TabDocument,
} from "../../shared/desktop-shell";

const tabId = getTabIdFromLocation();

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

const saveController = createDesktopSaveController({
    tabId,
    exportContent: async () => JSON.stringify(exportSchema(), null, 2),
    defaultName: "new.form",
    filterName: "Form-JS forms",
    extension: "form",
    onStatus: showStatus,
    onStateChange: updateStatus,
});

let initializing = true;

window.addEventListener("load", () => {
    void initialize();
});

installShortcutsHelp();
installDirtyQueryResponder(() => saveController.getState().dirty);

async function initialize(): Promise<void> {
    try {
        const doc = await invoke<TabDocument>("get_tab_document", { tabId });
        saveController.setKnownFile(doc.path, doc.hasBeenSaved);

        createEditor(hasContent(doc.content) ? doc.content : emptySchema, () => {
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

installCommonKeyboardHandlers({
    onSave: () => void saveDocument(),
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
