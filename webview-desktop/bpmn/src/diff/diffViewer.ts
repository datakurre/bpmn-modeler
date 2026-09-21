import NavigatedViewer from "bpmn-js/lib/NavigatedViewer";
import MinimapModule from "diagram-js-minimap";
import "diagram-js-minimap/assets/diagram-js-minimap.css";
import { diff } from "bpmn-js-differ";
import { BpmnModdle } from "bpmn-moddle";
import camundaModdle from "camunda-bpmn-moddle/resources/camunda.json";
import { renderChangesSidebar } from "./diffOverlays";
import { applyOldAttrsToBO, augmentExtensionElementChanges } from "./diffUtils";
export { resolveAttrBeforeAfter, applyOldAttrsToBO } from "./diffUtils";

const moddle = new (BpmnModdle as any)({ camunda: camundaModdle });

let viewer: any = null;
let savedViewbox: any = null;

/** Stored old definitions for rendering removed element ghosts */
let storedOldDefinitions: any = null;

/** Element registry of the current viewer — used by mark() to find labels */
let elementRegistry: any = null;

/** Tracks all element IDs (including label IDs) that received each marker class */
const markedIdsByClass = new Map<string, string[]>();

/** Saved new attribute values for changed elements (restored when toggle ON) */
const savedNewAttrs = new Map<string, Record<string, any>>();

/** Saved new layout (position/waypoints) for layout-changed elements */
const savedNewLayout = new Map<string, any>();

export interface DiffResult {
    _added: Record<string, any>;
    _removed: Record<string, any>;
    _changed: Record<
        string,
        { model: any; attrs: Record<string, { oldValue: any; newValue: any }> }
    >;
    _layoutChanged: Record<string, any>;
}

export interface ChangesetOption {
    ref: string;
    label: string;
    description: string;
}

/**
 * Parse BPMN XML into moddle definitions.
 */
async function parse(xml: string) {
    const { rootElement } = await moddle.fromXML(xml);
    return rootElement;
}

/**
 * Render the diff between two BPMN XMLs.
 *
 * Note: buildElementIndex, bpmnSafeReplacer, and augmentExtensionElementChanges
 * live in ./diffUtils so they can be unit-tested in a Node environment.
 */
export async function renderDiff(
    oldXml: string,
    newXml: string,
    _title: string,
    changesets: ChangesetOption[],
    currentRef: string,
    currentCompareRef: string = "CURRENT",
    initialViewbox?: any,
): Promise<void> {
    const container = document.getElementById("diff-canvas")!;

    // Save viewport before destroying so changeset switches preserve pan/zoom
    const isUpdate = viewer !== null;
    if (viewer) {
        try {
            savedViewbox = viewer.get("canvas").viewbox();
        } catch {
            savedViewbox = null;
        }
        viewer.destroy();
        viewer = null;
    }

    // Parse both diagrams
    const [oldDefinitions, newDefinitions] = await Promise.all([parse(oldXml), parse(newXml)]);
    storedOldDefinitions = oldDefinitions;

    // Compute diff
    const changes: DiffResult = diff(oldDefinitions, newDefinitions);

    // Augment with extensionElements changes that bpmn-js-differ does not track
    augmentExtensionElementChanges(changes, oldDefinitions, newDefinitions);

    // Create viewer and import the new diagram
    viewer = new NavigatedViewer({ container, additionalModules: [MinimapModule] });
    await viewer.importXML(newXml);

    // Apply color markers
    const canvas = viewer.get("canvas");
    const overlays = viewer.get("overlays");
    elementRegistry = viewer.get("elementRegistry");
    markedIdsByClass.clear();
    savedNewAttrs.clear();
    savedNewLayout.clear();

    /** Mark an element + its label; record both IDs in markedIdsByClass for later toggle use */
    function mark(id: string, markerClass: string): void {
        const tracked = markedIdsByClass.get(markerClass) ?? [];
        try {
            canvas.addMarker(id, markerClass);
            tracked.push(id);
            const el = elementRegistry.get(id);
            if (el?.label) {
                try {
                    canvas.addMarker(el.label.id, markerClass);
                    tracked.push(el.label.id);
                } catch {
                    // label might not have gfx
                }
            }
        } catch {
            // element might not be rendered (e.g., definitions-level)
        }
        markedIdsByClass.set(markerClass, tracked);
    }

    // Mark added elements
    for (const id of Object.keys(changes._added)) {
        mark(id, "diff-added");
    }

    // Mark changed elements
    for (const id of Object.keys(changes._changed)) {
        mark(id, "diff-changed");
    }

    // Mark layout-changed elements
    for (const id of Object.keys(changes._layoutChanged)) {
        mark(id, "diff-layout-changed");
    }

    // Close minimap by default (user can open it manually)
    try {
        viewer.get("minimap").close();
    } catch {
        // minimap module might not be present in some configurations
    }

    // Restore viewport on changeset switch; on first load use modeler viewbox or fit-viewport
    if (isUpdate && savedViewbox) {
        canvas.viewbox(savedViewbox);
    } else if (initialViewbox) {
        canvas.viewbox(initialViewbox);
    } else {
        canvas.zoom("fit-viewport");
    }

    // Render sidebar (legend + change list) and bottom bar (changeset selector)
    renderChangesSidebar(changes, canvas, overlays, changesets, currentRef, currentCompareRef);
}

