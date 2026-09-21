import type { DiffResult, ChangesetOption } from "./diffViewer";
import {
    getOldDiPlane,
    getViewerViewport,
    getMarkedIds,
    highlightElement,
    applyConnectionStyle,
    showOldLayout,
    showNewLayout,
    hideElement,
    showElement,
    showOldAttrs,
    showNewAttrs,
    scrollToOldPosition,
} from "./diffViewer";
import { resolveAttrBeforeAfter } from "./diffUtils";
import { vscode } from "./main";

/**
 * Human-friendly labels for BPMN/Camunda attribute keys shown in the diff HUD.
 * Keys not found here are auto-humanized via camelCase → Title Case.
 */
const ATTR_LABELS: Record<string, string> = {
    // BPMN core
    name: "Name",
    id: "ID",
    isExecutable: "Executable",
    // Camunda async
    asyncBefore: "Async Before",
    asyncAfter: "Async After",
    exclusive: "Exclusive",
    jobPriority: "Job Priority",
    // Camunda service task
    class: "Java Class",
    expression: "Expression",
    delegateExpression: "Delegate Expression",
    resultVariable: "Result Variable",
    topic: "External Topic",
    type: "Type",
    // Camunda user task
    assignee: "Assignee",
    candidateUsers: "Candidate Users",
    candidateGroups: "Candidate Groups",
    dueDate: "Due Date",
    followUpDate: "Follow-up Date",
    priority: "Priority",
    formKey: "Form Key",
    formRef: "Form Reference",
    formRefBinding: "Form Ref Binding",
    formRefVersion: "Form Ref Version",
    // Camunda process
    historyTimeToLive: "History TTL",
    versionTag: "Version Tag",
    candidateStarterGroups: "Candidate Starter Groups",
    candidateStarterUsers: "Candidate Starter Users",
    isStartableInTasklist: "Startable in Tasklist",
    // Camunda call activity
    calledElementBinding: "Called Element Binding",
    calledElementVersion: "Called Element Version",
    calledElementVersionTag: "Called Element Version Tag",
    calledElementTenantId: "Called Element Tenant ID",
    variableMappingClass: "Variable Mapping Class",
    variableMappingDelegateExpression: "Variable Mapping Expression",
    // DMN
    decisionRef: "Decision Reference",
    decisionRefBinding: "Decision Ref Binding",
    decisionRefVersion: "Decision Ref Version",
    mapDecisionResult: "Map Decision Result",
    decisionRefTenantId: "Decision Ref Tenant ID",
    // Script
    resource: "Resource",
    // Meta / internal
    modelerTemplate: "Element Template",
    modelerTemplateVersion: "Element Template Version",
    // Extension elements
    "extensionElements[values]": "Extension Elements",
};

/**
 * Human-friendly row labels for extension element types.
 */
const EXT_TYPE_LABELS: Record<string, string> = {
    InputOutput: "Input / Output",
    ExecutionListener: "Execution Listener",
    TaskListener: "Task Listener",
    FailedJobRetryTimeCycle: "Retry Cycle",
    Properties: "Properties",
    Connector: "Connector",
    Field: "Field Injection",
    FormData: "Form Data",
};

/**
 * Convert a camelCase or PascalCase key to "Title Case" as a fallback label.
 * E.g. "asyncBefore" → "Async Before", "calledElementVersion" → "Called Element Version"
 */
function humanizeAttrKey(key: string): string {
    // Strip array-index suffixes like "extensionElements[values]" → "Extension Elements[values]"
    const explicit = ATTR_LABELS[key];
    if (explicit) return explicit;
    // Remove bracket suffixes for fallback humanization
    const base = key.replace(/\[.*\]$/, "");
    return base
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
        .replace(/^./, (c) => c.toUpperCase());
}

interface ChangeEntry {
    id: string;
    type: "added" | "removed" | "changed" | "layout-changed";
    label: string;
    details?: string;
    attrs?: Record<string, { oldValue: any; newValue: any }>;
}

/** Whether the Esc key listener for the HUD has been registered */
let hudEscRegistered = false;

/** Tracks which change types are currently visible (enabled = markers shown) */
const visibleTypes = new Set<string>(["added", "removed", "changed", "layout-changed"]);

/** Tracks individually disabled elements (by BPMN element ID) */
const disabledElements = new Set<string>();

/** Current canvas reference for marker manipulation */
let currentCanvas: any = null;
let currentChanges: DiffResult | null = null;

/** SVG group for ghost (removed) elements — lives in the viewport */
let ghostGroup: SVGGElement | null = null;

/** SVG group for ghost edges of layout-changed flows (old path) */
let layoutGhostGroup: SVGGElement | null = null;

/**
 * Render the changes sidebar: legend (with toggles) and clickable change list.
 * Also renders the changeset selector in the bottom bar.
 */
