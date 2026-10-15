import { describe, it, expect, vi } from "vitest";
import { ExtendElementTemplatesClass } from "./ExtendElementTemplates";

describe("ExtendElementTemplatesClass", () => {
    it("should have correct $inject dependencies", () => {
        expect(ExtendElementTemplatesClass.$inject).toEqual([
            "elementTemplates",
            "templateElementFactory",
            "eventBus",
        ]);
    });

    it("should add createElement method to elementTemplates prototype", () => {
        const mockElementTemplates = {
            __proto__: {} as { createElement: (template: any) => any },
        };
        const mockFactory = {
            create: (template: any) => ({ id: template.id }),
        };

        new ExtendElementTemplatesClass(mockElementTemplates, mockFactory, { on: vi.fn() });

        expect(mockElementTemplates.__proto__.createElement).toBeDefined();
        expect(typeof mockElementTemplates.__proto__.createElement).toBe("function");
    });

    it("should not override existing createElement method", () => {
        const existingCreate = () => "existing";
        const mockElementTemplates = {
            __proto__: {
                createElement: existingCreate,
            },
        };
        const mockFactory = {
            create: () => ({ id: "new" }),
        };

        new ExtendElementTemplatesClass(mockElementTemplates, mockFactory, { on: vi.fn() });

        // Should return early, not override
        expect(mockElementTemplates.__proto__.createElement).toBe(existingCreate);
    });

    it("createElement should call templateElementFactory.create", () => {
        const mockElementTemplates = {
            __proto__: {} as { createElement: (template: any) => any },
        };
        const template = { id: "test-template", name: "Test" };
        const mockFactory = {
            create: (t: any) => ({ ...t, created: true }),
        };

        new ExtendElementTemplatesClass(mockElementTemplates, mockFactory, { on: vi.fn() });

        const result = mockElementTemplates.__proto__.createElement(template);
        expect(result).toEqual({ id: "test-template", name: "Test", created: true });
    });

    it("createElement should throw error if template is missing", () => {
        const mockElementTemplates = {
            __proto__: {} as { createElement: (template: any) => any },
        };
        const mockFactory = {
            create: () => ({}),
        };

        new ExtendElementTemplatesClass(mockElementTemplates, mockFactory, { on: vi.fn() });

        expect(() => {
            mockElementTemplates.__proto__.createElement(null);
        }).toThrow("template is missing");
    });

    it("should persist the template icon when applying a template", () => {
        const mockElementTemplates = { __proto__: { createElement: vi.fn() } };
        const listeners: Record<string, (event: any) => void> = {};
        const mockEventBus = {
            on: vi.fn((event: string, listener: (event: any) => void) => {
                listeners[event] = listener;
            }),
            fire: vi.fn(),
        };
        const businessObject = {
            get: vi.fn().mockReturnValue(undefined),
            set: vi.fn(),
        };
        const element = {
            businessObject,
        };
        const icon = "data:image/svg+xml;base64,icon";
        const applyEvent = "commandStack.propertiesPanel.camunda.changeTemplate.postExecute";

        new ExtendElementTemplatesClass(mockElementTemplates, { create: vi.fn() }, mockEventBus);

        expect(mockEventBus.on).toHaveBeenCalledWith(applyEvent, expect.any(Function));

        listeners[applyEvent]({
            context: {
                element,
                newTemplate: { icon: { contents: icon } },
            },
        });

        expect(businessObject.set).toHaveBeenCalledWith("camunda:modelerTemplateIcon", icon);
        expect(mockEventBus.fire).toHaveBeenCalledWith("element.changed", { element });
    });

    it("should clear the template icon when removing a template", () => {
        const mockElementTemplates = { __proto__: { createElement: vi.fn() } };
        const listeners: Record<string, (event: any) => void> = {};
        const mockEventBus = {
            on: vi.fn((event: string, listener: (event: any) => void) => {
                listeners[event] = listener;
            }),
            fire: vi.fn(),
        };
        const businessObject = {
            get: vi.fn().mockReturnValue("old-icon"),
            set: vi.fn(),
        };
        const element = {
            businessObject,
        };
        const removeEvent = "commandStack.propertiesPanel.removeTemplate.postExecute";

        new ExtendElementTemplatesClass(mockElementTemplates, { create: vi.fn() }, mockEventBus);
        listeners[removeEvent]({ context: { element } });

        expect(mockEventBus.on).toHaveBeenCalledWith(removeEvent, expect.any(Function));
        expect(businessObject.set).toHaveBeenCalledWith("camunda:modelerTemplateIcon", undefined);
        expect(mockEventBus.fire).toHaveBeenCalledWith("element.changed", { element });
    });

    it("should restore the old icon when reverting template removal", () => {
        const mockElementTemplates = { __proto__: { createElement: vi.fn() } };
        const listeners: Record<string, (event: any) => void> = {};
        const mockEventBus = {
            on: vi.fn((event: string, listener: (event: any) => void) => {
                listeners[event] = listener;
            }),
            fire: vi.fn(),
        };
        const businessObject = {
            get: vi.fn().mockReturnValue(undefined),
            set: vi.fn(),
        };
        const element = {
            businessObject,
        };
        const icon = "data:image/svg+xml;base64,old-icon";
        const revertEvent = "commandStack.propertiesPanel.removeTemplate.postRevert";

        new ExtendElementTemplatesClass(mockElementTemplates, { create: vi.fn() }, mockEventBus);
        listeners[revertEvent]({
            context: {
                element,
                oldTemplate: { icon: { contents: icon } },
            },
        });

        expect(mockEventBus.on).toHaveBeenCalledWith(revertEvent, expect.any(Function));
        expect(businessObject.set).toHaveBeenCalledWith("camunda:modelerTemplateIcon", icon);
        expect(mockEventBus.fire).toHaveBeenCalledWith("element.changed", { element });
    });
});
