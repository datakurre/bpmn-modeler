import { invoke } from "@tauri-apps/api/core";

import "./styles/default.css";
import { createEditor, exportSchema } from "./editor";
import {
    formatError,
    hasContent,
    showDesktopStatus,
    updateDesktopStatus,
} from "../../shared/desktop-editor";
import { SaveController } from "../../shared/save-controller";
import {
    getTabIdFromLocation,
    installCommonKeyboardHandlers,
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

const saveController = new SaveController(
    {
        exportContent: async () => JSON.stringify(exportSchema(), null, 2),
        writeDocument: (content) => invoke("write_document", { tabId, content }),
        saveAs: (content) =>
            invoke<string | null>("save_document_as", {
                tabId,
                content,
                defaultName: "new.form",
                filterName: "Form-JS forms",
                extension: "form",
            }),
        onStateChange: (state) => {
            void invoke("update_tab_state", { tabId, dirty: state.dirty });
            updateStatus();
        },
    },
    { filePath: null, hasBeenSaved: false },
);

let initializing = true;

window.addEventListener("load", () => {
    void initialize();
});

installShortcutsHelp();

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