export function renderChangesSidebar(
    changes: DiffResult,
    canvas: any,
    _overlays: any,
    changesets: ChangesetOption[],
    currentRef: string,
    currentCompareRef: string = "CURRENT",
): void {
    currentCanvas = canvas;
    currentChanges = changes;
    visibleTypes.clear();
    visibleTypes.add("added");
    visibleTypes.add("removed");
    visibleTypes.add("changed");
    visibleTypes.add("layout-changed");
    disabledElements.clear();

    // Clean up any previous ghost group
    ghostGroup?.remove();
    ghostGroup = null;
    layoutGhostGroup?.remove();
    layoutGhostGroup = null;

    renderChangesetBar(changesets, currentCompareRef, currentRef);

    const legendEl = document.getElementById("diff-legend")!;
    const listEl = document.getElementById("diff-changes-list")!;

    const entries: ChangeEntry[] = [];

    // Collect all changes
    for (const [id, element] of Object.entries(changes._added)) {
        entries.push({ id, type: "added", label: formatElement(element) });
    }

    for (const [id, element] of Object.entries(changes._removed)) {
        entries.push({ id, type: "removed", label: formatElement(element) });
    }

    for (const [id, change] of Object.entries(changes._changed)) {
        // Sidebar shows human-friendly attribute names; HUD shows before/after detail.
        // Skip raw "extensionElements" when "extensionElements[values]" is also present.
        const hasValuesKey = "extensionElements[values]" in change.attrs;
        const attrKeys = Object.keys(change.attrs).filter(
            (k) => !(hasValuesKey && k === "extensionElements"),
        );
        const friendlyNames = attrKeys.map((k) => {
            if (k === "extensionElements[values]") {
                // Summarize by listing the changed extension types
                const oldVals: any[] = change.attrs[k].oldValue ?? [];
                const newVals: any[] = change.attrs[k].newValue ?? [];
                // Collect all types present
                const types = new Set<string>();
                for (const v of oldVals)
                    types.add((v?.$type ?? "").replace(/^[^:]+:/, "") || "Element");
                for (const v of newVals)
                    types.add((v?.$type ?? "").replace(/^[^:]+:/, "") || "Element");
                // Use friendly labels
                const labels = [...types].map((t) => EXT_TYPE_LABELS[t] ?? humanizeAttrKey(t));
                return labels.join(", ");
            }
            return humanizeAttrKey(k);
        });
        const attrSummary = friendlyNames.join(", ") || undefined;
        entries.push({
            id,
            type: "changed",
            label: formatElement(change.model),
            details: attrSummary,
            attrs: change.attrs,
        });
    }

    for (const [id, element] of Object.entries(changes._layoutChanged)) {
        entries.push({ id, type: "layout-changed", label: formatElement(element) });
    }

    // Counts
    const addedCount = Object.keys(changes._added).length;
    const removedCount = Object.keys(changes._removed).length;
    const changedCount = Object.keys(changes._changed).length;
    const layoutCount = Object.keys(changes._layoutChanged).length;
    const total = addedCount + removedCount + changedCount + layoutCount;

    // Render legend with toggleable items — all start enabled (including "removed" as ghosts)
    legendEl.innerHTML = `
        <h3>Changes (${total})</h3>
        <div class="legend-items">
            ${addedCount ? `<span class="legend-item legend-added" data-type="added" title="Toggle added elements" tabindex="0" role="button">Added: ${addedCount}</span>` : ""}
            ${removedCount ? `<span class="legend-item legend-removed" data-type="removed" title="Toggle removed element ghosts" tabindex="0" role="button">Removed: ${removedCount}</span>` : ""}
            ${changedCount ? `<span class="legend-item legend-changed" data-type="changed" title="Toggle changed elements" tabindex="0" role="button">Changed: ${changedCount}</span>` : ""}
            ${layoutCount ? `<span class="legend-item legend-layout" data-type="layout-changed" title="Toggle layout changes" tabindex="0" role="button">Layout: ${layoutCount}</span>` : ""}
        </div>
    `;

    // Attach toggle handlers to legend items
    legendEl.querySelectorAll(".legend-item[data-type]").forEach((item) => {
        item.addEventListener("click", () => {
            const type = (item as HTMLElement).dataset.type!;
            toggleChangeType(type, item as HTMLElement, listEl);
        });
        item.addEventListener("keydown", (e) => {
            const ke = e as KeyboardEvent;
            if (ke.key === " " || ke.key === "Spacebar" || ke.key === "Enter") {
                ke.preventDefault();
                const type = (item as HTMLElement).dataset.type!;
                toggleChangeType(type, item as HTMLElement, listEl);
            }
        });
    });

    if (total === 0) {
        listEl.innerHTML = `<p class="no-changes">No differences found</p>`;
        return;
    }

    // Render changes list
    listEl.innerHTML = "";
    for (const entry of entries) {
        const item = document.createElement("div");
        item.className = `change-item change-${entry.type}`;
        item.dataset.type = entry.type;
        item.dataset.elementId = entry.id;
        item.tabIndex = 0;
        item.setAttribute("role", "option");
        item.innerHTML = `
            <span class="change-indicator" title="Click to toggle this element"></span>
            <div class="change-text">
                <span class="change-label">${escapeHtml(entry.label)}</span>
                ${entry.details ? `<span class="change-details">${escapeHtml(entry.details)}</span>` : ""}
            </div>
        `;

        const indicator = item.querySelector(".change-indicator") as HTMLElement;
        const textEl = item.querySelector(".change-text") as HTMLElement;

        // Click bullet to toggle individual element
        indicator.addEventListener("click", (e) => {
            e.stopPropagation();
            toggleIndividualElement(entry.id, entry.type, item);
        });

        // Click text to navigate and highlight (all types navigate; changed items also open HUD)
        textEl.style.cursor = "pointer";
        textEl.addEventListener("click", (e) => {
            e.stopPropagation();
            listEl.querySelectorAll(".change-item.selected").forEach((el) => {
                el.classList.remove("selected");
            });
            item.classList.add("selected");
            if (entry.type === "removed") {
                closeHud();
                scrollToOldPosition(entry.id);
            } else {
                try {
                    canvas.scrollToElement(entry.id);
                } catch {
                    // element might not be scrollable
                }
                highlightElement(entry.id);
                if (entry.type === "changed" && entry.attrs) {
                    openHud(entry.label, entry.attrs);
                } else {
                    closeHud();
                }
            }
        });

        // Keyboard: Space toggles, Enter navigates
        item.addEventListener("keydown", (e) => {
            if (e.key === " " || e.key === "Spacebar") {
                e.preventDefault();
                toggleIndividualElement(entry.id, entry.type, item);
            } else if (e.key === "Enter") {
                e.preventDefault();
                // Capture state before mutating selection
                const wasAlreadySelected = item.classList.contains("selected");
                const hudIsOpen =
                    document.getElementById("diff-hud")?.classList.contains("visible") ?? false;
                listEl.querySelectorAll(".change-item.selected").forEach((el) => {
                    el.classList.remove("selected");
                });
                item.classList.add("selected");
                if (entry.type === "removed") {
                    closeHud();
                    scrollToOldPosition(entry.id);
                } else {
                    try {
                        canvas.scrollToElement(entry.id);
                    } catch {
                        /* skip */
                    }
                    highlightElement(entry.id);
                    if (entry.type === "changed" && entry.attrs) {
                        // Toggle: second Enter on the same selected item closes HUD
                        if (hudIsOpen && wasAlreadySelected) {
                            closeHud();
                        } else {
                            openHud(entry.label, entry.attrs);
                        }
                    } else {
                        closeHud();
                    }
                }
            } else if (e.key === "ArrowDown") {
                e.preventDefault();
                const next = findNextVisibleItem(item, listEl, 1);
                if (next) next.focus();
            } else if (e.key === "ArrowUp") {
                e.preventDefault();
                const prev = findNextVisibleItem(item, listEl, -1);
                if (prev) prev.focus();
            }
        });

        // Register Esc listener for HUD on first render
        if (!hudEscRegistered) {
            hudEscRegistered = true;
            document.addEventListener("keydown", (e) => {
                if (e.key === "Escape") closeHud();
            });
        }

        listEl.appendChild(item);
    }

    // Render ghost shapes immediately since removed is enabled by default
    renderGhostShapes();
    // Render old flow paths for layout-changed connections
    renderLayoutGhostEdges();
}

/**
 * Find the next visible (not hidden-type) change-item in a given direction.
 */
function findNextVisibleItem(
    current: HTMLElement,
    listEl: HTMLElement,
    direction: 1 | -1,
): HTMLElement | null {
    const items = Array.from(
        listEl.querySelectorAll<HTMLElement>(".change-item:not(.hidden-type)"),
    );
    const idx = items.indexOf(current);
    if (idx < 0) return items[0] ?? null;
    const next = items[idx + direction];
    return next ?? null;
}

/**
 * Toggle an individual element on/off from the changes list.
 */
function toggleIndividualElement(
    id: string,
    type: "added" | "removed" | "changed" | "layout-changed",
    itemEl: HTMLElement,
): void {
    if (disabledElements.has(id)) {
        disabledElements.delete(id);
        itemEl.classList.remove("item-disabled");
        enableElement(id, type);
    } else {
        disabledElements.add(id);
        itemEl.classList.add("item-disabled");
        disableElement(id, type);
    }
}

/**
 * Disable (deactivate) a single element — show its old state.
 */
function disableElement(id: string, type: string): void {
    if (type === "added") {
        try {
            currentCanvas?.removeMarker(id, "diff-added");
            const el = currentCanvas?._elementRegistry?.get(id);
            if (el?.label) currentCanvas?.removeMarker(el.label.id, "diff-added");
        } catch {
            /* skip */
        }
        hideElement(id);
        applyConnectionStyle(id, null);
    } else if (type === "changed") {
        try {
            currentCanvas?.removeMarker(id, "diff-changed");
            const el = currentCanvas?._elementRegistry?.get(id);
            if (el?.label) currentCanvas?.removeMarker(el.label.id, "diff-changed");
        } catch {
            /* skip */
        }
        if (currentChanges) {
            const change = currentChanges._changed[id];
            if (change) {
                showOldAttrs(id, change.attrs);
            }
        }
    } else if (type === "layout-changed") {
        try {
            currentCanvas?.removeMarker(id, "diff-layout-changed");
            const el = currentCanvas?._elementRegistry?.get(id);
            if (el?.label) currentCanvas?.removeMarker(el.label.id, "diff-layout-changed");
        } catch {
            /* skip */
        }
        showOldLayout(id);
    } else if (type === "removed") {
        renderGhostShapes();
    }
}

/**
 * Re-enable a single element — restore its new state with markers.
 */
