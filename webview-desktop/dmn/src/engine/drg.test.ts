import { describe, it, expect } from "vitest";
import { resolveEvaluationOrder, getDependencies } from "./drg";
import type { DmnModel, DmnDecision } from "./parse";

function makeModel(
    decisions: Array<{
        id: string;
        name?: string;
        requires?: string[];
    }>
): DmnModel {
    const map = new Map<string, DmnDecision>();
    for (const d of decisions) {
        map.set(d.id, {
            id: d.id,
            name: d.name || d.id,
            logic: {
                type: "decisionTable",
                hitPolicy: "UNIQUE",
                inputs: [],
                outputs: [],
                rules: [],
            },
            informationRequirements: d.requires || [],
        });
    }
    return {
        id: "definitions_1",
        name: "Test",
        namespace: "http://test",
        decisions: map,
    };
}

describe("resolveEvaluationOrder", () => {
    it("returns single decision for standalone decision", () => {
        const model = makeModel([{ id: "d1" }]);
        const order = resolveEvaluationOrder(model, "d1");
        expect(order).toEqual(["d1"]);
    });

    it("resolves linear dependency chain", () => {
        const model = makeModel([
            { id: "d1" },
            { id: "d2", requires: ["d1"] },
            { id: "d3", requires: ["d2"] },
        ]);
        const order = resolveEvaluationOrder(model, "d3");
        expect(order).toEqual(["d1", "d2", "d3"]);
    });

    it("resolves diamond dependency", () => {
        const model = makeModel([
            { id: "base" },
            { id: "left", requires: ["base"] },
            { id: "right", requires: ["base"] },
            { id: "top", requires: ["left", "right"] },
        ]);
        const order = resolveEvaluationOrder(model, "top");
        // base must come before left and right, left and right before top
        expect(order.indexOf("base")).toBeLessThan(order.indexOf("left"));
        expect(order.indexOf("base")).toBeLessThan(order.indexOf("right"));
        expect(order.indexOf("left")).toBeLessThan(order.indexOf("top"));
        expect(order.indexOf("right")).toBeLessThan(order.indexOf("top"));
        expect(order).toHaveLength(4);
    });

    it("resolves all decisions when no target given", () => {
        const model = makeModel([
            { id: "d1" },
            { id: "d2", requires: ["d1"] },
            { id: "d3" },
        ]);
        const order = resolveEvaluationOrder(model);
        expect(order).toHaveLength(3);
        expect(order.indexOf("d1")).toBeLessThan(order.indexOf("d2"));
    });

    it("throws on circular dependency", () => {
        const model = makeModel([
            { id: "a", requires: ["b"] },
            { id: "b", requires: ["a"] },
        ]);
        expect(() => resolveEvaluationOrder(model, "a")).toThrow(
            /Circular dependency/
        );
    });

    it("throws when decision not found", () => {
        const model = makeModel([{ id: "d1" }]);
        expect(() => resolveEvaluationOrder(model, "missing")).toThrow(
            /Decision not found/
        );
    });

    it("only includes required decisions for target", () => {
        const model = makeModel([
            { id: "d1" },
            { id: "d2", requires: ["d1"] },
            { id: "d3" },
        ]);
        const order = resolveEvaluationOrder(model, "d2");
        expect(order).toEqual(["d1", "d2"]);
        expect(order).not.toContain("d3");
    });

    it("throws on self-circular dependency", () => {
        const model = makeModel([{ id: "a", requires: ["a"] }]);
        expect(() => resolveEvaluationOrder(model, "a")).toThrow(
            /Circular dependency/
        );
    });

    it("throws on circular dependency in all-resolution", () => {
        const model = makeModel([
            { id: "a", requires: ["b"] },
            { id: "b", requires: ["a"] },
        ]);
        expect(() => resolveEvaluationOrder(model)).toThrow(
            /Circular dependency/
        );
    });

    it("handles complex multi-level dependencies", () => {
        const model = makeModel([
            { id: "a" },
            { id: "b" },
            { id: "c", requires: ["a", "b"] },
            { id: "d", requires: ["c"] },
            { id: "e", requires: ["d", "b"] },
        ]);
        const order = resolveEvaluationOrder(model, "e");
        expect(order.indexOf("a")).toBeLessThan(order.indexOf("c"));
        expect(order.indexOf("b")).toBeLessThan(order.indexOf("c"));
        expect(order.indexOf("c")).toBeLessThan(order.indexOf("d"));
        expect(order.indexOf("d")).toBeLessThan(order.indexOf("e"));
        expect(order.indexOf("b")).toBeLessThan(order.indexOf("e"));
    });

    it("handles empty model", () => {
        const model = makeModel([]);
        const order = resolveEvaluationOrder(model);
        expect(order).toEqual([]);
    });

    it("handles multiple independent decision chains", () => {
        const model = makeModel([
            { id: "a1" },
            { id: "a2", requires: ["a1"] },
            { id: "b1" },
            { id: "b2", requires: ["b1"] },
        ]);
        const order = resolveEvaluationOrder(model);
        expect(order).toHaveLength(4);
        expect(order.indexOf("a1")).toBeLessThan(order.indexOf("a2"));
        expect(order.indexOf("b1")).toBeLessThan(order.indexOf("b2"));
    });

    it("throws on missing required decision", () => {
        const model = makeModel([{ id: "d1", requires: ["missing"] }]);
        expect(() => resolveEvaluationOrder(model, "d1")).toThrow(
            /Decision not found.*missing/
        );
    });
});

describe("getDependencies", () => {
    it("returns empty array for standalone decision", () => {
        const model = makeModel([{ id: "d1" }]);
        expect(getDependencies(model, "d1")).toEqual([]);
    });

    it("returns dependencies without the target", () => {
        const model = makeModel([
            { id: "d1" },
            { id: "d2", requires: ["d1"] },
            { id: "d3", requires: ["d2"] },
        ]);
        const deps = getDependencies(model, "d3");
        expect(deps).toEqual(["d1", "d2"]);
        expect(deps).not.toContain("d3");
    });

    it("returns all transitive dependencies", () => {
        const model = makeModel([
            { id: "base" },
            { id: "mid", requires: ["base"] },
            { id: "top", requires: ["mid"] },
        ]);
        const deps = getDependencies(model, "top");
        expect(deps).toContain("base");
        expect(deps).toContain("mid");
    });
});
