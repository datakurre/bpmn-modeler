import { layoutDesktopDiagram } from "./desktop-auto-layout";

export interface SelectionAnalysis {
    isInterconnected: boolean;
    nodes: any[];
    internalFlows: any[];
    boundaryFlows: any[];
}

export interface LaidOutGeometry {
    shapes: Map<string, { x: number; y: number; width: number; height: number }>;
    edges: Map<string, Array<{ x: number; y: number }>>;
    labels: Map<string, { x: number; y: number; width: number; height: number }>;
}

/**
 * Returns true if an element is a flow node (task, gateway, event, subprocess)
 * and not a connection, root, lane, or label.
 */
export function isFlowNode(element: any): boolean {
    if (!element || element.waypoints || element.type === "label") {
        return false;
    }
    const bo = element.businessObject;
    if (!bo) {
        return false;
    }
    if (typeof bo.$instanceOf === "function") {
        return bo.$instanceOf("bpmn:FlowNode");
    }
    const type = bo.$type || element.type || "";
    return (
        type.includes("Task") ||
        type.includes("Gateway") ||
        type.includes("Event") ||
        type.includes("SubProcess") ||
        type.includes("CallActivity")
    );
}

/**
 * Converts a BPMN type (e.g. "bpmn:ServiceTask") to its standard XML tag ("bpmn:serviceTask").
 */
export function getBpmnTagName(type: string): string {
    const colonIdx = type.indexOf(":");
    if (colonIdx === -1) {
        return type.charAt(0).toLowerCase() + type.slice(1);
    }
    const prefix = type.slice(0, colonIdx);
    const local = type.slice(colonIdx + 1);
    return `${prefix}:${local.charAt(0).toLowerCase() + local.slice(1)}`;
}

/**
 * Escapes XML special characters for attributes.
 */
export function escapeXml(str: string): string {
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}

/**
 * Analyzes the selected diagram elements to check if they form an interconnected
 * set of 2+ flow nodes. Automatically discovers internal connecting flows and
 * boundary flows.
 */
export function analyzeSelection(selectedElements: any[]): SelectionAnalysis {
    const selectedNodes = (selectedElements || []).filter(isFlowNode);

    if (selectedNodes.length < 2) {
        return {
            isInterconnected: false,
            nodes: selectedNodes,
            internalFlows: [],
            boundaryFlows: [],
        };
    }

    const nodeSet = new Set<string>(selectedNodes.map((n) => n.id));
    const internalFlowsMap = new Map<string, any>();
    const boundaryFlowsMap = new Map<string, any>();

    for (const node of selectedNodes) {
        const outgoing = node.outgoing || [];
        for (const flow of outgoing) {
            const targetId = flow.target?.id;
            if (targetId && nodeSet.has(targetId)) {
                internalFlowsMap.set(flow.id, flow);
            } else if (targetId && !nodeSet.has(targetId)) {
                boundaryFlowsMap.set(flow.id, flow);
            }
        }

        const incoming = node.incoming || [];
        for (const flow of incoming) {
            const sourceId = flow.source?.id;
            if (sourceId && !nodeSet.has(sourceId)) {
                boundaryFlowsMap.set(flow.id, flow);
            }
        }
    }

    // Build undirected graph to check connectivity
    const adj = new Map<string, Set<string>>();
    for (const node of selectedNodes) {
        adj.set(node.id, new Set());
    }
    for (const flow of internalFlowsMap.values()) {
        const s = flow.source?.id;
        const t = flow.target?.id;
        if (s && t && adj.has(s) && adj.has(t)) {
            adj.get(s)!.add(t);
            adj.get(t)!.add(s);
        }
    }

    // BFS to verify all selected nodes belong to a single connected component
    const visited = new Set<string>();
    const queue: string[] = [selectedNodes[0].id];
    visited.add(selectedNodes[0].id);

    while (queue.length > 0) {
        const curr = queue.shift()!;
        for (const neighbor of adj.get(curr) || []) {
            if (!visited.has(neighbor)) {
                visited.add(neighbor);
                queue.push(neighbor);
            }
        }
    }

    const isInterconnected = visited.size === selectedNodes.length;

    return {
        isInterconnected,
        nodes: selectedNodes,
        internalFlows: Array.from(internalFlowsMap.values()),
        boundaryFlows: Array.from(boundaryFlowsMap.values()),
    };
}

/**
 * Builds a minimal BPMN 2.0 XML definitions document for the selected subgraph.
 */