function enableElement(id: string, type: string): void {
    if (type === "added") {
        showElement(id);
        if (visibleTypes.has("added")) {
            try {
                currentCanvas?.addMarker(id, "diff-added");
                const el = currentCanvas?._elementRegistry?.get(id);
                if (el?.label) currentCanvas?.addMarker(el.label.id, "diff-added");
            } catch {
                /* skip */
            }
            applyConnectionStyle(id, { stroke: "#28a745", strokeWidth: "3px" });
        }
    } else if (type === "changed") {
        showNewAttrs(id);
        if (visibleTypes.has("changed")) {
            try {
                currentCanvas?.addMarker(id, "diff-changed");
                const el = currentCanvas?._elementRegistry?.get(id);
                if (el?.label) currentCanvas?.addMarker(el.label.id, "diff-changed");
            } catch {
                /* skip */
            }
            applyConnectionStyle(id, { stroke: "#e67e00", strokeWidth: "3px" });
        }
    } else if (type === "layout-changed") {
        showNewLayout(id);
        if (visibleTypes.has("layout-changed")) {
            try {
                currentCanvas?.addMarker(id, "diff-layout-changed");
                const el = currentCanvas?._elementRegistry?.get(id);
                if (el?.label) currentCanvas?.addMarker(el.label.id, "diff-layout-changed");
            } catch {
                /* skip */
            }
            applyConnectionStyle(id, {
                stroke: "#007bff",
                strokeWidth: "3px",
                strokeDasharray: "6 3",
            });
        }
    } else if (type === "removed") {
        renderGhostShapes();
    }
}

/**
 * Toggle visibility of a change type.
 *
 * For "added": hide elements (they didn't exist before) / show with green markers
 * For "changed": restore old attribute values / show new with orange markers
 * For "layout-changed": move to old positions / show new positions with blue markers
 * For "removed": hide ghost shapes / show ghosts
 */
function toggleChangeType(type: string, legendItem: HTMLElement, listEl: HTMLElement): void {
    if (type === "removed") {
        toggleRemoved(legendItem, listEl);
    } else if (type === "added") {
        toggleAdded(legendItem, listEl);
    } else if (type === "changed") {
        toggleChanged(legendItem, listEl);
    } else if (type === "layout-changed") {
        toggleLayoutChanged(legendItem, listEl);
    }
}

/**
 * Toggle added elements.
 * OFF: hide added elements. ON: show them with green markers.
 */
function toggleAdded(legendItem: HTMLElement, listEl: HTMLElement): void {
    const markerClass = "diff-added";
    const ids = getMarkedIds(markerClass);

    if (visibleTypes.has("added")) {
        visibleTypes.delete("added");
        legendItem.classList.add("disabled");

        for (const id of ids) {
            try {
                currentCanvas?.removeMarker(id, markerClass);
            } catch {
                /* skip */
            }
        }
        if (currentChanges) {
            for (const id of Object.keys(currentChanges._added)) {
                hideElement(id);
                applyConnectionStyle(id, null);
            }
        }
        listEl.querySelectorAll('.change-item[data-type="added"]').forEach((el) => {
            el.classList.add("hidden-type");
        });
    } else {
        visibleTypes.add("added");
        legendItem.classList.remove("disabled");

        if (currentChanges) {
            for (const id of Object.keys(currentChanges._added)) {
                if (disabledElements.has(id)) continue;
                showElement(id);
                applyConnectionStyle(id, { stroke: "#28a745", strokeWidth: "3px" });
            }
        }
        for (const id of ids) {
            if (disabledElements.has(id)) continue;
            try {
                currentCanvas?.addMarker(id, markerClass);
            } catch {
                /* skip */
            }
        }
        listEl.querySelectorAll('.change-item[data-type="added"]').forEach((el) => {
            el.classList.remove("hidden-type");
        });
    }
}

/**
 * Toggle changed elements.
 * OFF: restore old attribute values. ON: show new values with orange markers.
 */
function toggleChanged(legendItem: HTMLElement, listEl: HTMLElement): void {
    const markerClass = "diff-changed";
    const ids = getMarkedIds(markerClass);

    if (visibleTypes.has("changed")) {
        visibleTypes.delete("changed");
        legendItem.classList.add("disabled");

        // Remove markers
        for (const id of ids) {
            try {
                currentCanvas?.removeMarker(id, markerClass);
            } catch {
                /* skip */
            }
        }
        // Restore old attribute values
        if (currentChanges) {
            for (const [id, change] of Object.entries(currentChanges._changed)) {
                showOldAttrs(id, change.attrs);
            }
        }
        listEl.querySelectorAll('.change-item[data-type="changed"]').forEach((el) => {
            el.classList.add("hidden-type");
        });
    } else {
        visibleTypes.add("changed");
        legendItem.classList.remove("disabled");

        // Restore new values (skip individually disabled)
        if (currentChanges) {
            for (const id of Object.keys(currentChanges._changed)) {
                if (disabledElements.has(id)) continue;
                showNewAttrs(id);
            }
        }

        // Re-add markers and inline styles for connections
        for (const id of ids) {
            if (disabledElements.has(id)) continue;
            try {
                currentCanvas?.addMarker(id, markerClass);
            } catch {
                /* skip */
            }
        }
        if (currentChanges) {
            for (const id of Object.keys(currentChanges._changed)) {
                if (disabledElements.has(id)) continue;
                applyConnectionStyle(id, { stroke: "#e67e00", strokeWidth: "3px" });
            }
        }
        listEl.querySelectorAll('.change-item[data-type="changed"]').forEach((el) => {
            el.classList.remove("hidden-type");
        });
    }
}

/**
 * Toggle layout-changed elements.
 * OFF: move to old positions. ON: show new positions with blue markers.
 */
function toggleLayoutChanged(legendItem: HTMLElement, listEl: HTMLElement): void {
    const markerClass = "diff-layout-changed";
    const ids = getMarkedIds(markerClass);

    if (visibleTypes.has("layout-changed")) {
        visibleTypes.delete("layout-changed");
        legendItem.classList.add("disabled");

        // Remove markers
        for (const id of ids) {
            try {
                currentCanvas?.removeMarker(id, markerClass);
            } catch {
                /* skip */
            }
        }
        // Move elements to old positions
        if (currentChanges) {
            for (const id of Object.keys(currentChanges._layoutChanged)) {
                showOldLayout(id);
            }
        }
        // Hide ghost edges
        removeLayoutGhostEdges();

        listEl.querySelectorAll('.change-item[data-type="layout-changed"]').forEach((el) => {
            el.classList.add("hidden-type");
        });
    } else {
        visibleTypes.add("layout-changed");
        legendItem.classList.remove("disabled");

        // Restore new positions (skip individually disabled)
        if (currentChanges) {
            for (const id of Object.keys(currentChanges._layoutChanged)) {
                if (disabledElements.has(id)) continue;
                showNewLayout(id);
            }
        }

        // Re-add markers and inline styles
        for (const id of ids) {
            if (disabledElements.has(id)) continue;
            try {
                currentCanvas?.addMarker(id, markerClass);
            } catch {
                /* skip */
            }
        }
        if (currentChanges) {
            for (const id of Object.keys(currentChanges._layoutChanged)) {
                if (disabledElements.has(id)) continue;
                applyConnectionStyle(id, {
                    stroke: "#007bff",
                    strokeWidth: "3px",
                    strokeDasharray: "6 3",
                });
            }
        }

        // Show ghost edges again
        renderLayoutGhostEdges();

        listEl.querySelectorAll('.change-item[data-type="layout-changed"]').forEach((el) => {
            el.classList.remove("hidden-type");
        });
    }
}

/**
 * Toggle removed elements visibility (reverse logic).
 * When enabling: render ghost shapes from old DI at their original positions.
 * When disabling: remove ghost shapes.
 */
function toggleRemoved(legendItem: HTMLElement, listEl: HTMLElement): void {
    if (visibleTypes.has("removed")) {
        // Currently showing ghosts → hide them
        visibleTypes.delete("removed");
        legendItem.classList.add("disabled");
        removeGhostShapes();
        listEl.querySelectorAll('.change-item[data-type="removed"]').forEach((el) => {
            el.classList.add("hidden-type");
        });
    } else {
        // Currently hidden → show ghosts
        visibleTypes.add("removed");
        legendItem.classList.remove("disabled");
        renderGhostShapes();
        listEl.querySelectorAll('.change-item[data-type="removed"]').forEach((el) => {
            el.classList.remove("hidden-type");
        });
    }
}

