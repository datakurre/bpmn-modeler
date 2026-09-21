import { describe, it, expect, vi } from "vitest";
import TemplateElementFactory from "./TemplateElementFactory";

describe("TemplateElementFactory", () => {
    it("should have $inject property", () => {
        expect(TemplateElementFactory.$inject).toEqual(["commandStack", "elementFactory"]);
    });

    it("should be a class", () => {
        expect(typeof TemplateElementFactory).toBe("function");
    });

    it("should have create method", () => {
        expect(typeof TemplateElementFactory.prototype.create).toBe("function");
    });

    it("should create element from template", () => {
        const mockCommandStack = { execute: vi.fn() };
        const mockElement = {
            businessObject: {
                set: vi.fn(),
            },
        };
        const mockElementFactory = {
            createShape: vi.fn().mockReturnValue(mockElement),
        };

        const factory = new TemplateElementFactory(mockCommandStack, mockElementFactory);
        const template = {
            id: "test-template",
            version: 1,
            appliesTo: ["bpmn:Task"],
        };

        const result = factory.create(template);

        expect(mockElementFactory.createShape).toHaveBeenCalledWith({
            type: "bpmn:Task",
        });
        expect(mockElement.businessObject.set).toHaveBeenCalledWith(
            "camunda:modelerTemplate",
            "test-template",
        );
        expect(mockElement.businessObject.set).toHaveBeenCalledWith(
            "camunda:modelerTemplateVersion",
            1,
        );
        expect(mockCommandStack.execute).toHaveBeenCalledWith(
            "propertiesPanel.camunda.changeTemplate",
            {
                element: mockElement,
                oldTemplate: null,
                newTemplate: template,
            },
        );
        expect(result).toBe(mockElement);
    });

    it("should create element with custom elementType", () => {
        const mockCommandStack = { execute: vi.fn() };
        const mockElement = {
            businessObject: {
                set: vi.fn(),
            },
        };
        const mockElementFactory = {
            createShape: vi.fn().mockReturnValue(mockElement),
        };

        const factory = new TemplateElementFactory(mockCommandStack, mockElementFactory);
        const template = {
            id: "test-template",
            version: 2,
            appliesTo: ["bpmn:Task"],
            elementType: {
                value: "bpmn:ServiceTask",
            },
        };

        factory.create(template);

        expect(mockElementFactory.createShape).toHaveBeenCalledWith({
            type: "bpmn:ServiceTask",
        });
    });

    it("should create element with event definition", () => {
        const mockCommandStack = { execute: vi.fn() };
        const mockElement = {
            businessObject: {
                set: vi.fn(),
            },
        };
        const mockElementFactory = {
            createShape: vi.fn().mockReturnValue(mockElement),
        };

        const factory = new TemplateElementFactory(mockCommandStack, mockElementFactory);
        const template = {
            id: "test-template",
            version: 1,
            appliesTo: ["bpmn:IntermediateThrowEvent"],
            elementType: {
                eventDefinition: "bpmn:MessageEventDefinition",
            },
        };

        factory.create(template);

        expect(mockElementFactory.createShape).toHaveBeenCalledWith({
            type: "bpmn:IntermediateThrowEvent",
            eventDefinitionType: "bpmn:MessageEventDefinition",
        });
    });

    it("should set modelerTemplateIcon when template has icon", () => {
        const mockCommandStack = { execute: vi.fn() };
        const mockElement = {
            businessObject: {
                set: vi.fn(),
            },
        };
        const mockElementFactory = {
            createShape: vi.fn().mockReturnValue(mockElement),
        };

        const factory = new TemplateElementFactory(mockCommandStack, mockElementFactory);
        const template = {
            id: "icon-template",
            version: 1,
            appliesTo: ["bpmn:ServiceTask"],
            icon: {
                contents: "data:image/svg+xml,%3Csvg width='18' height='18'%3E%3C/svg%3E",
            },
        };

        factory.create(template);

        expect(mockElement.businessObject.set).toHaveBeenCalledWith(
            "camunda:modelerTemplateIcon",
            "data:image/svg+xml,%3Csvg width='18' height='18'%3E%3C/svg%3E",
        );
    });

    it("should not set modelerTemplateIcon when template has no icon", () => {
        const mockCommandStack = { execute: vi.fn() };
        const mockElement = {
            businessObject: {
                set: vi.fn(),
            },
        };
        const mockElementFactory = {
            createShape: vi.fn().mockReturnValue(mockElement),
        };

        const factory = new TemplateElementFactory(mockCommandStack, mockElementFactory);
        const template = {
            id: "no-icon-template",
            version: 1,
            appliesTo: ["bpmn:ServiceTask"],
        };

        factory.create(template);

        const setCalls = mockElement.businessObject.set.mock.calls;
        const iconCall = setCalls.find((call: any[]) => call[0] === "camunda:modelerTemplateIcon");
        expect(iconCall).toBeUndefined();
    });
});
