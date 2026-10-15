import { describe, it, expect } from "vitest";
import { SafeRemoveTemplateReplaceClass } from "./SafeRemoveTemplateReplace";

function injectorWith(provider: unknown) {
    return { get: (name: string) => (name === "removeTemplateReplaceProvider" ? provider : null) };
}

describe("SafeRemoveTemplateReplaceClass", () => {
    it("should inject the injector", () => {
        expect(SafeRemoveTemplateReplaceClass.$inject).toEqual(["injector"]);
    });

    it("should do nothing without the provider", () => {
        expect(() => new SafeRemoveTemplateReplaceClass(injectorWith(null))).not.toThrow();
    });

    it("should keep the original result", () => {
        const provider = {
            entry: ["index", { id: "replace" }],
            getPlainEntry() {
                return this.entry;
            },
        };

        new SafeRemoveTemplateReplaceClass(injectorWith(provider));

        expect(provider.getPlainEntry()).toEqual(["index", { id: "replace" }]);
    });

    it("should skip the entry when the replace options lookup fails", () => {
        const provider = {
            getPlainEntry() {
                const options: any = {};
                return options.findIndex(() => true);
            },
        };

        new SafeRemoveTemplateReplaceClass(injectorWith(provider));

        expect(provider.getPlainEntry()).toBeUndefined();
    });

    it("should rethrow other errors", () => {
        const provider = {
            getPlainEntry() {
                throw new Error("boom");
            },
        };

        new SafeRemoveTemplateReplaceClass(injectorWith(provider));

        expect(() => provider.getPlainEntry()).toThrow("boom");
    });

    it("should rethrow unrelated TypeErrors", () => {
        const provider = {
            getPlainEntry() {
                throw new TypeError("unrelated error");
            },
        };

        new SafeRemoveTemplateReplaceClass(injectorWith(provider));

        expect(() => provider.getPlainEntry()).toThrow(TypeError);
        expect(() => provider.getPlainEntry()).toThrow("unrelated error");
    });
});