/**
 * Render removed elements as ghost shapes on the canvas using proper BPMN shapes.
 * Events = circles, Tasks = rounded rectangles, Gateways = diamonds, etc.
 */
function renderGhostShapes(): void {
    removeGhostShapes();
    if (!currentChanges) return;

    const viewport = getViewerViewport();
    if (!viewport) return;

    const removedIds = new Set(Object.keys(currentChanges._removed));
    if (removedIds.size === 0) return;

    // Skip individually disabled elements
    for (const id of disabledElements) {
        removedIds.delete(id);
    }
    if (removedIds.size === 0) return;

    const plane = getOldDiPlane();
    if (plane.length === 0) return;

    // Create a group for ghost elements
    ghostGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
    ghostGroup.classList.add("diff-ghost-group");

    for (const di of plane) {
        const elementId = di.bpmnElement?.id;
        if (!elementId || !removedIds.has(elementId)) continue;

        if (di.$type === "bpmndi:BPMNShape" && di.bounds) {
            const { x, y, width, height } = di.bounds;
            const bpmnType = currentChanges._removed[elementId]?.$type ?? "";
            const shape = createGhostShape(bpmnType, x, y, width, height);
            ghostGroup.appendChild(shape);

            // Add element name as label
            const name = currentChanges._removed[elementId]?.name;
            if (name) {
                const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
                label.setAttribute("x", String(x + width / 2));
                label.setAttribute("y", String(y + height + 14));
                label.setAttribute("text-anchor", "middle");
                label.setAttribute("font-size", "11");
                label.setAttribute("fill", "#dc3545");
                label.setAttribute("opacity", "0.8");
                label.textContent = name;
                ghostGroup.appendChild(label);
            }
        } else if (di.$type === "bpmndi:BPMNEdge" && di.waypoint?.length >= 2) {
            // Render edge as a dashed red polyline
            const points = di.waypoint.map((wp: any) => `${wp.x},${wp.y}`).join(" ");
            const polyline = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
            polyline.setAttribute("points", points);
            polyline.setAttribute("fill", "none");
            polyline.setAttribute("stroke", "#dc3545");
            polyline.setAttribute("stroke-width", "2");
            polyline.setAttribute("stroke-dasharray", "6 3");
            polyline.setAttribute("opacity", "0.6");
            ghostGroup.appendChild(polyline);
        }
    }

    // Insert ghost group before normal layers
    const firstLayer = viewport.querySelector('g[class*="layer-"]');
    if (firstLayer) {
        viewport.insertBefore(ghostGroup, firstLayer);
    } else {
        viewport.appendChild(ghostGroup);
    }
}

/**
 * Create an SVG ghost shape appropriate for the given BPMN element type.
 */
function createGhostShape(
    bpmnType: string,
    x: number,
    y: number,
    width: number,
    height: number,
): SVGElement {
    const STROKE = "#dc3545";
    const FILL = "rgba(220, 53, 69, 0.08)";
    const DASH = "6 3";

    if (bpmnType.includes("Event")) {
        // Events: circle
        const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        circle.setAttribute("cx", String(x + width / 2));
        circle.setAttribute("cy", String(y + height / 2));
        circle.setAttribute("r", String(Math.min(width, height) / 2));
        circle.setAttribute("fill", FILL);
        circle.setAttribute("stroke", STROKE);
        circle.setAttribute("stroke-width", bpmnType.includes("End") ? "3" : "2");
        circle.setAttribute("stroke-dasharray", DASH);
        return circle;
    }

    if (bpmnType.includes("Gateway")) {
        // Gateways: diamond (rotated square)
        const cx = x + width / 2;
        const cy = y + height / 2;
        const hw = width / 2;
        const hh = height / 2;
        const diamond = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
        diamond.setAttribute(
            "points",
            `${cx},${cy - hh} ${cx + hw},${cy} ${cx},${cy + hh} ${cx - hw},${cy}`,
        );
        diamond.setAttribute("fill", FILL);
        diamond.setAttribute("stroke", STROKE);
        diamond.setAttribute("stroke-width", "2");
        diamond.setAttribute("stroke-dasharray", DASH);
        return diamond;
    }

    if (bpmnType.includes("DataObject") || bpmnType.includes("DataStore")) {
        // Data objects: simple rect (no rounded corners)
        const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        rect.setAttribute("x", String(x));
        rect.setAttribute("y", String(y));
        rect.setAttribute("width", String(width));
        rect.setAttribute("height", String(height));
        rect.setAttribute("fill", FILL);
        rect.setAttribute("stroke", STROKE);
        rect.setAttribute("stroke-width", "2");
        rect.setAttribute("stroke-dasharray", DASH);
        return rect;
    }

    // Default (Tasks, SubProcesses, Participants, etc.): rounded rectangle
    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute("x", String(x));
    rect.setAttribute("y", String(y));
    rect.setAttribute("width", String(width));
    rect.setAttribute("height", String(height));
    rect.setAttribute("rx", "10");
    rect.setAttribute("ry", "10");
    rect.setAttribute("fill", FILL);
    rect.setAttribute("stroke", STROKE);
    rect.setAttribute("stroke-width", "2");
    rect.setAttribute("stroke-dasharray", DASH);
    return rect;
}

/**
 * Remove all ghost shapes from the canvas.
 */
function removeGhostShapes(): void {
    ghostGroup?.remove();
    ghostGroup = null;
}

/**
 * Render old flow paths for layout-changed connections as ghost edges.
 * Shows where a flow USED TO go before the layout change.
 */
function renderLayoutGhostEdges(): void {
    removeLayoutGhostEdges();
    if (!currentChanges) return;

    const viewport = getViewerViewport();
    if (!viewport) return;

    const layoutChangedIds = new Set(Object.keys(currentChanges._layoutChanged));
    if (layoutChangedIds.size === 0) return;

    const plane = getOldDiPlane();
    if (plane.length === 0) return;

    layoutGhostGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
    layoutGhostGroup.classList.add("diff-ghost-group");

    for (const di of plane) {
        const elementId = di.bpmnElement?.id;
        if (!elementId || !layoutChangedIds.has(elementId)) continue;

        // Only render edges (flows), not shapes — shapes are already colored in place
        if (di.$type === "bpmndi:BPMNEdge" && di.waypoint?.length >= 2) {
            const points = di.waypoint.map((wp: any) => `${wp.x},${wp.y}`).join(" ");
            const polyline = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
            polyline.setAttribute("points", points);
            polyline.classList.add("ghost-layout-edge");
            layoutGhostGroup.appendChild(polyline);
        }
    }

    if (layoutGhostGroup.childElementCount === 0) {
        layoutGhostGroup = null;
        return;
    }

    // Insert behind normal layers (same strategy as ghost shapes)
    const firstLayer = viewport.querySelector('g[class*="layer-"]');
    if (firstLayer) {
        viewport.insertBefore(layoutGhostGroup, firstLayer);
    } else {
        viewport.appendChild(layoutGhostGroup);
    }
}

/**
 * Remove layout ghost edges from the canvas.
 */
function removeLayoutGhostEdges(): void {
    layoutGhostGroup?.remove();
    layoutGhostGroup = null;
}

/**
 * Get element IDs for a given change type from the current diff.
 */
// getIdsForType is no longer needed — getMarkedIds() from diffViewer is used directly

/**
 * Render the two-selector bar below the diagram:
 *   "Compare version" (newer/top) — what we diff FROM
 *   "Compare against"  (older/bottom) — what we diff TO
 *
 * The full ordered version list is: [CURRENT, ...changesets] (newest first).
 * Invariant: compareIdx < againstIdx in that list.
 *
 * On re-renders the option lists are rebuilt but the bar shell is reused.
 */
