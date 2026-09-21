import Split from "split.js";
import { ImportXMLResult } from "bpmn-js/lib/BaseViewer";
import { debounce } from "lodash";

import "./styles/default.css";

import {
    alignElementsToOrigin,
    createModeler,
    exportDiagram,
    getDiagramSvg,
    getLinkedResourceOverlays,
    getModelerInstance,
    getScriptTextareaDecorator,
    loadDiagram,
    newDiagram,
    onCommandStackChanged,
    onCommentsUpdated,
    setBpmnlintConfig,
    setElementTemplates,
    setSettings,
    toggleLinting,
    toggleTransactionBoundaries,
} from "./modeler";

// ---------------------------------------------------------------------------
// VS Code API
// ---------------------------------------------------------------------------

const vscode = acquireVsCodeApi();

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let modelerIsInitialized = false;
let bpmnFileResolve: ((content: string) => void) | null = null;

const debouncedOpenXml = debounce(async (bpmn: string) => {
    await openXml(bpmn);
}, 100);

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

window.onload = async function () {
    window.addEventListener("message", onReceiveMessage);

    // Request the BPMN file from the extension
    vscode.postMessage({ type: "getBpmnFile" });

    // Wait for the response
    const bpmn = await new Promise<string>((resolve) => {
        bpmnFileResolve = resolve;
    });

    setupSplit();
    await initializeModeler(bpmn);
    modelerIsInitialized = true;

    console.warn("[bpmn-modeler] Modeler initialized");

    // Request additional data
    vscode.postMessage({ type: "getFormKeys" });
    vscode.postMessage({ type: "getElementTemplates" });
    vscode.postMessage({ type: "getBpmnlintConfig" });
    vscode.postMessage({ type: "getSettings" });
};

// ---------------------------------------------------------------------------
// Split panels
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Modeler lifecycle
// ---------------------------------------------------------------------------

async function initializeModeler(bpmn: string | undefined) {
    try {
        createModeler();
        onCommandStackChanged(sendXmlChanges);
        onCommentsUpdated(sendXmlChanges);

        // Wire the script textarea decorator to the VS Code API
        const scriptDecorator = getScriptTextareaDecorator();
        scriptDecorator.setVsCodeApi(vscode);

        await openXml(bpmn);

        // Report viewport changes to the extension so the diff view can open
        // at the same zoom/position as the modeler.
        const m = getModelerInstance();
        if (m) {
            const sendViewport = debounce(() => {
                try {
                    const viewbox = m.get<any>("canvas").viewbox();
                    vscode.postMessage({ type: "viewportState", viewbox });
                } catch {
                    // canvas might not be ready
                }
            }, 400);
            m.get<any>("eventBus").on("canvas.viewbox.changed", sendViewport);
        }
    } catch (error: any) {
        console.error("Unable to initialize modeler:", error.message);
    }
}

async function openXml(bpmn?: string) {
    let result: ImportXMLResult;
    if (!bpmn) {
        result = await newDiagram();
    } else {
        result = await loadDiagram(bpmn);
    }

    if (result.warnings.length > 0) {
        console.warn("Import warnings:", result.warnings);
    }

    alignElementsToOrigin();

    // Request linked resources after diagram is loaded
    // The LinkedResourceOverlays module will re-add overlays on import.done event
    vscode.postMessage({ type: "getLinkedResources" });
}

async function sendXmlChanges() {
    const bpmn = await exportDiagram();
    vscode.postMessage({ type: "syncDocument", content: bpmn });
    alignElementsToOrigin();
}

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

async function onReceiveMessage(event: MessageEvent) {
    const msg = event.data;

    switch (msg.type) {
        case "bpmnFile": {
            if (!modelerIsInitialized && bpmnFileResolve) {
                bpmnFileResolve(msg.content);
                bpmnFileResolve = null;
            } else if (modelerIsInitialized) {
                debouncedOpenXml(msg.content);
            }
            break;
        }
        case "formKeys": {
            // MiragonProvider removed - using Camunda default properties panel
            break;
        }
        case "elementTemplates": {
            try {
                setElementTemplates(msg.elementTemplates);
            } catch (error: any) {
                console.error("Error setting element templates:", error.message);
            }
            break;
        }
        case "settings": {
            try {
                setSettings(msg.settings);
            } catch (error: any) {
                console.error("Error setting modeler settings:", error.message);
            }
            break;
        }
        case "getDiagramAsSvg": {
            try {
                const svg = await getDiagramSvg();
                vscode.postMessage({ type: "svgResult", svg });
            } catch (error: any) {
                console.error("Error exporting SVG:", error.message);
            }
            break;
        }
        case "linkedResources": {
            try {
                const overlays = getLinkedResourceOverlays();
                overlays.setVsCodeApi(vscode);
                overlays.showLinks(msg.links || []);
            } catch (error: any) {
                console.error("Error setting linked resources:", error.message);
            }
            break;
        }
        case "bpmnlintConfig": {
            try {
                setBpmnlintConfig(msg.config);
            } catch (error: any) {
                console.error("Error setting bpmnlint config:", error.message);
            }
            break;
        }
        case "toggleTransactionBoundaries": {
            try {
                toggleTransactionBoundaries();
            } catch (error: any) {
                console.error("Error toggling transaction boundaries:", error.message);
            }
            break;
        }
        case "toggleLinting": {
            try {
                toggleLinting();
            } catch (error: any) {
                console.error("Error toggling linting:", error.message);
            }
            break;
        }
        case "scriptUpdated": {
            try {
                getScriptTextareaDecorator().updateFromExtension(
                    msg.elementId,
                    msg.scriptBody,
                    msg.propertyPath,
                );
            } catch (error: any) {
                console.error("Error updating script:", error.message);
            }
            break;
        }
    }
}
