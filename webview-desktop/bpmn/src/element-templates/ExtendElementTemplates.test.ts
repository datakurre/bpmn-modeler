import { describe, it, expect } from "vitest";
import { ExtendElementTemplatesClass } from "./ExtendElementTemplates";

describe("ExtendElementTemplatesClass", () => {
    it("should have correct $inject dependencies", () => {
        expect(ExtendElementTemplatesClass.$inject).toEqual([
            "elementTemplates",
            "templateElementFactory",
        ]);
    });

    it("should add createElement method to elementTemplates prototype", () => {
        const mockElementTemplates = {
            __proto__: {},
        };
        const mockFactory = {
            create: (template: any) => ({ id: template.id }),
        };

        new ExtendElementTemplatesClass(mockElementTemplates, mockFactory);

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

        new ExtendElementTemplatesClass(mockElementTemplates, mockFactory);

        // Should return early, not override
        expect(mockElementTemplates.__proto__.createElement).toBe(existingCreate);
    });

    it("createElement should call templateElementFactory.create", () => {
        const mockElementTemplates = {
            __proto__: {},
        };
        const template = { id: "test-template", name: "Test" };
        const mockFactory = {
            create: (t: any) => ({ ...t, created: true }),
        };

        new ExtendElementTemplatesClass(mockElementTemplates, mockFactory);

        const result = mockElementTemplates.__proto__.createElement(template);
        expect(result).toEqual({ id: "test-template", name: "Test", created: true });
    });

    it("createElement should throw error if template is missing", () => {
        const mockElementTemplates = {
            __proto__: {},
        };
        const mockFactory = {
            create: () => ({}),
        };

        new ExtendElementTemplatesClass(mockElementTemplates, mockFactory);

        expect(() => {
            mockElementTemplates.__proto__.createElement(null);
        }).toThrow("template is missing");
    });
});