function renderChangesetBar(
    changesets: ChangesetOption[],
    currentCompareRef: string,
    currentRef: string,
): void {
    const container = document.getElementById("diff-changeset-bar")!;

    if (changesets.length === 0) {
        container.style.display = "none";
        return;
    }

    container.style.display = "flex";

    // Full ordered list: CURRENT is always index 0, then changesets newest→oldest
    const fullList: ChangesetOption[] = [
        { ref: "CURRENT", label: "CURRENT", description: "Working tree (unsaved + saved changes)" },
        ...changesets,
    ];

    // Indices of current selections in fullList
    const compareIdx = fullList.findIndex((c) => c.ref === currentCompareRef);
    const againstIdx = fullList.findIndex((c) => c.ref === currentRef);

    // Safe fallbacks if refs not found
    const safeCompareIdx = compareIdx < 0 ? 0 : compareIdx;
    const safeAgainstIdx =
        againstIdx < 0 || againstIdx <= safeCompareIdx ? safeCompareIdx + 1 : againstIdx;

    /** Build <option> tags for a subset of fullList */
    function buildOptions(items: ChangesetOption[], selectedRef: string): string {
        return items
            .map(
                (cs) =>
                    `<option value="${escapeHtml(cs.ref)}" ${cs.ref === selectedRef ? "selected" : ""}>${escapeHtml(cs.label)} — ${escapeHtml(cs.description)}</option>`,
            )
            .join("");
    }

    const compareOptions = fullList.slice(0, safeAgainstIdx);
    const againstOptions = fullList.slice(safeCompareIdx + 1);

    const compareSelect = document.getElementById(
        "compare-version-select",
    ) as HTMLSelectElement | null;
    const againstSelect = document.getElementById("changeset-select") as HTMLSelectElement | null;

    if (compareSelect && againstSelect) {
        // Bar already exists — just update option lists and selected values
        compareSelect.innerHTML = buildOptions(compareOptions, fullList[safeCompareIdx].ref);
        againstSelect.innerHTML = buildOptions(againstOptions, fullList[safeAgainstIdx].ref);
        return;
    }

    // First render: build the full bar HTML
    container.innerHTML = `
        <div class="changeset-row">
            <label class="changeset-label" for="compare-version-select">Compare version</label>
            <select id="compare-version-select" class="changeset-select">
                ${buildOptions(compareOptions, fullList[safeCompareIdx].ref)}
            </select>
        </div>
        <div class="changeset-row">
            <label class="changeset-label" for="changeset-select">Compare against</label>
            <select id="changeset-select" class="changeset-select">
                ${buildOptions(againstOptions, fullList[safeAgainstIdx].ref)}
            </select>
        </div>
    `;

    const newCompareSelect = document.getElementById("compare-version-select") as HTMLSelectElement;
    const newAgainstSelect = document.getElementById("changeset-select") as HTMLSelectElement;

    /** Post a requestDiff message and rebuild the opposite select's options */
    function postDiff(): void {
        const cRef = newCompareSelect.value;
        const aRef = newAgainstSelect.value;
        const cIdx = fullList.findIndex((c) => c.ref === cRef);
        const aIdx = fullList.findIndex((c) => c.ref === aRef);
        // Invariant: cIdx < aIdx. Both selects only show valid options, so this should hold.
        // Rebuild opposite options to keep them in sync with current selection.
        newCompareSelect.innerHTML = buildOptions(fullList.slice(0, aIdx), cRef);
        newAgainstSelect.innerHTML = buildOptions(fullList.slice(cIdx + 1), aRef);
        vscode.postMessage({ type: "requestDiff", compareRef: cRef, againstRef: aRef });
    }

    newCompareSelect.addEventListener("change", postDiff);
    newCompareSelect.addEventListener("keyup", (e) => {
        if (e.key === "ArrowUp" || e.key === "ArrowDown") postDiff();
    });

    newAgainstSelect.addEventListener("change", postDiff);
    newAgainstSelect.addEventListener("keyup", (e) => {
        if (e.key === "ArrowUp" || e.key === "ArrowDown") postDiff();
    });
}

function formatElement(element: any): string {
    const type = element.$type?.replace("bpmn:", "") ?? "Element";
    const name = element.name ?? element.id ?? "";
    return name ? `${type}: ${name}` : `${type} (${element.id ?? "?"})`;
}

function escapeHtml(str: string): string {
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

/**
 * JSON replacer that strips BPMN moddle circular/internal references.
 */
function bpmnSafeReplacer(key: string, val: any): any {
    if (key === "$parent" || key === "di" || key === "$descriptor" || key === "$model")
        return undefined;
    return val;
}

/**
 * Format an attribute value for display in the HUD.
 */
function formatAttrValue(value: any): { html: string; isEmpty: boolean } {
    if (value === null || value === undefined || value === "") {
        return { html: `<span class="hud-val-none">(none)</span>`, isEmpty: true };
    }
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        const s = String(value);
        if (typeof value === "string" && (s.includes("\n") || s.length > 120)) {
            return { html: `<pre class="hud-code">${escapeHtml(s)}</pre>`, isEmpty: false };
        }
        return { html: escapeHtml(s), isEmpty: false };
    }
    // Objects (including arrays of BPMN extension element objects)
    if (typeof value === "object") {
        // Script/expression shorthand: use body or resource directly
        if (!Array.isArray(value)) {
            const script = value.body ?? value.resource ?? null;
            if (script !== null) {
                const lang = value.language
                    ? `<span class="hud-val-type">${escapeHtml(String(value.language))}</span> `
                    : "";
                return {
                    html: `${lang}<pre class="hud-code">${escapeHtml(String(script))}</pre>`,
                    isEmpty: false,
                };
            }
        }
        try {
            const s = JSON.stringify(value, bpmnSafeReplacer, 2);
            const truncated = s.length > 2000 ? s.slice(0, 2000) + "\u2026" : s;
            return {
                html: `<pre class="hud-code">${escapeHtml(truncated)}</pre>`,
                isEmpty: s === "null" || s === "[]" || s === "{}",
            };
        } catch {
            return { html: escapeHtml(String(value)), isEmpty: false };
        }
    }
    return { html: escapeHtml(String(value)), isEmpty: false };
}

/**
 * Summarize a single extension element child for the HUD.
 * Returns a short one-line description appropriate for its type.
 */
function summarizeExtensionChild(child: any): string {
    if (!child || typeof child !== "object") return "(unknown)";
    const rawType: string = child.$type ?? "";
    const shortType = rawType.replace(/^[^:]+:/, "");

    if (shortType === "FailedJobRetryTimeCycle") {
        return child.body ?? "(empty)";
    }
    if (shortType === "InputOutput") {
        const inputs = child.inputParameters?.length ?? 0;
        const outputs = child.outputParameters?.length ?? 0;
        return `${inputs} input(s), ${outputs} output(s)`;
    }
    if (shortType === "ExecutionListener" || shortType === "TaskListener") {
        const event = child.event ?? "?";
        const impl = child.class ?? child.expression ?? child.delegateExpression ?? "?";
        return `${event}: ${impl}`;
    }
    if (shortType === "Properties") {
        const count = child.values?.length ?? 0;
        return `${count} propert${count === 1 ? "y" : "ies"}`;
    }
    if (shortType === "Connector") {
        const id = child.connectorId ?? "?";
        return `connectorId: ${id}`;
    }
    if (shortType === "Field") {
        const name = child.name ?? "?";
        const val = child.string ?? child.expression ?? "(complex)";
        return `${name} = ${val}`;
    }
    // Fallback: show key attributes (excluding $type and internal keys)
    const keys = Object.keys(child).filter((k) => !k.startsWith("$"));
    if (keys.length === 0) return "(empty)";
    const pairs = keys
        .slice(0, 3)
        .map((k) => {
            const v = child[k];
            if (v === null || v === undefined) return null;
            if (typeof v === "object") return `${k}: (...)`;
            return `${k}: ${String(v).slice(0, 40)}`;
        })
        .filter(Boolean);
    return pairs.join(", ") || "(complex)";
}

/**
 * Summarize a single input/output parameter for display.
 */
