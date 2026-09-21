/**
 * Linked Resources Overlays — bpmn-js module.
 *
 * Shows small badge overlays on diagram elements that reference external
 * resources (other BPMN processes, DMN decisions, or Camunda Forms).
 *
 * Clicking a badge sends an `openLinkedFile` message back to the VS Code
 * extension, which opens the target file in the editor.
 */

import type { ResolvedLink } from "../../src/linkedResources";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VsCodeApi {
    postMessage(msg: unknown): void;
}

// Re-export the type so tests can import from here
export type { ResolvedLink };

// ---------------------------------------------------------------------------
// Caller grouping types and helpers
// ---------------------------------------------------------------------------

/** A single candidate in a multi-caller chooser. */
export interface CallerCandidate {
    readonly relativePath: string;
    readonly label: string;
}

/** All callers that reference the same element (collapsed into one badge). */
export interface CallerGroup {
    readonly elementId: string;
    readonly candidates: CallerCandidate[];
}

/**
 * Partitions links into caller groups (keyed by elementId) and all other
 * (forward) links. Multiple caller links that share the same elementId are
 * merged into one group so they can be presented as a single overlay badge.
 */
export function groupCallerLinks(links: ResolvedLink[]): {
    callerGroups: CallerGroup[];
    nonCallerLinks: ResolvedLink[];
} {
    const callerMap = new Map<string, CallerCandidate[]>();
    const nonCallerLinks: ResolvedLink[] = [];

    for (const link of links) {
        if (link.refType === "caller") {
            const candidate: CallerCandidate = {
                relativePath: link.targetPath,
                label: link.targetPath.split("/").pop() || link.targetPath,
            };
            const existing = callerMap.get(link.elementId);
            if (existing) {
                const isDuplicate = existing.some(
                    (c) => c.relativePath === candidate.relativePath && c.label === candidate.label,
                );
                if (!isDuplicate) {
                    existing.push(candidate);
                }
            } else {
                callerMap.set(link.elementId, [candidate]);
            }
        } else {
            nonCallerLinks.push(link);
        }
    }

    const callerGroups: CallerGroup[] = [];
    for (const [elementId, candidates] of callerMap) {
        callerGroups.push({ elementId, candidates });
    }
    return { callerGroups, nonCallerLinks };
}

// ---------------------------------------------------------------------------
// Badge HTML helpers
// ---------------------------------------------------------------------------

const OVERLAY_TYPE = "linked-resource-badge";

export function createBadgeHtml(link: ResolvedLink): HTMLElement {
    const el = document.createElement("div");
    el.className = `linked-resource-badge linked-resource-badge--${link.refType}`;
    if (link.refType === "caller") {
        el.title = `Called from: ${link.targetPath}\n(process: ${link.refId})`;
        el.textContent = "↙";
    } else if (link.refType === "message") {
        el.title = `Open receiving process: ${link.refId}\n→ ${link.targetPath}`;
        el.textContent = "↗";
    } else {
        el.title = `Open linked ${link.refType}: ${link.refId}\n→ ${link.targetPath}`;
        el.textContent = "↗";
    }
    el.dataset.targetPath = link.targetPath;
    el.dataset.refId = link.refId;
    el.dataset.refType = link.refType;
    return el;
}

/**
 * Create a badge element for a group of callers.
 * Shows a count indicator when multiple callers exist.
 */
export function createCallerGroupBadgeHtml(group: CallerGroup): HTMLElement {
    const el = document.createElement("div");
    el.className = "linked-resource-badge linked-resource-badge--caller";
    if (group.candidates.length === 1) {
        el.title = `Called from: ${group.candidates[0].relativePath}`;
    } else {
        const paths = group.candidates.map((c) => c.relativePath).join("\n");
        el.title = `Called from ${group.candidates.length} processes:\n${paths}`;
    }
    el.textContent = "↙";
    return el;
}

// ---------------------------------------------------------------------------
// Module class (bpmn-js injectable)
// ---------------------------------------------------------------------------

export class LinkedResourceOverlays {
    public static $inject: string[];

    private overlays: any;
    private eventBus: any;
    private overlayIds: string[] = [];
    private vscode: VsCodeApi | undefined;
    private storedLinks: ResolvedLink[] = [];

    constructor(overlays: any, eventBus: any) {
        this.overlays = overlays;
        this.eventBus = eventBus;

        // Re-add overlays after diagram import completes
        this.eventBus.on("import.done", () => {
            if (this.storedLinks.length > 0) {
                this.addOverlays(this.storedLinks);
            }
        });
    }

    /**
     * Store a reference to the VS Code API so badges can post messages.
     */
    setVsCodeApi(api: VsCodeApi) {
        this.vscode = api;
    }

    /**
     * Remove all existing linked-resource overlays.
     */
    clearOverlays() {
        for (const id of this.overlayIds) {
            try {
                this.overlays.remove(id);
            } catch {
                /* already removed */
            }
        }
        this.overlayIds = [];
    }

    /**
     * Show badge overlays for the supplied resolved links.
     */
    showLinks(links: ResolvedLink[]) {
        this.storedLinks = links;
        this.addOverlays(links);
    }

    /**
     * Internal method to add overlays to the diagram.
     * Caller links sharing the same elementId are collapsed into one badge;
     * clicking it sends `openLinkedFileChooser` when there are multiple callers
     * or `openLinkedFile` when there is only one.
     */
    private addOverlays(links: ResolvedLink[]) {
        this.clearOverlays();

        const { callerGroups, nonCallerLinks } = groupCallerLinks(links);

        // Forward links (process / decision / form) — unchanged behaviour
        for (const link of nonCallerLinks) {
            try {
                const html = createBadgeHtml(link);
                html.addEventListener("click", (e) => {
                    e.stopPropagation();
                    if (this.vscode) {
                        this.vscode.postMessage({
                            type: "openLinkedFile",
                            relativePath: link.targetPath,
                        });
                    }
                });
                const id = this.overlays.add(link.elementId, OVERLAY_TYPE, {
                    position:
                        link.refType === "message" ? { top: -20, right: 5 } : { top: 5, right: 25 },
                    html,
                });
                this.overlayIds.push(id);
            } catch {
                /* element might not exist on canvas */
            }
        }

        // Caller (back-link) groups — one badge per elementId
        for (const group of callerGroups) {
            try {
                const html = createCallerGroupBadgeHtml(group);
                html.addEventListener("click", (e) => {
                    e.stopPropagation();
                    if (this.vscode) {
                        if (group.candidates.length === 1) {
                            this.vscode.postMessage({
                                type: "openLinkedFile",
                                relativePath: group.candidates[0].relativePath,
                            });
                        } else {
                            this.vscode.postMessage({
                                type: "openLinkedFileChooser",
                                candidates: group.candidates,
                            });
                        }
                    }
                });
                const id = this.overlays.add(group.elementId, OVERLAY_TYPE, {
                    position: { bottom: 0, left: -10 },
                    html,
                });
                this.overlayIds.push(id);
            } catch {
                /* element might not exist on canvas */
            }
        }
    }
}

LinkedResourceOverlays.$inject = ["overlays", "eventBus"];

// ---------------------------------------------------------------------------
// bpmn-js module descriptor
// ---------------------------------------------------------------------------

export const LinkedResourceOverlaysModule = {
    __init__: ["linkedResourceOverlays"],
    linkedResourceOverlays: ["type", LinkedResourceOverlays],
};
