import type { ResolvedLink, ResourceIndex } from "./linkedResources";
import {
    buildDirectoryIndex,
    computeLinkedResources,
    loadSiblingBpmnFiles,
} from "./desktop-linked-resources";
import type { CallerCandidate } from "./linked-resources";
import {
    exportDiagram,
    fitDiagramToViewport,
    getLinkedResourceOverlays,
    loadDiagram,
} from "./modeler";

export interface DiagramTab {
    readonly id: string;
    filePath: string | null;
    xml: string;
    dirty: boolean;
    hasBeenSaved: boolean;
    label: string;
}

let tabs: DiagramTab[] = [];
let activeTabId = "";
let scannedDirectory: string | null = null;
let siblingFiles: Map<string, string> = new Map();
let directoryIndex: ResourceIndex = { processes: [], decisions: [], forms: [] };

let tabBarElement: HTMLElement | null = null;
let chooserElement: HTMLElement | null = null;
let onActiveTabChanged: (() => void) | undefined;

function basenameOf(path: string): string {
    return path.split(/[\\/]/).pop() ?? path;
}

function dirnameOf(path: string): string {
    const idx = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
    return idx === -1 ? "." : path.slice(0, idx);
}

function joinPath(dir: string, file: string): string {
    if (dir === ".") return file;
    const sep = dir.includes("\\") && !dir.includes("/") ? "\\" : "/";
    return dir.endsWith(sep) ? `${dir}${file}` : `${dir}${sep}${file}`;
}

export function setChooserElement(el: HTMLElement): void {
    chooserElement = el;
}

export function hideCandidateChooser(): void {
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
            void openOrFocusTab(candidate.relativePath);
        });
        item.appendChild(button);
        list.appendChild(item);
    }
    chooserElement.appendChild(list);
    chooserElement.hidden = false;
}

/**
 * Bridges `LinkedResourceOverlays` badge clicks (which post VS Code-style
 * messages) to desktop tab navigation.
 */
export function handleLinkedResourceMessage(msg: unknown): void {
    if (!msg || typeof msg !== "object") return;
    const message = msg as { type?: string; relativePath?: string; candidates?: CallerCandidate[] };
    if (message.type === "openLinkedFile" && message.relativePath) {
        void openOrFocusTab(message.relativePath);
    } else if (message.type === "openLinkedFileChooser" && message.candidates) {
        showCandidateChooser(message.candidates);
    }
}

export function getActiveTab(): DiagramTab {
    const tab = tabs.find((t) => t.id === activeTabId);
    if (!tab) throw new Error("No active diagram tab");
    return tab;
}

export function updateActiveTab(
    patch: Partial<Pick<DiagramTab, "filePath" | "dirty" | "hasBeenSaved" | "xml">>,
): void {
    Object.assign(getActiveTab(), patch);
    renderTabBar();
}

export function markActiveTabDirty(): void {
    getActiveTab().dirty = true;
    renderTabBar();
}

function renderTabBar(): void {
    if (!tabBarElement) return;
    tabBarElement.innerHTML = "";
    if (tabs.length < 2) {
        tabBarElement.hidden = true;
        return;
    }
    tabBarElement.hidden = false;
    for (const tab of tabs) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = tab.id === activeTabId ? "desktop-tab active" : "desktop-tab";
        button.setAttribute("role", "tab");
        button.setAttribute("aria-selected", String(tab.id === activeTabId));
        button.title = tab.filePath ?? tab.label;
        button.textContent = tab.dirty ? `${tab.label} ●` : tab.label;
        button.addEventListener("click", () => {
            void switchToTab(tab.id);
        });
        tabBarElement.appendChild(button);
    }
}

async function refreshOverlaysForActiveTab(): Promise<ResolvedLink[]> {
    const overlays = getLinkedResourceOverlays();
    overlays.setVsCodeApi({ postMessage: handleLinkedResourceMessage });

    const tab = getActiveTab();
    if (!tab.filePath || siblingFiles.size === 0) {
        overlays.showLinks([]);
        return [];
    }

    const relativePath = basenameOf(tab.filePath);
    const links = await computeLinkedResources(tab.xml, relativePath, directoryIndex, siblingFiles);
    overlays.showLinks(links);
    return links;
}

/**
 * Sets up the tab bar and the initial (CLI-arg) tab. If that tab has a file
 * path, scans its directory (non-recursive) for linked diagrams and
 * auto-opens each direct link — forward (CallActivity/message) and caller
 * back-links — as a background tab alongside it.
 */
export async function initializeTabs(
    container: HTMLElement,
    main: { filePath: string | null; xml: string; hasBeenSaved: boolean },
    onChanged: () => void,
): Promise<void> {
    tabBarElement = container;
    onActiveTabChanged = onChanged;

    const id = main.filePath ?? "untitled";
    tabs = [
        {
            id,
            filePath: main.filePath,
            xml: main.xml,
            dirty: false,
            hasBeenSaved: main.hasBeenSaved,
            label: main.filePath ? basenameOf(main.filePath) : "Untitled diagram",
        },
    ];
    activeTabId = id;
    renderTabBar();

    if (!main.filePath) return;

    scannedDirectory = dirnameOf(main.filePath);
    siblingFiles = await loadSiblingBpmnFiles(main.filePath);
    directoryIndex = await buildDirectoryIndex(siblingFiles);

    const links = await refreshOverlaysForActiveTab();

    const mainRelativePath = basenameOf(main.filePath);
    const opened = new Set<string>([mainRelativePath]);
    for (const link of links) {
        if (opened.has(link.targetPath)) continue;
        opened.add(link.targetPath);
        const xml = siblingFiles.get(link.targetPath);
        if (xml === undefined) continue;
        tabs.push({
            id: joinPath(scannedDirectory, link.targetPath),
            filePath: joinPath(scannedDirectory, link.targetPath),
            xml,
            dirty: false,
            hasBeenSaved: true,
            label: link.targetPath,
        });
    }
    renderTabBar();
}

export async function switchToTab(id: string): Promise<void> {
    if (id === activeTabId) return;
    const target = tabs.find((t) => t.id === id);
    if (!target) return;

    const current = getActiveTab();
    current.xml = await exportDiagram();

    await loadDiagram(target.xml);
    activeTabId = id;

    fitDiagramToViewport();
    await refreshOverlaysForActiveTab();
    renderTabBar();
    onActiveTabChanged?.();
}

export async function switchToNextTab(): Promise<void> {
    if (tabs.length < 2) return;
    const idx = tabs.findIndex((t) => t.id === activeTabId);
    await switchToTab(tabs[(idx + 1) % tabs.length].id);
}

export async function switchToPreviousTab(): Promise<void> {
    if (tabs.length < 2) return;
    const idx = tabs.findIndex((t) => t.id === activeTabId);
    await switchToTab(tabs[(idx - 1 + tabs.length) % tabs.length].id);
}

/** Switches to the tab for `relativePath` (within the scanned directory), opening it first if needed. */
export async function openOrFocusTab(relativePath: string): Promise<void> {
    if (!scannedDirectory) return;
    const id = joinPath(scannedDirectory, relativePath);

    if (tabs.some((t) => t.id === id)) {
        await switchToTab(id);
        return;
    }

    const xml = siblingFiles.get(relativePath);
    if (xml === undefined) return;
    tabs.push({
        id,
        filePath: id,
        xml,
        dirty: false,
        hasBeenSaved: true,
        label: relativePath,
    });
    await switchToTab(id);
}