function summarizeParam(param: any): string {
    if (!param || typeof param !== "object") return "(unknown)";
    const name = param.name ?? "?";
    // Value sources (in priority order)
    if (param.value !== undefined && param.value !== null)
        return `${name} = ${String(param.value).slice(0, 60)}`;
    if (param.list) return `${name} = [list]`;
    if (param.map) return `${name} = {map}`;
    if (param.script) {
        const lang = param.script?.scriptFormat ?? "";
        return `${name} = script(${lang})`;
    }
    return name;
}

/**
 * Render per-parameter diff lines for an InputOutput child.
 * Matches parameters by name, then shows added/removed/modified individually.
 */
function renderInputOutputDiff(
    oldIO: any,
    newIO: any,
    beforeLines: string[],
    afterLines: string[],
): void {
    const sections: { label: string; oldKey: string; newKey: string }[] = [
        { label: "Input", oldKey: "inputParameters", newKey: "inputParameters" },
        { label: "Output", oldKey: "outputParameters", newKey: "outputParameters" },
    ];

    for (const { label, oldKey, newKey } of sections) {
        const oldParams: any[] = oldIO?.[oldKey] ?? [];
        const newParams: any[] = newIO?.[newKey] ?? [];

        // Index by name for matching
        const oldByName = new Map<string, any>();
        for (const p of oldParams) oldByName.set(p.name ?? "", p);
        const newByName = new Map<string, any>();
        for (const p of newParams) newByName.set(p.name ?? "", p);

        // All parameter names in order (old first, then new-only)
        const allNames: string[] = [];
        for (const n of oldByName.keys()) allNames.push(n);
        for (const n of newByName.keys()) {
            if (!allNames.includes(n)) allNames.push(n);
        }

        for (const name of allNames) {
            const oldP = oldByName.get(name);
            const newP = newByName.get(name);

            if (oldP && !newP) {
                beforeLines.push(
                    `<div class="ext-child ext-removed"><span class="ext-indicator">−</span><span class="ext-type">${escapeHtml(label)}</span> ${escapeHtml(summarizeParam(oldP))}</div>`,
                );
                afterLines.push(
                    `<div class="ext-child ext-removed-placeholder"><span class="hud-val-none">(removed)</span></div>`,
                );
            } else if (!oldP && newP) {
                beforeLines.push(
                    `<div class="ext-child ext-added-placeholder"><span class="hud-val-none">(none)</span></div>`,
                );
                afterLines.push(
                    `<div class="ext-child ext-added"><span class="ext-indicator">+</span><span class="ext-type">${escapeHtml(label)}</span> ${escapeHtml(summarizeParam(newP))}</div>`,
                );
            } else if (oldP && newP) {
                try {
                    const oldJson = JSON.stringify(oldP, bpmnSafeReplacer);
                    const newJson = JSON.stringify(newP, bpmnSafeReplacer);
                    if (oldJson === newJson) {
                        const summary = summarizeParam(oldP);
                        beforeLines.push(
                            `<div class="ext-child ext-unchanged"><span class="ext-type">${escapeHtml(label)}</span> ${escapeHtml(summary)}</div>`,
                        );
                        afterLines.push(
                            `<div class="ext-child ext-unchanged"><span class="ext-type">${escapeHtml(label)}</span> ${escapeHtml(summary)}</div>`,
                        );
                        continue;
                    }
                } catch {
                    /* fall through to modified */
                }
                beforeLines.push(
                    `<div class="ext-child ext-modified"><span class="ext-indicator">~</span><span class="ext-type">${escapeHtml(label)}</span> ${escapeHtml(summarizeParam(oldP))}</div>`,
                );
                afterLines.push(
                    `<div class="ext-child ext-modified"><span class="ext-indicator">~</span><span class="ext-type">${escapeHtml(label)}</span> ${escapeHtml(summarizeParam(newP))}</div>`,
                );
            }
        }
    }
}

/**
 * Render per-property diff lines for a camunda:Properties child.
 * Matches properties by name, then shows added/removed/modified individually.
 */
function renderPropertiesDiff(
    oldProps: any,
    newProps: any,
    beforeLines: string[],
    afterLines: string[],
): void {
    const oldItems: any[] = oldProps?.values ?? [];
    const newItems: any[] = newProps?.values ?? [];

    // Index by name
    const oldByName = new Map<string, any>();
    for (const p of oldItems) oldByName.set(p.name ?? p.id ?? "", p);
    const newByName = new Map<string, any>();
    for (const p of newItems) newByName.set(p.name ?? p.id ?? "", p);

    const allNames: string[] = [];
    for (const n of oldByName.keys()) allNames.push(n);
    for (const n of newByName.keys()) {
        if (!allNames.includes(n)) allNames.push(n);
    }

    for (const name of allNames) {
        const oldP = oldByName.get(name);
        const newP = newByName.get(name);
        const summarize = (p: any) => `${p.name ?? "?"} = ${p.value ?? "(empty)"}`;

        if (oldP && !newP) {
            beforeLines.push(
                `<div class="ext-child ext-removed"><span class="ext-indicator">−</span><span class="ext-type">Property</span> ${escapeHtml(summarize(oldP))}</div>`,
            );
            afterLines.push(
                `<div class="ext-child ext-removed-placeholder"><span class="hud-val-none">(removed)</span></div>`,
            );
        } else if (!oldP && newP) {
            beforeLines.push(
                `<div class="ext-child ext-added-placeholder"><span class="hud-val-none">(none)</span></div>`,
            );
            afterLines.push(
                `<div class="ext-child ext-added"><span class="ext-indicator">+</span><span class="ext-type">Property</span> ${escapeHtml(summarize(newP))}</div>`,
            );
        } else if (oldP && newP) {
            const oldVal = oldP.value ?? "";
            const newVal = newP.value ?? "";
            if (oldVal === newVal) {
                beforeLines.push(
                    `<div class="ext-child ext-unchanged"><span class="ext-type">Property</span> ${escapeHtml(summarize(oldP))}</div>`,
                );
                afterLines.push(
                    `<div class="ext-child ext-unchanged"><span class="ext-type">Property</span> ${escapeHtml(summarize(newP))}</div>`,
                );
            } else {
                beforeLines.push(
                    `<div class="ext-child ext-modified"><span class="ext-indicator">~</span><span class="ext-type">Property</span> ${escapeHtml(summarize(oldP))}</div>`,
                );
                afterLines.push(
                    `<div class="ext-child ext-modified"><span class="ext-indicator">~</span><span class="ext-type">Property</span> ${escapeHtml(summarize(newP))}</div>`,
                );
            }
        }
    }
}

/**
 * Match extension element children arrays and produce a per-child diff summary.
 * Returns HTML for the "Extension Elements" row in the HUD.
 * For InputOutput children, drills down to show individual parameter changes.
 * For Properties children, drills down to show individual property changes.
 */
