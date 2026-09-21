/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
    isFlowNode,
    getBpmnTagName,
    escapeXml,
    analyzeSelection,
    buildSubgraphXml,
    parseLaidOutGeometry,
    computeCenterOffset,
    applySelectiveLayout,
    applyFullDiagramLayout,
    layoutSelectedElements,
} from "./selection-layout";

vi.mock("./desktop-auto-layout", () => ({
    layoutDesktopDiagram: vi.fn(async (_xml: string) => {
        return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="Definitions_1">
  <bpmn:process id="Process_1">
    <bpmn:task id="Task_1" />
    <bpmn:task id="Task_2" />
    <bpmn:sequenceFlow id="Flow_1" sourceRef="Task_1" targetRef="Task_2" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_1">
      <bpmndi:BPMNShape id="Task_1_di" bpmnElement="Task_1">
        <dc:Bounds x="100" y="100" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_2_di" bpmnElement="Task_2">
        <dc:Bounds x="300" y="100" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Flow_1_di" bpmnElement="Flow_1">
        <di:waypoint x="200" y="140" />
        <di:waypoint x="300" y="140" />
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;
    }),
}));

describe("selection-layout", () => {
    describe("isFlowNode", () => {
        it("returns true for standard tasks, gateways, and events", () => {
            expect(isFlowNode({ businessObject: { $type: "bpmn:Task" } })).toBe(true);
            expect(isFlowNode({ businessObject: { $type: "bpmn:ServiceTask" } })).toBe(true);
            expect(isFlowNode({ businessObject: { $type: "bpmn:ExclusiveGateway" } })).toBe(true);
            expect(isFlowNode({ businessObject: { $type: "bpmn:StartEvent" } })).toBe(true);
            expect(isFlowNode({ businessObject: { $type: "bpmn:EndEvent" } })).toBe(true);
            expect(isFlowNode({ businessObject: { $type: "bpmn:SubProcess" } })).toBe(true);
            expect(isFlowNode({ businessObject: { $type: "bpmn:CallActivity" } })).toBe(true);
        });

        it("uses $instanceOf when available on businessObject", () => {
            const flowNode = {
                businessObject: {
                    $instanceOf: (type: string) => type === "bpmn:FlowNode",
                },
            };
            const notFlowNode = {
                businessObject: {
                    $instanceOf: (type: string) => type !== "bpmn:FlowNode",
                },
            };
            expect(isFlowNode(flowNode)).toBe(true);
            expect(isFlowNode(notFlowNode)).toBe(false);
        });

        it("returns false for connections, labels, root elements, and invalid inputs", () => {
            expect(isFlowNode(null)).toBe(false);
            expect(isFlowNode(undefined)).toBe(false);
            expect(isFlowNode({ waypoints: [{ x: 0, y: 0 }] })).toBe(false);
            expect(isFlowNode({ type: "label", businessObject: { $type: "bpmn:Task" } })).toBe(
                false,
            );
            expect(isFlowNode({ businessObject: { $type: "bpmn:SequenceFlow" } })).toBe(false);
            expect(isFlowNode({ businessObject: { $type: "bpmn:Participant" } })).toBe(false);
            expect(isFlowNode({ businessObject: { $type: "bpmn:Collaboration" } })).toBe(false);
            expect(isFlowNode({ businessObject: { $type: "bpmn:Lane" } })).toBe(false);
            expect(isFlowNode({})).toBe(false);
        });
    });

    describe("getBpmnTagName", () => {
        it("converts moddle type names to lowercase XML tags", () => {
            expect(getBpmnTagName("bpmn:ServiceTask")).toBe("bpmn:serviceTask");
            expect(getBpmnTagName("bpmn:ExclusiveGateway")).toBe("bpmn:exclusiveGateway");
            expect(getBpmnTagName("bpmn:IntermediateCatchEvent")).toBe(
                "bpmn:intermediateCatchEvent",
            );
            expect(getBpmnTagName("ServiceTask")).toBe("serviceTask");
        });
    });

    describe("escapeXml", () => {
        it("escapes special characters", () => {
            expect(escapeXml(`"Tom & Jerry" <1 > 0> 'test'`)).toBe(
                `&quot;Tom &amp; Jerry&quot; &lt;1 &gt; 0&gt; &apos;test&apos;`,
            );
        });
    });

    describe("analyzeSelection", () => {
        it("returns isInterconnected=false for empty or single element selection", () => {
            expect(analyzeSelection([]).isInterconnected).toBe(false);
            expect(
                analyzeSelection([{ id: "T1", businessObject: { $type: "bpmn:Task" } }])
                    .isInterconnected,
            ).toBe(false);
        });

        it("returns isInterconnected=true for 2 connected nodes and discovers internal flow", () => {
            const flow1: any = { id: "F1", businessObject: { $type: "bpmn:SequenceFlow" } };
            const node1: any = {
                id: "T1",
                businessObject: { $type: "bpmn:Task" },
                outgoing: [flow1],
                incoming: [],
            };
            const node2: any = {
                id: "T2",
                businessObject: { $type: "bpmn:Task" },
                outgoing: [],
                incoming: [flow1],
            };
            flow1.source = node1;
            flow1.target = node2;

            const analysis = analyzeSelection([node1, node2]);
            expect(analysis.isInterconnected).toBe(true);
            expect(analysis.nodes).toEqual([node1, node2]);
            expect(analysis.internalFlows).toEqual([flow1]);
            expect(analysis.boundaryFlows).toEqual([]);
        });

        it("returns isInterconnected=false for disconnected nodes", () => {
            const node1: any = {
                id: "T1",
                businessObject: { $type: "bpmn:Task" },
                outgoing: [],
                incoming: [],
            };
            const node2: any = {
                id: "T2",
                businessObject: { $type: "bpmn:Task" },
                outgoing: [],
                incoming: [],
            };

            const analysis = analyzeSelection([node1, node2]);
            expect(analysis.isInterconnected).toBe(false);
        });

        it("returns isInterconnected=false for partially connected nodes (2 connected, 1 disjoint)", () => {
            const flow1: any = { id: "F1", businessObject: { $type: "bpmn:SequenceFlow" } };
            const node1: any = {
                id: "T1",
                businessObject: { $type: "bpmn:Task" },
                outgoing: [flow1],
                incoming: [],
            };
            const node2: any = {
                id: "T2",
                businessObject: { $type: "bpmn:Task" },
                outgoing: [],
                incoming: [flow1],
            };
            const node3: any = {
                id: "T3",
                businessObject: { $type: "bpmn:Task" },
                outgoing: [],
                incoming: [],
            };
            flow1.source = node1;
            flow1.target = node2;

            const analysis = analyzeSelection([node1, node2, node3]);
            expect(analysis.isInterconnected).toBe(false);
        });

        it("detects incoming and outgoing boundary flows correctly", () => {
            const internalFlow: any = {
                id: "F_in",
                businessObject: { $type: "bpmn:SequenceFlow" },
            };
            const outsideNodeBefore: any = {
                id: "Outside_1",
                businessObject: { $type: "bpmn:StartEvent" },
            };
            const outsideNodeAfter: any = {
                id: "Outside_2",
                businessObject: { $type: "bpmn:EndEvent" },
            };

            const boundaryFlowIn: any = {
                id: "F_boundary_in",
                businessObject: { $type: "bpmn:SequenceFlow" },
                source: outsideNodeBefore,
            };
            const boundaryFlowOut: any = {
                id: "F_boundary_out",
                businessObject: { $type: "bpmn:SequenceFlow" },
                target: outsideNodeAfter,
            };

            const node1: any = {
                id: "T1",
                businessObject: { $type: "bpmn:Task" },
                incoming: [boundaryFlowIn],
                outgoing: [internalFlow],
            };
            const node2: any = {
                id: "T2",
                businessObject: { $type: "bpmn:Task" },
                incoming: [internalFlow],
                outgoing: [boundaryFlowOut],
            };

            internalFlow.source = node1;
            internalFlow.target = node2;
            boundaryFlowIn.target = node1;
            boundaryFlowOut.source = node2;

            const analysis = analyzeSelection([node1, node2]);
            expect(analysis.isInterconnected).toBe(true);
            expect(analysis.internalFlows).toEqual([internalFlow]);
            expect(analysis.boundaryFlows).toContain(boundaryFlowIn);
            expect(analysis.boundaryFlows).toContain(boundaryFlowOut);
            expect(analysis.boundaryFlows).toHaveLength(2);
        });
    });

    describe("buildSubgraphXml", () => {
        it("generates minimal BPMN definitions with nodes and flows", () => {
            const node1 = {
                id: "T1",
                businessObject: { $type: "bpmn:ServiceTask", name: "Worker <1>" },
            };
            const node2 = {
                id: "GW1",
                businessObject: { $type: "bpmn:ExclusiveGateway", name: "Decision" },
            };
            const flow1 = {
                id: "F1",
                source: node1,
                target: node2,
                businessObject: { $type: "bpmn:SequenceFlow", name: "Go & Check" },
            };

            const xml = buildSubgraphXml({
                isInterconnected: true,
                nodes: [node1, node2],
                internalFlows: [flow1],
                boundaryFlows: [],
            });

            expect(xml).toContain(`bpmn:definitions`);
            expect(xml).toContain(`<bpmn:serviceTask id="T1" name="Worker &lt;1&gt;" />`);
            expect(xml).toContain(`<bpmn:exclusiveGateway id="GW1" name="Decision" />`);
            expect(xml).toContain(
                `<bpmn:sequenceFlow id="F1" sourceRef="T1" targetRef="GW1" name="Go &amp; Check" />`,
            );
        });
    });

    describe("parseLaidOutGeometry", () => {
        it("extracts shape bounds and edge waypoints", () => {
            const sampleXml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI">
  <bpmndi:BPMNDiagram>
    <bpmndi:BPMNPlane>
      <bpmndi:BPMNShape bpmnElement="T1">
        <dc:Bounds x="50" y="60" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge bpmnElement="F1">
        <di:waypoint x="150" y="100" />
        <di:waypoint x="250" y="100" />
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

            const geom = parseLaidOutGeometry(sampleXml);
            expect(geom.shapes.get("T1")).toEqual({ x: 50, y: 60, width: 100, height: 80 });
            expect(geom.edges.get("F1")).toEqual([
                { x: 150, y: 100 },
                { x: 250, y: 100 },
            ]);
        });

        it("extracts nested external label bounds", () => {
            const sampleXml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI">
  <bpmndi:BPMNDiagram>
    <bpmndi:BPMNPlane>
      <bpmndi:BPMNShape bpmnElement="T1">
        <dc:Bounds x="50" y="60" width="100" height="80" />
        <bpmndi:BPMNLabel>
          <dc:Bounds x="55" y="140" width="90" height="14" />
        </bpmndi:BPMNLabel>
      </bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

            const geom = parseLaidOutGeometry(sampleXml);
            expect(geom.labels.get("T1_label")).toEqual({ x: 55, y: 140, width: 90, height: 14 });
        });
    });

    describe("computeCenterOffset", () => {
        it("computes translation delta to align centers", () => {
            const origNodes = [
                { id: "T1", x: 200, y: 200, width: 100, height: 80 },
                { id: "T2", x: 400, y: 200, width: 100, height: 80 },
            ];
            // Orig bounding box: x: 200..500 (center 350), y: 200..280 (center 240)
            const geometry = {
                shapes: new Map([
                    ["T1", { x: 100, y: 100, width: 100, height: 80 }],
                    ["T2", { x: 300, y: 100, width: 100, height: 80 }],
                ]),
                edges: new Map(),
                labels: new Map(),
            };
            // Laid out bounding box: x: 100..400 (center 250), y: 100..180 (center 140)
            // dx = 350 - 250 = 100
            // dy = 240 - 140 = 100
            const offset = computeCenterOffset(origNodes, geometry);
            expect(offset).toEqual({ dx: 100, dy: 100 });
        });

        it("returns dx:0, dy:0 for empty or invalid geometry", () => {
            expect(
                computeCenterOffset([], { shapes: new Map(), edges: new Map(), labels: new Map() }),
            ).toEqual({
                dx: 0,
                dy: 0,
            });
        });
    });

    describe("applySelectiveLayout and layoutSelectedElements", () => {
        let mockModeler: any;
        let mockModeling: any;
        let mockCommandStack: any;

        beforeEach(() => {
            mockModeling = {
                moveElements: vi.fn(),
                updateWaypoints: vi.fn(),
                layoutConnection: vi.fn(),
            };
            mockCommandStack = {
                register: vi.fn((name, handler) => {
                    mockCommandStack._handler = handler;
                }),
                execute: vi.fn((name, context) => {
                    if (mockCommandStack._handler?.preExecute) {
                        mockCommandStack._handler.preExecute(context);
                    }
                }),
            };
            mockModeler = {
                get: (service: string) => {
                    if (service === "modeling") return mockModeling;
                    if (service === "commandStack") return mockCommandStack;
                    return null;
                },
            };
        });

        it("dispatches moves, waypoints, and boundary connection layout via commandStack", async () => {
            const node1 = {
                id: "Task_1",
                x: 100,
                y: 100,
                width: 100,
                height: 80,
                businessObject: { $type: "bpmn:Task" },
            };
            const node2 = {
                id: "Task_2",
                x: 300,
                y: 100,
                width: 100,
                height: 80,
                businessObject: { $type: "bpmn:Task" },
            };
            const internalFlow = {
                id: "Flow_1",
                source: node1,
                target: node2,
                businessObject: { $type: "bpmn:SequenceFlow" },
            };
            const boundaryFlow = {
                id: "Flow_bound",
                source: node2,
                target: { id: "End_1" },
                businessObject: { $type: "bpmn:SequenceFlow" },
            };

            const analysis = {
                isInterconnected: true,
                nodes: [node1, node2],
                internalFlows: [internalFlow],
                boundaryFlows: [boundaryFlow],
            };

            await layoutSelectedElements(mockModeler, analysis);

            expect(mockCommandStack.execute).toHaveBeenCalledWith(
                "selectiveLayout.execute",
                expect.any(Object),
            );
            expect(mockModeling.moveElements).toHaveBeenCalledTimes(2);
            expect(mockModeling.updateWaypoints).toHaveBeenCalledTimes(1);
            expect(mockModeling.layoutConnection).toHaveBeenCalledWith(boundaryFlow);
        });

        it("falls back to direct modeling calls if commandStack is absent", () => {
            const fallbackModeler = {
                get: (service: string) => {
                    if (service === "modeling") return mockModeling;
                    return null;
                },
            };
            const node1 = {
                id: "Task_1",
                x: 100,
                y: 100,
                width: 100,
                height: 80,
                businessObject: { $type: "bpmn:Task" },
            };
            const internalFlow = { id: "Flow_1", businessObject: { $type: "bpmn:SequenceFlow" } };
            const boundaryFlow = {
                id: "Flow_bound",
                businessObject: { $type: "bpmn:SequenceFlow" },
            };

            const analysis = {
                isInterconnected: true,
                nodes: [node1],
                internalFlows: [internalFlow],
                boundaryFlows: [boundaryFlow],
            };
            const geometry = {
                shapes: new Map([["Task_1", { x: 100, y: 100, width: 100, height: 80 }]]),
                edges: new Map([
                    [
                        "Flow_1",
                        [
                            { x: 10, y: 10 },
                            { x: 20, y: 20 },
                        ],
                    ],
                ]),
                labels: new Map(),
            };

            applySelectiveLayout(fallbackModeler, analysis, geometry);

            expect(mockModeling.moveElements).toHaveBeenCalledTimes(1);
            expect(mockModeling.updateWaypoints).toHaveBeenCalledTimes(1);
            expect(mockModeling.layoutConnection).toHaveBeenCalledWith(boundaryFlow);
        });
    });

    describe("applyFullDiagramLayout", () => {
        let mockModeling: any;
        let mockCommandStack: any;
        let mockElementRegistry: any;
        let elements: Record<string, any>;

        beforeEach(() => {
            elements = {
                Task_1: { id: "Task_1", x: 0, y: 0, width: 100, height: 80 },
                Task_1_label: { id: "Task_1_label", x: 5, y: 85, width: 90, height: 14 },
                Flow_1: { id: "Flow_1" },
            };
            mockModeling = {
                moveElements: vi.fn(),
                updateWaypoints: vi.fn(),
                layoutConnection: vi.fn(),
            };
            mockCommandStack = {
                register: vi.fn((name, handler) => {
                    mockCommandStack._handler = handler;
                }),
                execute: vi.fn((name, context) => {
                    if (mockCommandStack._handler?.preExecute) {
                        mockCommandStack._handler.preExecute(context);
                    }
                }),
            };
            mockElementRegistry = {
                get: (id: string) => elements[id],
            };
        });

        it("moves shapes and labels and updates waypoints as a single undoable command, skipping unknown ids", () => {
            const modeler = {
                get: (service: string) => {
                    if (service === "modeling") return mockModeling;
                    if (service === "commandStack") return mockCommandStack;
                    if (service === "elementRegistry") return mockElementRegistry;
                    return null;
                },
            };

            const geometry = {
                shapes: new Map([
                    ["Task_1", { x: 200, y: 150, width: 100, height: 80 }],
                    ["Unknown_shape", { x: 0, y: 0, width: 10, height: 10 }],
                ]),
                labels: new Map([["Task_1_label", { x: 205, y: 235, width: 90, height: 14 }]]),
                edges: new Map([
                    [
                        "Flow_1",
                        [
                            { x: 300, y: 190 },
                            { x: 400, y: 190 },
                        ],
                    ],
                    ["Unknown_flow", [{ x: 0, y: 0 }]],
                ]),
            };

            applyFullDiagramLayout(modeler, geometry);

            // applyFullDiagramLayout dispatches a single composite command (rather
            // than calling modeling.* directly) so the whole relayout is one
            // undo/redo step; the command's own preExecute → modeling.* wiring is
            // already covered by the layoutSelectedElements tests above.
            expect(mockCommandStack.execute).toHaveBeenCalledTimes(1);
            expect(mockCommandStack.execute).toHaveBeenCalledWith("selectiveLayout.execute", {
                moves: [
                    { shape: elements.Task_1, target: { x: 200, y: 150 } },
                    { shape: elements.Task_1_label, target: { x: 205, y: 235 } },
                ],
                waypoints: [
                    {
                        flow: elements.Flow_1,
                        points: [
                            { x: 300, y: 190 },
                            { x: 400, y: 190 },
                        ],
                    },
                ],
                boundaryFlows: [],
            });
        });

        it("aligns labels by center so the editor's own label width keeps the text centered", () => {
            const modeler = {
                get: (service: string) => {
                    if (service === "modeling") return mockModeling;
                    if (service === "commandStack") return {};
                    if (service === "elementRegistry") return mockElementRegistry;
                    return null;
                },
            };

            // Layout estimated a 40px wide label; the editor's label is 90px wide.
            applyFullDiagramLayout(modeler, {
                shapes: new Map(),
                labels: new Map([
                    ["Task_1_label", { x: 200, y: 100, width: 40, height: 14 }],
                    ["Unknown_label", { x: 0, y: 0, width: 10, height: 10 }],
                ]),
                edges: new Map(),
            });

            // Center (220, 107) -> top-left (175, 100) for a 90x14 label.
            expect(mockModeling.moveElements).toHaveBeenCalledTimes(1);
            expect(mockModeling.moveElements).toHaveBeenCalledWith([elements.Task_1_label], {
                x: 170,
                y: 15,
            });
        });

        it("re-attaches boundary events to their host when moving them", () => {
            const host = { id: "Task_1", x: 0, y: 0, width: 100, height: 80 };
            const boundary = { id: "Boundary_1", x: 10, y: 10, host };
            elements.Boundary_1 = boundary;
            const modeler = {
                get: (service: string) => {
                    if (service === "modeling") return mockModeling;
                    if (service === "commandStack") return {};
                    if (service === "elementRegistry") return mockElementRegistry;
                    return null;
                },
            };

            applyFullDiagramLayout(modeler, {
                shapes: new Map([["Boundary_1", { x: 20, y: 30, width: 36, height: 36 }]]),
                labels: new Map(),
                edges: new Map(),
            });

            expect(mockModeling.moveElements).toHaveBeenCalledWith(
                [boundary],
                { x: 10, y: 20 },
                host,
                { attach: true },
            );
        });
    });
});
