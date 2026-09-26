import { invoke } from "@tauri-apps/api/core";
import Split from "split.js";
import { DiagramWarning } from "dmn-js/lib/Modeler";

import "./styles.css";
import "dmn-js/dist/assets/dmn-font/css/dmn.css";
import "dmn-js/dist/assets/diagram-js.css";
import "dmn-js/dist/assets/dmn-js-decision-table.css";
import "dmn-js/dist/assets/dmn-js-decision-table-controls.css";
import "dmn-js/dist/assets/dmn-js-drd.css";
import "dmn-js/dist/assets/dmn-js-literal-expression.css";
import "dmn-js/dist/assets/dmn-js-shared.css";
import "@bpmn-io/properties-panel/dist/assets/properties-panel.css";
import "./desktop.css";

import {
    createModeler,
    exportDiagram,
    getModelerInstance,
    loadDiagram,
    onCommandStackChanged,
} from "./modeler";
import { createEvaluationPanel } from "./evaluation-panel";
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
    installReloadDocumentHandler,
    installShortcutsHelp,
    type TabDocument,
} from "../../shared/desktop-shell";

const tabId = getTabIdFromLocation();

const emptyDmn = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="https://www.omg.org/spec/DMN/20191111/MODEL/" id="definitions" name="definitions" namespace="http://camunda.org/schema/1.0/dmn">
  <decision id="decision" name="Decision">
    <decisionTable id="decisionTable">
      <input id="input1"><inputExpression id="inputExpression1" typeRef="string"><text></text></inputExpression></input>
      <output id="output1" typeRef="string" />
    </decisionTable>
  </decision>
</definitions>
`;

const saveController = createDesktopSaveController({
    tabId,
    exportContent: exportDiagram,
    defaultName: "decision.dmn",
    filterName: "DMN diagrams",
    extension: "dmn",
    onStatus: showStatus,
    onStateChange: updateStatus,
});

let evaluationPanel: ReturnType<typeof createEvaluationPanel> | null = null;
let initializing = true;

window.addEventListener("load", () => {
    void initialize();
});

installShortcutsHelp();
installDirtyQueryResponder(tabId, () => saveController.getState().dirty);
installReloadDocumentHandler(
    tabId,
    () => saveController.getState().dirty,
    reloadFromDisk,
    showStatus,
);

async function initialize(): Promise<void> {
    try {
        const doc = await invoke<TabDocument>("get_tab_document", { tabId });
        saveController.setKnownFile(doc.path, doc.hasBeenSaved);

        setupSplit();
        createModeler();
        onCommandStackChanged(() => {
            if (initializing) return;
            markDirty();
            void sendCurrentDmnToEvaluationPanel();
        });

        const m = getModelerInstance();
        m?.on("views.changed", (event: unknown) => {
            const isDrd = (event as { activeView?: { type?: string } })?.activeView?.type === "drd";
            document.body.classList.toggle("table-view", !isDrd);
        });

        const dropZone = document.getElementById("js-drop-zone");
        if (dropZone) {
            evaluationPanel = createEvaluationPanel(dropZone);
        }

        await openXml(hasContent(doc.content) ? doc.content : emptyDmn);
        initializing = false;

        document.body.classList.add("desktop-ready");
        updateStatus();
    } catch (error) {
        showStatus(`Unable to open DMN file: ${formatError(error)}`);
    }
}

function setupSplit(): void {
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

async function openXml(dmn: string): Promise<void> {
    if (!dmn) return;

    const result: DiagramWarning = await loadDiagram(dmn);
    if (result.warnings.length > 0) {
        const warnings = result.warnings.map((w) => `${w.message}\n${w.error.message}\n${w.error.stack}\n`);
        console.warn(`Diagram opened with warnings: ${warnings.join("\n")}`);
    }

    await sendCurrentDmnToEvaluationPanel();
}

async function sendCurrentDmnToEvaluationPanel(): Promise<void> {
    if (!evaluationPanel) return;
    const dmn = await exportDiagram();
    await evaluationPanel.updateDmn(dmn);
}

installCommonKeyboardHandlers({
    onSave: () => void saveDocument(),
});

/** Replaces the decision with `content`, the file's new on-disk version. */
async function reloadFromDisk(content: string): Promise<void> {
    // Importing fires command-stack changes that aren't user edits.
    initializing = true;
    try {
        await openXml(hasContent(content) ? content : emptyDmn);
    } finally {
        initializing = false;
    }
    saveController.markReloaded();
}

function markDirty(): void {
    saveController.markDirty();
}

async function saveDocument(): Promise<void> {
    try {
        await saveController.save();
    } catch (error) {
        showStatus(`Unable to save DMN file: ${formatError(error)}`);
    }
}

function updateStatus(): void {
    updateDesktopStatus({
        ...saveController.getState(),
        defaultFilename: "Untitled.dmn",
    });
}

function showStatus(message: string): void {
    showDesktopStatus(message);
}
