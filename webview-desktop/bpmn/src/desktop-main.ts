import { invoke } from "@tauri-apps/api/core";

import "./styles/default.css";
import "./styles/light-theme/index.css";
import "camunda-bpmn-js/dist/assets/bpmn-font/css/bpmn.css";
import { layoutDesktopDiagram } from "./desktop-auto-layout";
import {
    buildDirectoryIndex,
    computeLinkedResources,
    loadSiblingBpmnFiles,
} from "./desktop-linked-resources";
import type { CallerCandidate } from "./linked-resources";
import type { ResourceIndex } from "./linkedResources";
import {
    createModeler,
    exportDiagram,
    fitDiagramToViewport,
    getLinkedResourceOverlays,
    getModelerInstance,
    loadDiagram,
    newDiagram,
    onCommandStackChanged,
    redoDiagram,
    setBpmnlintConfig,
    undoDiagram,
} from "./modeler";
import {
    analyzeSelection,
    applyFullDiagramLayout,
    layoutSelectedElements,
    parseLaidOutGeometry,
} from "./selection-layout";
import {
    basenameOf,
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
    reportTabDirty,
    type TabDocument,
} from "../../shared/desktop-shell";

const tabId = getTabIdFromLocation();

const saveController = new SaveController(
    {
        exportContent: exportDiagram,
        writeDocument: (content) => invoke("write_document", { tabId, content }),
        saveAs: (content) =>
            invoke<string | null>("save_document_as", {
                tabId,
                content,
                defaultName: "diagram.bpmn",
                filterName: "BPMN diagrams",
                extension: "bpmn",
            }),
        onStateChange: (state) => {
            reportTabDirty(tabId, state.dirty, showStatus);
            updateStatus();
        },
    },
    { filePath: null, hasBeenSaved: false },
);

let scannedDirectory: string | null = null;
let siblingFiles: Map<string, string> = new Map();
let directoryIndex: ResourceIndex = { processes: [], decisions: [], forms: [] };
let chooserElement: HTMLElement | null = null;

function dirnameOf(path: string): string {
    const idx = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
    return idx === -1 ? "." : path.slice(0, idx);
}

function joinPath(dir: string, file: string): string {
    if (dir === ".") return file;
    const sep = dir.includes("\\") && !dir.includes("/") ? "\\" : "/";
    return dir.endsWith(sep) ? `${dir}${file}` : `${dir}${sep}${file}`;
}

window.addEventListener("load", () => {
    void initialize();
});

installShortcutsHelp();

window.addEventListener("click", (event) => {
    const chooser = document.getElementById("desktop-tab-chooser");
    if (chooser && !chooser.contains(event.target as Node)) {
        hideCandidateChooser();
    }
});

async function initialize(): Promise<void> {
    try {
        const doc = await invoke<TabDocument>("get_tab_document", { tabId });
        saveController.setKnownFile(doc.path, doc.hasBeenSaved);

        setBpmnlintConfig({
            extends: "bpmnlint:recommended",
        });
        createModeler({ comments: false });

        if (hasContent(doc.content)) {
            const result = await loadDiagram(doc.content);
            if (result.warnings.length > 0) {
                console.warn("Import warnings:", result.warnings);
            }
        } else {
            await newDiagram();
        }

        chooserElement = document.getElementById("desktop-tab-chooser");

        onCommandStackChanged(() => {
            markDirty();
        });

        fitDiagramToViewport();

        window.addEventListener("resize", () => {
            fitDiagramToViewport();
        });

        document.body.classList.add("desktop-ready");
        updateStatus();

        const initialPath = saveController.getState().filePath;
        if (initialPath) {
            await discoverLinkedResources(initialPath);
        }
    } catch (error) {
        showStatus(`Unable to open BPMN file: ${formatError(error)}`);
    }
}

installCommonKeyboardHandlers({
    onSave: () => void saveDocument(),
    onEscape: () => {
        hideCandidateChooser();
        getModelerInstance()?.get<any>("toggleMode").toggleMode(false);
    },
});

