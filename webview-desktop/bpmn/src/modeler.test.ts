/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// Create mock factory function
const createBpmnModelerMock = () => {
    return class MockBpmnModeler {
        constructor(public options: any) {}
        get(service: string) {
            if (service === "eventBus") {
                return {
                    on: vi.fn(),
                };
            }
            if (service === "elementTemplatesLoader") {
                return {
                    setTemplates: vi.fn(),
                };
            }
            if (service === "linkedResourceOverlays") {
                return { mock: "overlays" };
            }
            if (service === "scriptTextareaDecorator") {
                return {
                    setVsCodeApi: vi.fn(),
                    updateFromExtension: vi.fn(),
                };
            }
            if (service === "alignToOrigin") {
                return {
                    align: vi.fn(),
                };
            }
            return {};
        }
        createDiagram() {
            return Promise.resolve({ warnings: [] });
        }
        importXML(xml: string) {
            if (xml.includes("ERROR")) {
                return Promise.reject({
                    warnings: ["Test warning"],
                    message: "Test error",
                });
            }
            return Promise.resolve({ warnings: [] });
        }
        async saveXML(options: any) {
            return { xml: "<test></test>" };
        }
        async saveSVG() {
            return { svg: "<svg></svg>" };
        }
        _destroy() {}
    };
};

// Mock the dependencies
vi.mock("camunda-bpmn-js/lib/base/Modeler", () => ({
    default: class MockModeler {},
}));

vi.mock("camunda-bpmn-js/lib/camunda-platform/Modeler", () => ({
    default: createBpmnModelerMock(),
}));

vi.mock("bpmn-js-token-simulation", () => ({ default: {} }));
vi.mock("@bpmn-io/element-template-chooser", () => ({ default: {} }));
vi.mock("@bpmn-io/element-template-icon-renderer", () => ({ default: {} }));
vi.mock("camunda-modeler-robot-plugin/dist/module", () => ({ default: {} }));
vi.mock("bpmn-js-create-append-anything", () => ({
    CreateAppendElementTemplatesModule: {},
}));
vi.mock("./element-templates", () => ({ ExtendElementTemplates: {} }));
vi.mock("./element-templates/operatonTemplateModdle.json", () => ({ default: {} }));
vi.mock("./script-editor", () => ({
    ScriptEditorModule: {},
    ScriptTextareaDecorator: class {
        static $inject = ["eventBus", "elementRegistry", "commandStack"];
    },
}));

describe("Modeler Module", () => {
    let modeler: any;

    beforeEach(async () => {
        // Clear module cache and reimport
        vi.resetModules();
        const modelerModule = await import("./modeler");
        modeler = modelerModule.createModeler();
    });

    it("should create a modeler instance", async () => {
        expect(modeler).toBeDefined();
        expect(modeler.options).toBeDefined();
    });

    it("should create modeler with correct container", async () => {
        expect(modeler.options.container).toBe("#js-canvas");
    });

    it("should create modeler with properties panel configuration", async () => {
        expect(modeler.options.propertiesPanel).toBeDefined();
        expect(modeler.options.propertiesPanel.parent).toBe("#js-properties-panel");
    });

    it("should create modeler with alignToOrigin configuration", async () => {
        expect(modeler.options.alignToOrigin).toBeDefined();
        expect(modeler.options.alignToOrigin.alignOnSave).toBe(false);
        expect(modeler.options.alignToOrigin.offset).toBe(150);
    });

    it("should include required modules", async () => {
        expect(modeler.options.additionalModules).toBeDefined();
        expect(Array.isArray(modeler.options.additionalModules)).toBe(true);
        expect(modeler.options.additionalModules.length).toBeGreaterThan(0);
    });

    it("should configure element template icon renderer for camunda:modelerTemplateIcon", async () => {
        expect(modeler.options.elementTemplateIconRenderer).toBeDefined();
        expect(modeler.options.elementTemplateIconRenderer.iconProperty).toBe(
            "camunda:modelerTemplateIcon",
        );
    });

    it("should include camunda moddle extension with modelerTemplateIcon", async () => {
        expect(modeler.options.moddleExtensions).toBeDefined();
        const camundaExt = modeler.options.moddleExtensions.camunda;
        expect(camundaExt).toBeDefined();
        const templateSupported = camundaExt.types.find((t: any) => t.name === "TemplateSupported");
        expect(templateSupported).toBeDefined();
        const iconProp = templateSupported.properties.find(
            (p: any) => p.name === "modelerTemplateIcon",
        );
        expect(iconProp).toBeDefined();
    });

    it("should export diagram as XML", async () => {
        const modelerModule = await import("./modeler");
        const result = await modelerModule.exportDiagram();
        expect(result).toBeDefined();
        expect(typeof result).toBe("string");
    });

    it("should export diagram as SVG", async () => {
        const modelerModule = await import("./modeler");
        const result = await modelerModule.getDiagramSvg();
        expect(result).toBeDefined();
        expect(typeof result).toBe("string");
    });

    it("should set element templates", async () => {
        const modelerModule = await import("./modeler");
        const templates = [{ id: "test-template" }];
        // Should not throw
        modelerModule.setElementTemplates(templates);
    });

    it("should align elements to origin when enabled", async () => {
        const modelerModule = await import("./modeler");
        modelerModule.setSettings({ alignToOrigin: true });
        // Should not throw
        modelerModule.alignElementsToOrigin();
    });
});