/**
 * Resolve the semantic Before/After values from a bpmn-js-differ attr entry.
/**
 * Get the DI (diagram interchange) plane elements from the stored old definitions.
 * Returns BPMNShape/BPMNEdge entries with bounds/waypoints for removed elements.
 */
export function getOldDiPlane(): any[] {
    if (!storedOldDefinitions) return [];
    const diagrams = storedOldDefinitions.diagrams;
    if (!diagrams || diagrams.length === 0) return [];
    return diagrams[0].plane?.planeElement ?? [];
}

/**
 * Get the current viewer's canvas (for adding/removing ghost shapes).
 */
export function getViewerCanvas(): any {
    return viewer?.get("canvas") ?? null;
}

/**
 * Return all element IDs (including label IDs) that were marked with the given class.
 * Used by toggle logic to hide/show the exact same set that was originally marked.
 */
export function getMarkedIds(markerClass: string): string[] {
    return markedIdsByClass.get(markerClass) ?? [];
}

/**
 * Get the SVG viewport group for inserting ghost elements.
 */
export function getViewerViewport(): SVGGElement | null {
    if (!viewer) return null;
    const canvas = viewer.get("canvas");
    return canvas._viewport ?? null;
}

/**
 * Briefly highlight an element on the canvas with a pulsing animation.
 * The highlight auto-removes after the animation completes.
 */
export function highlightElement(id: string): void {
    if (!viewer) return;
    const canvas = viewer.get("canvas");
    try {
        canvas.addMarker(id, "diff-highlight");
        // Remove after animation finishes (3 × 0.5s = 1.5s)
        setTimeout(() => {
            try {
                canvas.removeMarker(id, "diff-highlight");
            } catch {
                // element may have been destroyed
            }
        }, 1500);
    } catch {
        // element might not be rendered
    }
}

/**
 * Get old DI entry for a specific element by BPMN element ID.
 */
function getOldDiForElement(id: string): any | null {
    const plane = getOldDiPlane();
    return plane.find((di: any) => di.bpmnElement?.id === id) ?? null;
}

/**
 * Pan the canvas to the position where a removed element used to be.
 * Uses the old DI bounds (shapes) or waypoint midpoint (edges).
 * Preserves the current zoom level.
 */
export function scrollToOldPosition(id: string): void {
    if (!viewer) return;
    const di = getOldDiForElement(id);
    if (!di) return;
    const canvas = viewer.get("canvas");
    let cx: number;
    let cy: number;
    if (di.bounds) {
        cx = di.bounds.x + di.bounds.width / 2;
        cy = di.bounds.y + di.bounds.height / 2;
    } else if (di.waypoint?.length >= 2) {
        const mid = Math.floor(di.waypoint.length / 2);
        cx = (di.waypoint[mid - 1].x + di.waypoint[mid].x) / 2;
        cy = (di.waypoint[mid - 1].y + di.waypoint[mid].y) / 2;
    } else {
        return;
    }
    try {
        const vb = canvas.viewbox();
        // Center the viewport on (cx, cy) keeping current scale
        canvas.viewbox({
            x: cx - vb.width / vb.scale / 2,
            y: cy - vb.height / vb.scale / 2,
            width: vb.width / vb.scale,
            height: vb.height / vb.scale,
        });
    } catch {
        /* skip */
    }
}

/**
 * Hide an element on the canvas (set display none on its gfx).
 */
export function hideElement(id: string): void {
    if (!viewer || !elementRegistry) return;
    try {
        const gfx = elementRegistry.getGraphics(id);
        if (gfx) gfx.style.display = "none";
        // Also hide label
        const el = elementRegistry.get(id);
        if (el?.label) {
            const labelGfx = elementRegistry.getGraphics(el.label.id);
            if (labelGfx) labelGfx.style.display = "none";
        }
    } catch {
        /* skip */
    }
}

/**
 * Show a previously hidden element on the canvas.
 */
export function showElement(id: string): void {
    if (!viewer || !elementRegistry) return;
    try {
        const gfx = elementRegistry.getGraphics(id);
        if (gfx) gfx.style.display = "";
        // Also show label
        const el = elementRegistry.get(id);
        if (el?.label) {
            const labelGfx = elementRegistry.getGraphics(el.label.id);
            if (labelGfx) labelGfx.style.display = "";
        }
    } catch {
        /* skip */
    }
}

/**
 * Restore old attribute values for a changed element (e.g., old label).
 * Saves current new values for later restoration.
 */