// BPMN-specific shortcuts, on top of the Escape/Ctrl+Q/Ctrl+S/Ctrl+Tab ones
// installCommonKeyboardHandlers() already wires above.
window.addEventListener("keydown", (event) => {
    const modifierPressed = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();

    if (modifierPressed && key === "z" && !event.shiftKey) {
        event.preventDefault();
        undoDiagram();
    }

    if (modifierPressed && key === "y") {
        event.preventDefault();
        redoDiagram();
    }

    if (modifierPressed && key === "l") {
        event.preventDefault();
        void autoLayout();
    }

    if (modifierPressed && key === "p") {
        event.preventDefault();
        document.body.classList.toggle("properties-visible");
    }
});

function markDirty(): void {
    saveController.markDirty();
}

async function saveDocument(): Promise<void> {
    const wasUnsaved = !saveController.getState().filePath;
    try {
        await saveController.save();

        const path = saveController.getState().filePath;
        if (wasUnsaved && path) {
            await discoverLinkedResources(path);
        }
    } catch (error) {
        showStatus(`Unable to save BPMN file: ${formatError(error)}`);
    }
}

async function discoverLinkedResources(path: string): Promise<void> {
    scannedDirectory = dirnameOf(path);
    siblingFiles = await loadSiblingBpmnFiles(tabId);
    directoryIndex = await buildDirectoryIndex(siblingFiles);
    await refreshOverlays(path);
}

async function refreshOverlays(path: string): Promise<void> {
    const overlays = getLinkedResourceOverlays();
    overlays.setVsCodeApi({ postMessage: handleLinkedResourceMessage });

    if (siblingFiles.size === 0) {
        overlays.showLinks([]);
        return;
    }

    const xml = await exportDiagram();
    const relativePath = basenameOf(path);
    const links = await computeLinkedResources(xml, relativePath, directoryIndex, siblingFiles);
    overlays.showLinks(links);
}

function handleLinkedResourceMessage(msg: unknown): void {
    if (!msg || typeof msg !== "object" || !scannedDirectory) return;
    const message = msg as { type?: string; relativePath?: string; candidates?: CallerCandidate[] };
    if (message.type === "openLinkedFile" && message.relativePath) {
        void openLinkedFile(message.relativePath);
    } else if (message.type === "openLinkedFileChooser" && message.candidates) {
        showCandidateChooser(message.candidates);
    }
}

async function openLinkedFile(relativePath: string): Promise<void> {
    if (!scannedDirectory) return;
    const path = joinPath(scannedDirectory, relativePath);
    try {
        await invoke("open_tab", { path, kind: "bpmn" });
    } catch (error) {
        showStatus(`Unable to open ${relativePath}: ${formatError(error)}`);
    }
}

function hideCandidateChooser(): void {
    if (chooserElement) chooserElement.hidden = true;
}

function showCandidateChooser(candidates: CallerCandidate[]): void {
    if (!chooserElement) return;
    chooserElement.innerHTML = "";

    const heading = document.createElement("h2");
    heading.textContent = "Open caller definition";
    chooserElement.appendChild(heading);

    const list = document.createElement("ul");
    for (const candidate of candidates) {
        const item = document.createElement("li");
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = candidate.label;
        button.addEventListener("click", () => {
            hideCandidateChooser();
            void openLinkedFile(candidate.relativePath);
        });
        item.appendChild(button);
        list.appendChild(item);
    }
    chooserElement.appendChild(list);
    chooserElement.hidden = false;
}

async function autoLayout(): Promise<void> {
    try {
        const modeler = getModelerInstance();
        const selection = modeler?.get<any>("selection");
        const selectedElements = selection ? selection.get() : [];
        const analysis = analyzeSelection(selectedElements);

        if (analysis.isInterconnected && modeler) {
            await layoutSelectedElements(modeler, analysis);
            markDirty();
            return;
        }

        if (!modeler) return;
        const laidOutXml = await layoutDesktopDiagram(await exportDiagram());
        const geometry = parseLaidOutGeometry(laidOutXml);
        applyFullDiagramLayout(modeler, geometry);
        markDirty();
    } catch (error) {
        showStatus(`Unable to auto-layout BPMN file: ${formatError(error)}`);
    }
}

function updateStatus(): void {
    updateDesktopStatus({
        ...saveController.getState(),
        defaultFilename: "Untitled.bpmn",
    });
}

function showStatus(message: string): void {
    showDesktopStatus(message);
}
