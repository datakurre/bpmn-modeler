import { invoke } from "@tauri-apps/api/core";
import { save as saveFile } from "@tauri-apps/plugin-dialog";

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
import { focusNextTab, focusPreviousTab } from "../../shared/tab-cycle";
import {
    basenameOf,
    formatError,
    showDesktopStatus,
    updateDesktopStatus,
} from "../../shared/desktop-editor";

interface TabDocument {
    tabId: string;
    kind: "bpmn" | "dmn" | "form";
    path: string | null;
    content: string | null;
    hasBeenSaved: boolean;
}

const tabId = new URLSearchParams(location.search).get("tabId") ?? "";

let filePath: string | null = null;
let dirty = false;
let hasBeenSaved = false;

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

window.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    showShortcutsHelp(event.clientX, event.clientY);
});

window.addEventListener("click", (event) => {
    const help = document.getElementById("desktop-shortcuts-help");
    if (help && !help.contains(event.target as Node)) {
        hideShortcutsHelp();
    }
    const chooser = document.getElementById("desktop-tab-chooser");
    if (chooser && !chooser.contains(event.target as Node)) {
        hideCandidateChooser();
    }
});

async function initialize(): Promise<void> {
    try {
        const doc = await invoke<TabDocument>("get_tab_document", { tabId });
        filePath = doc.path;
        hasBeenSaved = doc.hasBeenSaved;

        setBpmnlintConfig({
            extends: "bpmnlint:recommended",
        });
        createModeler({ comments: false });

        if (doc.content !== null) {
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

        if (filePath) {
            await discoverLinkedResources(filePath);
        }
    } catch (error) {
        showStatus(`Unable to open BPMN file: ${formatError(error)}`);
    }
}

window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
        hideShortcutsHelp();
        hideCandidateChooser();
        getModelerInstance()?.get<any>("toggleMode").toggleMode(false);
        return;
    }

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

    if (modifierPressed && key === "q") {
        event.preventDefault();
        void invoke("quit_app");
    }

    if (modifierPressed && key === "s") {
        event.preventDefault();
        void saveDocument();
    }

    if (modifierPressed && key === "l") {
        event.preventDefault();
        void autoLayout();
    }

    if (modifierPressed && key === "p") {
        event.preventDefault();
        document.body.classList.toggle("properties-visible");
    }

    if (modifierPressed && key === "tab") {
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
                    defaultPath: "diagram.bpmn",
                    filters: [{ name: "BPMN diagrams", extensions: ["bpmn"] }],
                })) ?? null;
        }
        if (!path) return;

        const xml = await exportDiagram();
        await invoke("write_document", { path, content: xml });

        const wasUnsaved = !filePath;
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

        if (wasUnsaved) {
            await discoverLinkedResources(path);
        }
    } catch (error) {
        showStatus(`Unable to save BPMN file: ${formatError(error)}`);
    }
}

async function discoverLinkedResources(path: string): Promise<void> {
    scannedDirectory = dirnameOf(path);
    siblingFiles = await loadSiblingBpmnFiles(path);
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
    await invoke("open_tab", { path, kind: "bpmn" });
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
        filePath,
        dirty,
        hasBeenSaved,
        defaultFilename: "Untitled.bpmn",
    });
}

function showStatus(message: string): void {
    showDesktopStatus(message);
}
