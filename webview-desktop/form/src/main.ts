import "./styles/default.css";
import { createEditor, exportSchema, loadSchema } from "./editor";

declare function acquireVsCodeApi(): {
    postMessage(message: unknown): void;
    getState(): unknown;
    setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();

let editorIsInitialized = false;
let formSchemaResolve: ((data: { content: string }) => void) | null = null;

/**
 * Simple debounce utility.
 */
function debounce<T extends (...args: any[]) => any>(
    fn: T,
    ms: number,
): (...args: Parameters<T>) => void {
    let timer: ReturnType<typeof setTimeout> | undefined;
    return (...args: Parameters<T>) => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => fn(...args), ms);
    };
}

const debouncedUpdateSchema = debounce(async (schema: string) => {
    await openSchema(schema);
}, 100);

/**
 * Main entry: wait for webview to load, request form schema from extension,
 * then initialize the editor.
 */
window.onload = async function () {
    window.addEventListener("message", onReceiveMessage);

    // Request the form schema from the extension
    vscode.postMessage({ type: "getFormSchema" });

    // Wait for the initial response
    const formSchema = await new Promise<{ content: string }>((resolve) => {
        formSchemaResolve = resolve;
    });

    await initializeEditor(formSchema.content);
    editorIsInitialized = true;
};

async function initializeEditor(schema: string | undefined) {
    try {
        createEditor(schema, sendSchemaChanges);
    } catch (error: any) {
        console.error(`Unable to open schema: ${error.message}`);
    }
}

/**
 * Open or update the editor with the new schema content.
 */
async function openSchema(schema?: string) {
    if (schema) {
        try {
            await loadSchema(schema);
        } catch (err: any) {
            console.warn(`Schema loaded with warnings: ${err.warnings}`);
        }
    }
}

/**
 * Send the changed schema content to the extension to update the .form file.
 */
async function sendSchemaChanges() {
    const schema = exportSchema();
    vscode.postMessage({
        type: "syncDocument",
        content: JSON.stringify(schema, null, 4),
    });
}

/**
 * Listen to messages from the extension.
 */
async function onReceiveMessage(event: MessageEvent) {
    const msg = event.data;

    switch (msg.type) {
        case "formSchema": {
            if (!editorIsInitialized && formSchemaResolve) {
                formSchemaResolve({ content: msg.content });
                formSchemaResolve = null;
            } else {
                debouncedUpdateSchema(msg.content);
            }
            break;
        }
    }
}