function renderExtensionElementsDiff(
    oldValues: any[],
    newValues: any[],
): { beforeHtml: string; afterHtml: string } {
    // Build type-indexed lists for matching
    const oldByType = new Map<string, any[]>();
    for (const child of oldValues) {
        const t = child?.$type ?? "";
        if (!oldByType.has(t)) oldByType.set(t, []);
        oldByType.get(t)!.push(child);
    }
    const newByType = new Map<string, any[]>();
    for (const child of newValues) {
        const t = child?.$type ?? "";
        if (!newByType.has(t)) newByType.set(t, []);
        newByType.get(t)!.push(child);
    }

    // Collect all types in order (old first, then new-only)
    const allTypes: string[] = [];
    for (const t of oldByType.keys()) allTypes.push(t);
    for (const t of newByType.keys()) {
        if (!allTypes.includes(t)) allTypes.push(t);
    }

    const beforeLines: string[] = [];
    const afterLines: string[] = [];

    for (const type of allTypes) {
        const oldChildren = oldByType.get(type) ?? [];
        const newChildren = newByType.get(type) ?? [];
        const shortType = type.replace(/^[^:]+:/, "") || "Element";
        const isInputOutput = shortType === "InputOutput";
        const isProperties = shortType === "Properties";
        const isConnector = shortType === "Connector";
        const maxLen = Math.max(oldChildren.length, newChildren.length);

        for (let i = 0; i < maxLen; i++) {
            const oldChild = oldChildren[i];
            const newChild = newChildren[i];

            if (oldChild && !newChild) {
                // Removed
                if (isInputOutput) {
                    renderInputOutputDiff(oldChild, null, beforeLines, afterLines);
                } else if (isProperties) {
                    renderPropertiesDiff(oldChild, null, beforeLines, afterLines);
                } else if (isConnector) {
                    // Show connectorId removal + nested IO
                    beforeLines.push(
                        `<div class="ext-child ext-removed"><span class="ext-indicator">−</span><span class="ext-type">Connector</span> ${escapeHtml(oldChild.connectorId ?? "?")}</div>`,
                    );
                    afterLines.push(
                        `<div class="ext-child ext-removed-placeholder"><span class="hud-val-none">(removed)</span></div>`,
                    );
                    if (oldChild.inputOutput) {
                        renderInputOutputDiff(oldChild.inputOutput, null, beforeLines, afterLines);
                    }
                } else {
                    beforeLines.push(
                        `<div class="ext-child ext-removed"><span class="ext-indicator">−</span><span class="ext-type">${escapeHtml(shortType)}</span> ${escapeHtml(summarizeExtensionChild(oldChild))}</div>`,
                    );
                    afterLines.push(
                        `<div class="ext-child ext-removed-placeholder"><span class="hud-val-none">(removed)</span></div>`,
                    );
                }
            } else if (!oldChild && newChild) {
                // Added
                if (isInputOutput) {
                    renderInputOutputDiff(null, newChild, beforeLines, afterLines);
                } else if (isProperties) {
                    renderPropertiesDiff(null, newChild, beforeLines, afterLines);
                } else if (isConnector) {
                    beforeLines.push(
                        `<div class="ext-child ext-added-placeholder"><span class="hud-val-none">(none)</span></div>`,
                    );
                    afterLines.push(
                        `<div class="ext-child ext-added"><span class="ext-indicator">+</span><span class="ext-type">Connector</span> ${escapeHtml(newChild.connectorId ?? "?")}</div>`,
                    );
                    if (newChild.inputOutput) {
                        renderInputOutputDiff(null, newChild.inputOutput, beforeLines, afterLines);
                    }
                } else {
                    beforeLines.push(
                        `<div class="ext-child ext-added-placeholder"><span class="hud-val-none">(none)</span></div>`,
                    );
                    afterLines.push(
                        `<div class="ext-child ext-added"><span class="ext-indicator">+</span><span class="ext-type">${escapeHtml(shortType)}</span> ${escapeHtml(summarizeExtensionChild(newChild))}</div>`,
                    );
                }
            } else if (oldChild && newChild) {
                // Both exist — check if they differ
                if (isInputOutput) {
                    renderInputOutputDiff(oldChild, newChild, beforeLines, afterLines);
                } else if (isProperties) {
                    renderPropertiesDiff(oldChild, newChild, beforeLines, afterLines);
                } else if (isConnector) {
                    // Show connectorId change if applicable
                    if (oldChild.connectorId !== newChild.connectorId) {
                        beforeLines.push(
                            `<div class="ext-child ext-modified"><span class="ext-indicator">~</span><span class="ext-type">Connector</span> ${escapeHtml(oldChild.connectorId ?? "?")}</div>`,
                        );
                        afterLines.push(
                            `<div class="ext-child ext-modified"><span class="ext-indicator">~</span><span class="ext-type">Connector</span> ${escapeHtml(newChild.connectorId ?? "?")}</div>`,
                        );
                    }
                    // Drill into connector's nested inputOutput
                    renderInputOutputDiff(
                        oldChild.inputOutput ?? null,
                        newChild.inputOutput ?? null,
                        beforeLines,
                        afterLines,
                    );
                } else {
                    let oldSummary: string;
                    let newSummary: string;
                    try {
                        const oldJson = JSON.stringify(oldChild, bpmnSafeReplacer);
                        const newJson = JSON.stringify(newChild, bpmnSafeReplacer);
                        if (oldJson === newJson) {
                            const summary = summarizeExtensionChild(oldChild);
                            beforeLines.push(
                                `<div class="ext-child ext-unchanged"><span class="ext-type">${escapeHtml(shortType)}</span> ${escapeHtml(summary)}</div>`,
                            );
                            afterLines.push(
                                `<div class="ext-child ext-unchanged"><span class="ext-type">${escapeHtml(shortType)}</span> ${escapeHtml(summary)}</div>`,
                            );
                            continue;
                        }
                        oldSummary = summarizeExtensionChild(oldChild);
                        newSummary = summarizeExtensionChild(newChild);
                    } catch {
                        oldSummary = "(error)";
                        newSummary = "(error)";
                    }
                    beforeLines.push(
                        `<div class="ext-child ext-modified"><span class="ext-indicator">~</span><span class="ext-type">${escapeHtml(shortType)}</span> ${escapeHtml(oldSummary)}</div>`,
                    );
                    afterLines.push(
                        `<div class="ext-child ext-modified"><span class="ext-indicator">~</span><span class="ext-type">${escapeHtml(shortType)}</span> ${escapeHtml(newSummary)}</div>`,
                    );
                }
            }
        }
    }

    return {
        beforeHtml:
            beforeLines.length > 0
                ? `<div class="ext-diff-list">${beforeLines.join("")}</div>`
                : `<span class="hud-val-none">(none)</span>`,
        afterHtml:
            afterLines.length > 0
                ? `<div class="ext-diff-list">${afterLines.join("")}</div>`
                : `<span class="hud-val-none">(none)</span>`,
    };
}

/**
 * Render extension element changes as individual HUD table rows (one per type).
 * Uses NATURAL naming: oldValues = Before, newValues = After.
 */
