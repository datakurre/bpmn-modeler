import { invoke } from "@tauri-apps/api/core";
import { SaveController, type SaveState } from "./save-controller";
import { reportTabDirty } from "./desktop-shell";

export interface DesktopSaveControllerOptions {
    tabId: string;
    /** Serialize the current editor content for writing to disk. */
    exportContent: () => Promise<string>;
    /** File name pre-filled in the Save As dialog, e.g. "diagram.bpmn". */
    defaultName: string;
    /** Save As dialog filter label, e.g. "BPMN diagrams". */
    filterName: string;
    /** File extension for the Save As dialog filter, e.g. "bpmn". */
    extension: string;
    /** Shows an error message, e.g. from a failed reportTabDirty() call. */
    onStatus: (message: string) => void;
    /** Extra work to do on every state change, e.g. the editor's updateStatus(). */
    onStateChange?: (state: SaveState) => void;
}

/**
 * Builds the `SaveController` every desktop editor needs: writing through
 * `write_document`/`save_document_as` by `tabId` and reporting the tab's
 * dirty state to the backend, which is otherwise identical across
 * `bpmn`/`dmn`/`form`'s `desktop-main.ts` except for `exportContent` and the
 * Save As dialog's file name/filter/extension.
 */
export function createDesktopSaveController(options: DesktopSaveControllerOptions): SaveController {
    const { tabId, exportContent, defaultName, filterName, extension, onStatus, onStateChange } = options;

    return new SaveController(
        {
            exportContent,
            writeDocument: (content) => invoke("write_document", { tabId, content }),
            saveAs: (content) =>
                invoke<string | null>("save_document_as", {
                    tabId,
                    content,
                    defaultName,
                    filterName,
                    extension,
                }),
            onStateChange: (state) => {
                reportTabDirty(tabId, state.dirty, onStatus);
                onStateChange?.(state);
            },
        },
        { filePath: null, hasBeenSaved: false },
    );
}
