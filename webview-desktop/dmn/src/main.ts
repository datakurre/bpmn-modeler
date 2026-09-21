import Split from "split.js";
import { DiagramWarning } from "dmn-js/lib/Modeler";
import "./styles.css";
import "dmn-js/dist/assets/diagram-js.css";
import "dmn-js/dist/assets/dmn-js-decision-table.css";
import "dmn-js/dist/assets/dmn-js-decision-table-controls.css";
import "dmn-js/dist/assets/dmn-js-drd.css";
import "dmn-js/dist/assets/dmn-js-literal-expression.css";
import "dmn-js/dist/assets/dmn-js-shared.css";
import "@bpmn-io/properties-panel/dist/assets/properties-panel.css";

import {
    createModeler,
    exportDiagram,
    loadDiagram,
    onCommandStackChanged,
    getModelerInstance,
} from "./modeler";
import { debounce } from "./util";
import { createEvaluationPanel } from "./evaluation-panel";

declare function acquireVsCodeApi(): {
    postMessage(message: unknown): void;
    getState(): unknown;
    setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();

let modelerIsInitialized = false;
let dmnFileResolve: ((data: { content: string }) => void) | null = null;
let evaluationPanel: ReturnType<typeof createEvaluationPanel> | null = null;

const debouncedOpenXml = debounce(async (dmn: string) => {
    await openXml(dmn);
}, 100);

/**
 * Main entry: wait for webview to load, request DMN file from extension,
 * then initialize the modeler.
 */
window.onload = async function () {
    window.addEventListener("message", onReceiveMessage);

    // Request the DMN file from the extension
    vscode.postMessage({ type: "getDmnFile" });

    // Wait for the initial response
    const dmnFile = await new Promise<{ content: string }>((resolve) => {
        dmnFileResolve = resolve;
    });

    setupSplit();
    await initializeModeler(dmnFile.content);
};

function setupSplit() {
    Split(["#js-canvas", "#js-properties-panel"], {
        sizes: [70, 30],
        minSize: 200,
        gutterSize: 4,
        cursor: "col-resize",
        direction: "horizontal",
        snapOffset: 0,
        dragInterval: 1,
    });
}

async function initializeModeler(dmnContent: string) {
    try {
        createModeler();
        onCommandStackChanged(sendChanges);

        // Track active view type and toggle body.table-view so CSS can hide
        // the Split.js gutter in decision-table / literal-expression views.
        const m = getModelerInstance()!;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        m.on("views.changed", (event: any) => {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
            const isDrd =
                (event as { activeView?: { type?: string } })?.activeView
                    ?.type === "drd";
            document.body.classList.toggle("table-view", !isDrd);
        });
        const dropZone = document.getElementById("js-drop-zone");
        if (dropZone) {
            evaluationPanel = createEvaluationPanel(dropZone, (msg) =>
                vscode.postMessage(msg)
            );
        }

        await openXml(dmnContent);
        modelerIsInitialized = true;
    } catch (error) {
        const message = error instanceof Error ? error.message : `${error}`;
        console.error(`Unable to initialize DMN modeler: ${message}`);
    }
}

async function openXml(dmn: string) {
    if (!dmn) return;

    const result: DiagramWarning = await loadDiagram(dmn);

    if (result.warnings.length > 0) {
        const warnings = result.warnings.map(
            (w) => `${w.message}\n${w.error.message}\n${w.error.stack}\n`
        );
        console.warn(`Diagram opened with warnings: ${warnings.join("\n")}`);
    }

    // Update evaluation panel with the new DMN
    if (evaluationPanel) {
        evaluationPanel.updateDmn(dmn);
    }
}

async function sendChanges() {
    const dmn = await exportDiagram();
    vscode.postMessage({ type: "syncDocument", content: dmn });
    if (evaluationPanel) {
        evaluationPanel.updateDmn(dmn);
    }
}

async function onReceiveMessage(event: MessageEvent) {
    const msg = event.data;

    switch (msg.type) {
        case "dmnFile": {
            if (!modelerIsInitialized && dmnFileResolve) {
                dmnFileResolve({ content: msg.content });
                dmnFileResolve = null;
            } else {
                debouncedOpenXml(msg.content);
            }
            break;
        }
        case "batchEditorContent":
        case "runTestCases": {
            evaluationPanel?.handleMessage(msg);
            break;
        }
    }
}