function renderExtensionElementsRows(oldValues: any[], newValues: any[]): string {
    const oldArr = Array.isArray(oldValues) ? oldValues : [];
    const newArr = Array.isArray(newValues) ? newValues : [];

    // Group by type
    const oldByType = new Map<string, any[]>();
    for (const child of oldArr) {
        const t = child?.$type ?? "";
        if (!oldByType.has(t)) oldByType.set(t, []);
        oldByType.get(t)!.push(child);
    }
    const newByType = new Map<string, any[]>();
    for (const child of newArr) {
        const t = child?.$type ?? "";
        if (!newByType.has(t)) newByType.set(t, []);
        newByType.get(t)!.push(child);
    }

    // Collect all types in order
    const allTypes: string[] = [];
    for (const t of oldByType.keys()) allTypes.push(t);
    for (const t of newByType.keys()) {
        if (!allTypes.includes(t)) allTypes.push(t);
    }

    // Filter out types with no actual changes
    const changedTypes = allTypes.filter((type) => {
        const oldChildren = oldByType.get(type) ?? [];
        const newChildren = newByType.get(type) ?? [];
        try {
            return (
                JSON.stringify(oldChildren, bpmnSafeReplacer) !==
                JSON.stringify(newChildren, bpmnSafeReplacer)
            );
        } catch {
            return true;
        }
    });

    if (changedTypes.length === 0) return "";

    const rows: string[] = [];

    for (const type of changedTypes) {
        const oldChildren = oldByType.get(type) ?? [];
        const newChildren = newByType.get(type) ?? [];
        const shortType = type.replace(/^[^:]+:/, "") || "Element";
        const rowLabel = EXT_TYPE_LABELS[shortType] ?? humanizeAttrKey(shortType);

        // For InputOutput, Properties, Connector — render per-item diff via existing helpers
        const isInputOutput = shortType === "InputOutput";
        const isProperties = shortType === "Properties";
        const isConnector = shortType === "Connector";

        if (isInputOutput || isProperties || isConnector) {
            // Use renderExtensionElementsDiff to get before/after HTML
            const beforeLines: string[] = [];
            const afterLines: string[] = [];
            const maxLen = Math.max(oldChildren.length, newChildren.length);
            for (let i = 0; i < maxLen; i++) {
                const oldChild = oldChildren[i] ?? null;
                const newChild = newChildren[i] ?? null;
                if (isInputOutput) {
                    renderInputOutputDiff(oldChild, newChild, beforeLines, afterLines);
                } else if (isProperties) {
                    renderPropertiesDiff(oldChild, newChild, beforeLines, afterLines);
                } else if (isConnector) {
                    if (oldChild && !newChild) {
                        beforeLines.push(
                            `<div class="ext-child ext-removed"><span class="ext-indicator">−</span><span class="ext-type">Connector</span> ${escapeHtml(oldChild.connectorId ?? "?")}</div>`,
                        );
                        afterLines.push(
                            `<div class="ext-child ext-removed-placeholder"><span class="hud-val-none">(removed)</span></div>`,
                        );
                        if (oldChild.inputOutput)
                            renderInputOutputDiff(
                                oldChild.inputOutput,
                                null,
                                beforeLines,
                                afterLines,
                            );
                    } else if (!oldChild && newChild) {
                        beforeLines.push(
                            `<div class="ext-child ext-added-placeholder"><span class="hud-val-none">(none)</span></div>`,
                        );
                        afterLines.push(
                            `<div class="ext-child ext-added"><span class="ext-indicator">+</span><span class="ext-type">Connector</span> ${escapeHtml(newChild.connectorId ?? "?")}</div>`,
                        );
                        if (newChild.inputOutput)
                            renderInputOutputDiff(
                                null,
                                newChild.inputOutput,
                                beforeLines,
                                afterLines,
                            );
                    } else if (oldChild && newChild) {
                        if (oldChild.connectorId !== newChild.connectorId) {
                            beforeLines.push(
                                `<div class="ext-child ext-modified"><span class="ext-indicator">~</span><span class="ext-type">Connector</span> ${escapeHtml(oldChild.connectorId ?? "?")}</div>`,
                            );
                            afterLines.push(
                                `<div class="ext-child ext-modified"><span class="ext-indicator">~</span><span class="ext-type">Connector</span> ${escapeHtml(newChild.connectorId ?? "?")}</div>`,
                            );
                        }
                        renderInputOutputDiff(
                            oldChild.inputOutput ?? null,
                            newChild.inputOutput ?? null,
                            beforeLines,
                            afterLines,
                        );
                    }
                }
            }
            const beforeHtml =
                beforeLines.length > 0
                    ? `<div class="ext-diff-list">${beforeLines.join("")}</div>`
                    : `<span class="hud-val-none">(none)</span>`;
            const afterHtml =
                afterLines.length > 0
                    ? `<div class="ext-diff-list">${afterLines.join("")}</div>`
                    : `<span class="hud-val-none">(none)</span>`;
            rows.push(`<tr>
                <td title="${escapeHtml(type)}">${escapeHtml(rowLabel)}</td>
                <td class="hud-val-before">${beforeHtml}</td>
                <td class="hud-val-after">${afterHtml}</td>
            </tr>`);
        } else {
            // Simple types: one-line summary per instance
            const beforeItems: string[] = [];
            const afterItems: string[] = [];
            const maxLen = Math.max(oldChildren.length, newChildren.length);
            for (let i = 0; i < maxLen; i++) {
                const oldChild = oldChildren[i];
                const newChild = newChildren[i];
                if (oldChild && !newChild) {
                    beforeItems.push(
                        `<div class="ext-child ext-removed"><span class="ext-indicator">−</span>${escapeHtml(summarizeExtensionChild(oldChild))}</div>`,
                    );
                    afterItems.push(
                        `<div class="ext-child ext-removed-placeholder"><span class="hud-val-none">(removed)</span></div>`,
                    );
                } else if (!oldChild && newChild) {
                    beforeItems.push(
                        `<div class="ext-child ext-added-placeholder"><span class="hud-val-none">(none)</span></div>`,
                    );
                    afterItems.push(
                        `<div class="ext-child ext-added"><span class="ext-indicator">+</span>${escapeHtml(summarizeExtensionChild(newChild))}</div>`,
                    );
                } else if (oldChild && newChild) {
                    try {
                        const oj = JSON.stringify(oldChild, bpmnSafeReplacer);
                        const nj = JSON.stringify(newChild, bpmnSafeReplacer);
                        if (oj === nj) continue; // skip unchanged
                    } catch {
                        /* show as modified */
                    }
                    beforeItems.push(
                        `<div class="ext-child ext-modified"><span class="ext-indicator">~</span>${escapeHtml(summarizeExtensionChild(oldChild))}</div>`,
                    );
                    afterItems.push(
                        `<div class="ext-child ext-modified"><span class="ext-indicator">~</span>${escapeHtml(summarizeExtensionChild(newChild))}</div>`,
                    );
                }
            }
            if (beforeItems.length === 0 && afterItems.length === 0) continue;
            const beforeHtml = `<div class="ext-diff-list">${beforeItems.join("")}</div>`;
            const afterHtml = `<div class="ext-diff-list">${afterItems.join("")}</div>`;
            rows.push(`<tr>
                <td title="${escapeHtml(type)}">${escapeHtml(rowLabel)}</td>
                <td class="hud-val-before">${beforeHtml}</td>
                <td class="hud-val-after">${afterHtml}</td>
            </tr>`);
        }
    }

    return rows.join("");
}

/**
 * Open the attribute-change HUD for a changed element.
 * attrs from bpmn-js-differ use inverted naming: oldValue = After, newValue = Before.
 * The synthetic "extensionElements[values]" key uses NATURAL naming: oldValue = Before, newValue = After.
 */
function openHud(label: string, attrs: Record<string, { oldValue: any; newValue: any }>): void {
    const hud = document.getElementById("diff-hud");
    if (!hud) return;

    // Separate regular attrs from extension element entries.
    // Skip raw "extensionElements" and the synthetic "extensionElements[values]" from the
    // normal list — extension elements are expanded into individual rows below.
    const hasValuesKey = "extensionElements[values]" in attrs;
    const regularEntries: [string, { oldValue: any; newValue: any }][] = [];

    for (const [key, val] of Object.entries(attrs)) {
        if (key === "extensionElements" || key === "extensionElements[values]") continue;
        regularEntries.push([key, val]);
    }

    const renderRow = ([key, attr]: [string, { oldValue: any; newValue: any }]): string => {
        const friendlyLabel = humanizeAttrKey(key);
        const { before: beforeVal, after: afterVal } = resolveAttrBeforeAfter(attr);
        const before = formatAttrValue(beforeVal);
        const after = formatAttrValue(afterVal);
        return `<tr>
            <td title="${escapeHtml(key)}">${escapeHtml(friendlyLabel)}</td>
            <td class="hud-val-before">${before.html}</td>
            <td class="hud-val-after">${after.html}</td>
        </tr>`;
    };

    // Expand extension elements into individual typed rows
    const extensionRows = hasValuesKey
        ? renderExtensionElementsRows(
              attrs["extensionElements[values]"].oldValue ?? [],
              attrs["extensionElements[values]"].newValue ?? [],
          )
        : "";

    const regularRows = regularEntries.map(renderRow).join("");

    hud.innerHTML = `
        <div class="hud-header">
            <span class="hud-title" title="${escapeHtml(label)}">${escapeHtml(label)}</span>
            <div class="hud-header-actions">
                <button class="hud-close" aria-label="Close" title="Close (Esc)">&times;</button>
            </div>
        </div>
        <div class="hud-table-wrap">
            <table class="hud-table">
                <thead><tr><th>Attribute</th><th>Before</th><th>After</th></tr></thead>
                <tbody>${regularRows}${extensionRows}</tbody>
            </table>
        </div>
    `;

    const closeBtn = hud.querySelector(".hud-close") as HTMLElement | null;
    closeBtn?.addEventListener("click", (e) => {
        e.stopPropagation();
        closeHud();
    });

    hud.classList.add("visible");
}

/**
 * Close and clear the attribute-change HUD.
 */
function closeHud(): void {
    const hud = document.getElementById("diff-hud");
    if (!hud) return;
    hud.classList.remove("visible");
    hud.innerHTML = "";
}