describe("Modeler API Functions", () => {
    let modelerModule: any;
    let modeler: any;

    beforeEach(async () => {
        modelerModule = await import("./modeler");
        if (!modeler) {
            modeler = modelerModule.createModeler();
        }
    });

    it("should register commandStack.changed listener", () => {
        const callback = vi.fn();
        modelerModule.onCommandStackChanged(callback);
        // Just verify it doesn't throw
        expect(callback).toBeDefined();
    });

    it("should create new diagram", async () => {
        const result = await modelerModule.newDiagram();
        expect(result).toBeDefined();
        expect(result.warnings).toBeDefined();
    });

    it("should create new diagrams as executable with a 7 day history TTL", () => {
        expect(modelerModule.INITIAL_DIAGRAM).toContain('isExecutable="true"');
        expect(modelerModule.INITIAL_DIAGRAM).toContain('camunda:historyTimeToLive="7"');
    });

    it("should load diagram from XML", async () => {
        const result = await modelerModule.loadDiagram("<bpmn:definitions></bpmn:definitions>");
        expect(result).toBeDefined();
        expect(result.warnings).toBeDefined();
    });

    it("should handle load diagram errors", async () => {
        await expect(modelerModule.loadDiagram("ERROR")).rejects.toThrow();
    });

    it("should handle load diagram errors without warnings", async () => {
        vi.resetModules();
        vi.doMock("camunda-bpmn-js/lib/camunda-platform/Modeler", () => ({
            default: class MockBpmnModeler {
                constructor(public options: any) {}
                get(service: string) {
                    return { on: vi.fn() };
                }
                importXML(xml: string) {
                    return Promise.reject(new Error("Generic error"));
                }
            },
        }));

        const m = await import("./modeler");
        m.createModeler();
        await expect(m.loadDiagram("<test>")).rejects.toThrow("Generic error");
    });

    // Note: Export tests are covered in "Modeler Module" test suite
    // which creates a fresh modeler without resetModules interference

    it("should handle undefined element templates", () => {
        // Should not throw
        modelerModule.setElementTemplates(undefined);
    });

    it("should get linked resource overlays", () => {
        const overlays = modelerModule.getLinkedResourceOverlays();
        expect(overlays).toBeDefined();
    });

    it("should set settings and apply theme", () => {
        modelerModule.setSettings({ darkTheme: true });
        // Should not throw
    });

    it("should handle undefined settings", () => {
        modelerModule.setSettings(undefined);
        // Should not throw
    });

    it("should not align elements when setting is disabled", () => {
        modelerModule.setSettings({ alignToOrigin: false });
        // Should not throw
        modelerModule.alignElementsToOrigin();
    });
});

describe("Modeler Theme Switching", () => {
    let modelerModule: any;
    let modeler: any;

    beforeEach(async () => {
        // Set up DOM for theme tests
        document.body.innerHTML = `<link id="theme-link" href="/styles/lightTheme.css" />`;
        modelerModule = await import("./modeler");
        if (!modeler) {
            modeler = modelerModule.createModeler();
        }
    });

    it("should switch from light to dark theme", () => {
        const link = document.querySelector<HTMLLinkElement>("#theme-link");
        expect(link?.href).toContain("lightTheme.css");

        modelerModule.setSettings({ darkTheme: true });

        expect(link?.href).toContain("darkTheme.css");
    });

    it("should switch from dark to light theme", () => {
        const link = document.querySelector<HTMLLinkElement>("#theme-link");
        if (link) link.href = "/styles/darkTheme.css";

        modelerModule.setSettings({ darkTheme: false });

        expect(link?.href).toContain("lightTheme.css");
    });

    it("should handle missing theme link element", () => {
        document.body.innerHTML = "";
        // Should not throw
        modelerModule.setSettings({ darkTheme: true });
    });

    it("should not switch theme when already in correct theme", () => {
        const link = document.querySelector<HTMLLinkElement>("#theme-link");
        const originalHref = link?.href;

        modelerModule.setSettings({ darkTheme: false });

        expect(link?.href).toBe(originalHref);
    });
});