export function buildSubgraphXml(analysis: SelectionAnalysis): string {
    const nodeXmls: string[] = [];
    for (const node of analysis.nodes) {
        const bo = node.businessObject || {};
        const tagName = getBpmnTagName(bo.$type || node.type || "bpmn:Task");
        const nameAttr = bo.name ? ` name="${escapeXml(bo.name)}"` : "";
        nodeXmls.push(`    <${tagName} id="${escapeXml(node.id)}"${nameAttr} />`);
    }

    const flowXmls: string[] = [];
    for (const flow of analysis.internalFlows) {
        const bo = flow.businessObject || {};
        const sourceId = flow.source?.id || bo.sourceRef?.id;
        const targetId = flow.target?.id || bo.targetRef?.id;
        const nameAttr = bo.name ? ` name="${escapeXml(bo.name)}"` : "";
        flowXmls.push(
            `    <bpmn:sequenceFlow id="${escapeXml(flow.id)}" sourceRef="${escapeXml(sourceId)}" targetRef="${escapeXml(targetId)}"${nameAttr} />`,
        );
    }

    return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Definitions_selective" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_selective" isExecutable="false">
${nodeXmls.join("\n")}
${flowXmls.join("\n")}
  </bpmn:process>
</bpmn:definitions>`;
}

/**
 * Parses BPMNDI shape bounds and edge waypoints from the laid out XML.
 */
export function parseLaidOutGeometry(xml: string): LaidOutGeometry {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, "text/xml");

    const shapes = new Map<string, { x: number; y: number; width: number; height: number }>();
    const edges = new Map<string, Array<{ x: number; y: number }>>();
    const labels = new Map<string, { x: number; y: number; width: number; height: number }>();

    const allElements = doc.getElementsByTagName("*");
    for (let i = 0; i < allElements.length; i++) {
        const el = allElements[i];
        if (el.localName === "BPMNShape") {
            const id = el.getAttribute("bpmnElement");
            if (!id) continue;
            let boundsEl: Element | null = null;
            let labelBoundsEl: Element | null = null;
            for (let j = 0; j < el.children.length; j++) {
                if (el.children[j].localName === "Bounds") {
                    boundsEl = el.children[j];
                } else if (el.children[j].localName === "BPMNLabel") {
                    const labelChildren = el.children[j].children;
                    for (let k = 0; k < labelChildren.length; k++) {
                        if (labelChildren[k].localName === "Bounds") {
                            labelBoundsEl = labelChildren[k];
                            break;
                        }
                    }
                }
            }
            if (boundsEl) {
                const x = parseFloat(boundsEl.getAttribute("x") || "0");
                const y = parseFloat(boundsEl.getAttribute("y") || "0");
                const width = parseFloat(boundsEl.getAttribute("width") || "0");
                const height = parseFloat(boundsEl.getAttribute("height") || "0");
                shapes.set(id, { x, y, width, height });
            }
            if (labelBoundsEl) {
                const x = parseFloat(labelBoundsEl.getAttribute("x") || "0");
                const y = parseFloat(labelBoundsEl.getAttribute("y") || "0");
                const width = parseFloat(labelBoundsEl.getAttribute("width") || "0");
                const height = parseFloat(labelBoundsEl.getAttribute("height") || "0");
                labels.set(`${id}_label`, { x, y, width, height });
            }
        } else if (el.localName === "BPMNEdge") {
            const id = el.getAttribute("bpmnElement");
            if (!id) continue;
            const points: Array<{ x: number; y: number }> = [];
            for (let j = 0; j < el.children.length; j++) {
                if (el.children[j].localName === "waypoint") {
                    const wp = el.children[j];
                    const x = parseFloat(wp.getAttribute("x") || "0");
                    const y = parseFloat(wp.getAttribute("y") || "0");
                    points.push({ x, y });
                }
            }
            if (points.length > 0) {
                edges.set(id, points);
            }
        }
    }

    return { shapes, edges, labels };
}

/**
 * Computes offset delta (dx, dy) to center the new layout on the original selection bounds.
 */
export function computeCenterOffset(
    nodes: any[],
    geometry: LaidOutGeometry,
): { dx: number; dy: number } {
    let origMinX = Infinity;
    let origMinY = Infinity;
    let origMaxX = -Infinity;
    let origMaxY = -Infinity;

    for (const node of nodes) {
        origMinX = Math.min(origMinX, node.x);
        origMinY = Math.min(origMinY, node.y);
        origMaxX = Math.max(origMaxX, node.x + (node.width || 0));
        origMaxY = Math.max(origMaxY, node.y + (node.height || 0));
    }

    let laidMinX = Infinity;
    let laidMinY = Infinity;
    let laidMaxX = -Infinity;
    let laidMaxY = -Infinity;

    for (const node of nodes) {
        const g = geometry.shapes.get(node.id);
        if (g) {
            laidMinX = Math.min(laidMinX, g.x);
            laidMinY = Math.min(laidMinY, g.y);
            laidMaxX = Math.max(laidMaxX, g.x + g.width);
            laidMaxY = Math.max(laidMaxY, g.y + g.height);
        }
    }

    if (!isFinite(origMinX) || !isFinite(origMinY) || !isFinite(laidMinX) || !isFinite(laidMinY)) {
        return { dx: 0, dy: 0 };
    }

    const origCenterX = (origMinX + origMaxX) / 2;
    const origCenterY = (origMinY + origMaxY) / 2;
    const laidCenterX = (laidMinX + laidMaxX) / 2;
    const laidCenterY = (laidMinY + laidMaxY) / 2;

    return {
        dx: Math.round(origCenterX - laidCenterX),
        dy: Math.round(origCenterY - laidCenterY),
    };
}

let commandHandlerRegistered = false;

function ensureCommandHandler(commandStack: any, modeling: any) {
    if (commandHandlerRegistered) return;
    try {
        commandStack.register("selectiveLayout.execute", {
            preExecute(context: any) {
                for (const move of context.moves) {
                    modeling.moveElements([move.shape], move.delta);
                }
                for (const wp of context.waypoints) {
                    modeling.updateWaypoints(wp.flow, wp.points);
                }
                for (const flow of context.boundaryFlows) {
                    modeling.layoutConnection(flow);
                }
            },
            execute() {},
            revert() {},
        });
        commandHandlerRegistered = true;
    } catch {
        // Ignored if already registered
    }
}

/**
 * Applies the calculated selective layout to the modeler via commandStack and modeling.
 */
export function applySelectiveLayout(
    modeler: any,
    analysis: SelectionAnalysis,
    geometry: LaidOutGeometry,
): void {
    const modeling = modeler.get("modeling");
    const commandStack = modeler.get("commandStack");
    const { dx, dy } = computeCenterOffset(analysis.nodes, geometry);

    const moves: Array<{ shape: any; delta: { x: number; y: number } }> = [];
    for (const node of analysis.nodes) {
        const g = geometry.shapes.get(node.id);
        if (g) {
            const targetX = g.x + dx;
            const targetY = g.y + dy;
            moves.push({
                shape: node,
                delta: {
                    x: targetX - node.x,
                    y: targetY - node.y,
                },
            });
        }
    }

    const waypoints: Array<{ flow: any; points: Array<{ x: number; y: number }> }> = [];
    for (const flow of analysis.internalFlows) {
        const pts = geometry.edges.get(flow.id);
        if (pts) {
            waypoints.push({
                flow,
                points: pts.map((p) => ({ x: p.x + dx, y: p.y + dy })),
            });
        }
    }

    const context = {
        moves,
        waypoints,
        boundaryFlows: analysis.boundaryFlows,
    };

    if (commandStack && typeof commandStack.register === "function") {
        ensureCommandHandler(commandStack, modeling);
        commandStack.execute("selectiveLayout.execute", context);
    } else {
        // Fallback for direct execution
        for (const move of moves) {
            modeling.moveElements([move.shape], move.delta);
        }
        for (const wp of waypoints) {
            modeling.updateWaypoints(wp.flow, wp.points);
        }
        for (const flow of analysis.boundaryFlows) {
            modeling.layoutConnection(flow);
        }
    }
}

/**
 * Applies a whole-diagram layout (from `layoutDesktopDiagram`) to the modeler
 * as a single undoable command, instead of reimporting the diagram via
 * `importXML` — which would clear the command stack and destroy all undo
 * history, not just the layout step.
 */
export function applyFullDiagramLayout(modeler: any, geometry: LaidOutGeometry): void {
    const modeling = modeler.get("modeling");
    const commandStack = modeler.get("commandStack");
    const elementRegistry = modeler.get("elementRegistry");

    const moves: Array<{ shape: any; delta: { x: number; y: number } }> = [];
    const collectMove = (id: string, target: { x: number; y: number }) => {
        const element = elementRegistry.get(id);
        if (!element) return;
        moves.push({
            shape: element,
            delta: { x: target.x - element.x, y: target.y - element.y },
        });
    };
    for (const [id, bounds] of geometry.shapes) {
        collectMove(id, bounds);
    }
    for (const [id, bounds] of geometry.labels) {
        collectMove(id, bounds);
    }

    const waypoints: Array<{ flow: any; points: Array<{ x: number; y: number }> }> = [];
    for (const [id, points] of geometry.edges) {
        const element = elementRegistry.get(id);
        if (element) {
            waypoints.push({ flow: element, points });
        }
    }

    const context = { moves, waypoints, boundaryFlows: [] };

    if (commandStack && typeof commandStack.register === "function") {
        ensureCommandHandler(commandStack, modeling);
        commandStack.execute("selectiveLayout.execute", context);
    } else {
        for (const move of moves) {
            modeling.moveElements([move.shape], move.delta);
        }
        for (const wp of waypoints) {
            modeling.updateWaypoints(wp.flow, wp.points);
        }
    }
}

/**
 * High-level function to layout selected elements in the modeler.
 */
export async function layoutSelectedElements(
    modeler: any,
    analysis: SelectionAnalysis,
): Promise<void> {
    const subgraphXml = buildSubgraphXml(analysis);
    const laidOutXml = await layoutDesktopDiagram(subgraphXml);
    const geometry = parseLaidOutGeometry(laidOutXml);
    applySelectiveLayout(modeler, analysis, geometry);
}