export function showOldAttrs(
    id: string,
    attrs: Record<string, { oldValue: any; newValue: any }>,
): void {
    if (!viewer || !elementRegistry) return;
    const el = elementRegistry.get(id);
    if (!el?.businessObject) return;

    const bo = el.businessObject;
    const eventBus = viewer.get("eventBus");

    // Save current (new) values if not already saved, for later restoration by showNewAttrs.
    // The BO reflects the new/Compare-version diagram (viewer imported newXml).
    if (!savedNewAttrs.has(id)) {
        const saved: Record<string, any> = {};
        for (const key of Object.keys(attrs)) {
            saved[key] = (bo as any)[key];
        }
        savedNewAttrs.set(id, saved);
    }

    // Apply the actual old (previous) values — see applyOldAttrsToBO in diffUtils.ts for details.
    applyOldAttrsToBO(bo as Record<string, any>, attrs);

    // Re-render via eventBus (canonical diagram-js approach, works for both embedded and external labels)
    eventBus.fire("element.changed", { element: el });
    if ("name" in attrs && el.label) {
        eventBus.fire("element.changed", { element: el.label });
    }
}

/**
 * Restore new attribute values for a changed element.
 */
export function showNewAttrs(id: string): void {
    if (!viewer || !elementRegistry) return;
    const saved = savedNewAttrs.get(id);
    if (!saved) return;

    const el = elementRegistry.get(id);
    if (!el?.businessObject) return;

    const bo = el.businessObject;

    // Restore new values directly
    for (const [key, value] of Object.entries(saved)) {
        (bo as any)[key] = value;
    }

    // Re-render via eventBus
    const eventBus = viewer.get("eventBus");
    eventBus.fire("element.changed", { element: el });
    if ("name" in saved && el.label) {
        eventBus.fire("element.changed", { element: el.label });
    }
}

/**
 * Move an element to its old layout position (from old DI).
 * Saves new position/waypoints for later restoration.
 */
export function showOldLayout(id: string): void {
    if (!viewer || !elementRegistry) return;
    const el = elementRegistry.get(id);
    if (!el) return;

    const di = getOldDiForElement(id);
    if (!di) return;

    const canvas = viewer.get("canvas");

    if (el.waypoints && di.waypoint?.length >= 2) {
        // Connection: save new waypoints, apply old ones
        if (!savedNewLayout.has(id)) {
            savedNewLayout.set(id, { waypoints: JSON.parse(JSON.stringify(el.waypoints)) });
        }
        el.waypoints = di.waypoint.map((wp: any) => ({ x: wp.x, y: wp.y }));
        const gfx = elementRegistry.getGraphics(id);
        if (gfx) {
            const graphicsFactory = viewer.get("graphicsFactory");
            graphicsFactory.update("connection", el, gfx);
        }
    } else if (di.bounds) {
        // Shape: save new position, apply old one
        if (!savedNewLayout.has(id)) {
            savedNewLayout.set(id, { x: el.x, y: el.y, width: el.width, height: el.height });
        }
        const { x, y, width, height } = di.bounds;
        el.x = x;
        el.y = y;
        el.width = width;
        el.height = height;
        const gfx = elementRegistry.getGraphics(id);
        if (gfx) {
            canvas._graphicsFactory.update("shape", el, gfx);
        }
    }
}

/**
 * Restore an element to its new layout position.
 */
export function showNewLayout(id: string): void {
    if (!viewer || !elementRegistry) return;
    const saved = savedNewLayout.get(id);
    if (!saved) return;

    const el = elementRegistry.get(id);
    if (!el) return;

    const canvas = viewer.get("canvas");

    if (el.waypoints && saved.waypoints) {
        el.waypoints = saved.waypoints;
        const gfx = elementRegistry.getGraphics(id);
        if (gfx) {
            const graphicsFactory = viewer.get("graphicsFactory");
            graphicsFactory.update("connection", el, gfx);
        }
    } else if ("x" in saved) {
        el.x = saved.x;
        el.y = saved.y;
        el.width = saved.width;
        el.height = saved.height;
        const gfx = elementRegistry.getGraphics(id);
        if (gfx) {
            canvas._graphicsFactory.update("shape", el, gfx);
        }
    }
}

/**
 * Apply inline stroke styles to a connection's path element.
 * Pass null to clear styles (restores CSS-only styling).
 */
export function applyConnectionStyle(
    id: string,
    style: { stroke: string; strokeWidth: string; strokeDasharray?: string } | null,
): void {
    if (!viewer || !elementRegistry) return;
    const el = elementRegistry.get(id);
    if (!el?.waypoints) return; // not a connection

    try {
        const gfx = elementRegistry.getGraphics(id);
        if (!gfx) return;
        const path = gfx.querySelector(".djs-visual > path") as SVGElement | null;
        if (!path) return;

        if (style) {
            path.style.stroke = style.stroke;
            path.style.strokeWidth = style.strokeWidth;
            if (style.strokeDasharray) {
                path.style.strokeDasharray = style.strokeDasharray;
            } else {
                path.style.strokeDasharray = "";
            }
        } else {
            path.style.stroke = "";
            path.style.strokeWidth = "";
            path.style.strokeDasharray = "";
        }
    } catch {
        /* skip */
    }
}