describe("Modeler Error Handling", () => {
    beforeEach(async () => {
        vi.resetModules();
    });

    it("should throw error when getting modeler before creation", async () => {
        const modelerModule = await import("./modeler");
        // Don't create modeler
        await expect(modelerModule.exportDiagram()).rejects.toThrow("Modeler is not initialized!");
    });

    it("should handle saveXML with error result", async () => {
        vi.resetModules();
        vi.doMock("camunda-bpmn-js/lib/camunda-platform/Modeler", () => ({
            default: class MockBpmnModeler {
                constructor(public options: any) {}
                get(service: string) {
                    return { on: vi.fn() };
                }
                async saveXML(options: any) {
                    return { error: new Error("Save failed") };
                }
            },
        }));

        const modelerModule = await import("./modeler");
        modelerModule.createModeler();

        await expect(modelerModule.exportDiagram()).rejects.toThrow("Save failed");
    });

    it("should handle saveXML with neither xml nor error", async () => {
        vi.resetModules();
        vi.doMock("camunda-bpmn-js/lib/camunda-platform/Modeler", () => ({
            default: class MockBpmnModeler {
                constructor(public options: any) {}
                get(service: string) {
                    return { on: vi.fn() };
                }
                async saveXML(options: any) {
                    return {};
                }
            },
        }));

        const modelerModule = await import("./modeler");
        modelerModule.createModeler();

        await expect(modelerModule.exportDiagram()).rejects.toThrow("Failed to save diagram");
    });
});

// ---------------------------------------------------------------------------
// groupCallerLinks — multi-caller back-link chooser helper
// ---------------------------------------------------------------------------

describe("groupCallerLinks", () => {
    // Import directly from the linked-resources module (no bpmn-js dependency)
    let groupCallerLinks: (links: any[]) => { callerGroups: any[]; nonCallerLinks: any[] };

    beforeEach(async () => {
        vi.resetModules();
        const mod = await import("./linked-resources");
        groupCallerLinks = mod.groupCallerLinks;
    });

    const makeCallerLink = (elementId: string, targetPath: string) => ({
        elementId,
        refId: "Sub_Process",
        refType: "caller" as const,
        targetPath,
    });

    const makeForwardLink = (elementId: string, targetPath: string) => ({
        elementId,
        refId: "Sub_Process",
        refType: "process" as const,
        targetPath,
    });

    it("returns empty groups when there are no caller links", () => {
        const links = [makeForwardLink("Call_1", "sub.bpmn")];
        const { callerGroups, nonCallerLinks } = groupCallerLinks(links);

        expect(callerGroups).toHaveLength(0);
        expect(nonCallerLinks).toHaveLength(1);
    });

    it("single caller produces one group with one candidate", () => {
        const links = [makeCallerLink("StartEvent_1", "callerA.bpmn")];
        const { callerGroups, nonCallerLinks } = groupCallerLinks(links);

        expect(nonCallerLinks).toHaveLength(0);
        expect(callerGroups).toHaveLength(1);
        expect(callerGroups[0].elementId).toBe("StartEvent_1");
        expect(callerGroups[0].candidates).toHaveLength(1);
        expect(callerGroups[0].candidates[0].relativePath).toBe("callerA.bpmn");
    });

    it("multiple callers sharing the same elementId collapse into one group", () => {
        const links = [
            makeCallerLink("StartEvent_1", "processes/callerA.bpmn"),
            makeCallerLink("StartEvent_1", "processes/callerB.bpmn"),
            makeCallerLink("StartEvent_1", "processes/callerC.bpmn"),
        ];
        const { callerGroups, nonCallerLinks } = groupCallerLinks(links);

        expect(nonCallerLinks).toHaveLength(0);
        expect(callerGroups).toHaveLength(1);
        expect(callerGroups[0].candidates).toHaveLength(3);
        const paths = callerGroups[0].candidates.map((c: any) => c.relativePath);
        expect(paths).toContain("processes/callerA.bpmn");
        expect(paths).toContain("processes/callerB.bpmn");
        expect(paths).toContain("processes/callerC.bpmn");
    });

    it("caller links from different elementIds produce separate groups", () => {
        const links = [
            makeCallerLink("Start_A", "callerA.bpmn"),
            makeCallerLink("Start_B", "callerB.bpmn"),
        ];
        const { callerGroups } = groupCallerLinks(links);

        expect(callerGroups).toHaveLength(2);
        const ids = callerGroups.map((g: any) => g.elementId);
        expect(ids).toContain("Start_A");
        expect(ids).toContain("Start_B");
    });

    it("derives label from the filename portion of the path", () => {
        const links = [makeCallerLink("StartEvent_1", "deeply/nested/dir/caller.bpmn")];
        const { callerGroups } = groupCallerLinks(links);

        expect(callerGroups[0].candidates[0].label).toBe("caller.bpmn");
    });

    it("preserves non-caller links unchanged while grouping callers", () => {
        const links = [
            makeForwardLink("Call_1", "sub.bpmn"),
            makeCallerLink("StartEvent_1", "callerA.bpmn"),
            makeCallerLink("StartEvent_1", "callerB.bpmn"),
        ];
        const { callerGroups, nonCallerLinks } = groupCallerLinks(links);

        expect(nonCallerLinks).toHaveLength(1);
        expect(nonCallerLinks[0].elementId).toBe("Call_1");
        expect(callerGroups).toHaveLength(1);
        expect(callerGroups[0].candidates).toHaveLength(2);
    });
});
