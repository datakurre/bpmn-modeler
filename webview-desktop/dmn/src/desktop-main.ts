import { invoke } from "@tauri-apps/api/core";
import { save as saveFile } from "@tauri-apps/plugin-dialog";
import Split from "split.js";
import { DiagramWarning } from "dmn-js/lib/Modeler";

import "../../../vendor/dmn-js-modeler/webview/src/styles.css";
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
} from "../../../vendor/dmn-js-modeler/webview/src/modeler";
import { createEvaluationPanel } from "../../../vendor/dmn-js-modeler/webview/src/evaluation-panel";
import { focusNextTab, focusPreviousTab } from "../../shared/tab-cycle";

interface TabDocument {
    tabId: string;
    kind: "bpmn" | "dmn" | "form";
    path: string | null;
    content: string | null;
    hasBeenSaved: boolean;
}

const tabId = new URLSearchParams(location.search).get("tabId") ?? "";

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

let filePath: string | null = null;
let dirty = false;
let hasBeenSaved = false;
let evaluationPanel: ReturnType<typeof createEvaluationPanel> | null = null;
let initializing = true;

function basenameOf(path: string): string {
    return path.split(/[\\/]/).pop() ?? path;
}

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

        await openXml(doc.content ?? emptyDmn);
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

function markDirty(): void {
    dirty = true;
    void invoke("update_tab_state", { tabId, dirty: true });
    updateStatus();
}

async function saveDocument(): Promise<void> {
    try {
        let path = filePath;
        if (!path) {
            path =
                (await saveFile({
                    defaultPath: "decision.dmn",
                    filters: [{ name: "DMN diagrams", extensions: ["dmn"] }],
                })) ?? null;
        }
        if (!path) return;

        const xml = await exportDiagram();
        await invoke("write_document", { path, content: xml });

        filePath = path;
        dirty = false;
        hasBeenSaved = true;

        await invoke("update_tab_state", {
            tabId,
            dirty: false,
            filePath: path,
            hasBeenSaved: true,
        });
        updateStatus();
    } catch (error) {
        showStatus(`Unable to save DMN file: ${formatError(error)}`);
    }
}

function updateStatus(): void {
    const status = document.getElementById("desktop-status");
    const dot = status?.querySelector(".desktop-status-dot");
    const label = status?.querySelector(".desktop-status-label");
    const filenameElement = status?.querySelector(".desktop-status-filename");
    if (!status || !dot || !label || !filenameElement) return;

    const state = !hasBeenSaved ? "never-saved" : dirty ? "unsaved" : "saved";
    dot.className = `desktop-status-dot ${state}`;
    label.textContent = !hasBeenSaved ? "Never saved" : dirty ? "Unsaved changes" : "Saved";
    filenameElement.textContent = filePath ? basenameOf(filePath) : "Untitled.dmn";
}

function showStatus(message: string): void {
    const status = document.getElementById("desktop-status");
    const label = status?.querySelector(".desktop-status-label");
    const filenameElement = status?.querySelector(".desktop-status-filename");
    const dot = status?.querySelector(".desktop-status-dot");
    if (!status || !label || !filenameElement || !dot) return;

    label.textContent = message;
    filenameElement.textContent = "";
    dot.className = "desktop-status-dot";
    console.error(message);
}

function formatError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
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
