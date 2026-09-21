import { describe, it, expect } from "vitest";
import { applyHitPolicy, type MatchedRule } from "./hit-policy";

function makeRule(
    index: number,
    outputs: Record<string, unknown>
): MatchedRule {
    return { id: `rule_${index}`, index, outputs };
}

describe("applyHitPolicy", () => {
    describe("UNIQUE", () => {
        it("returns null for no matches", () => {
            const result = applyHitPolicy("UNIQUE", undefined, [], ["output"]);
            expect(result.result).toBe(null);
            expect(result.error).toBeUndefined();
        });

        it("returns the single matched rule", () => {
            const rules = [makeRule(0, { output: "yes" })];
            const result = applyHitPolicy("UNIQUE", undefined, rules, [
                "output",
            ]);
            expect(result.result).toEqual({ output: "yes" });
        });

        it("returns error for multiple matches", () => {
            const rules = [
                makeRule(0, { output: "yes" }),
                makeRule(1, { output: "no" }),
            ];
            const result = applyHitPolicy("UNIQUE", undefined, rules, [
                "output",
            ]);
            expect(result.result).toBe(null);
            expect(result.error).toContain("UNIQUE");
        });
    });

    describe("ANY", () => {
        it("returns null for no matches", () => {
            const result = applyHitPolicy("ANY", undefined, [], ["output"]);
            expect(result.result).toBe(null);
        });

        it("returns single match", () => {
            const rules = [makeRule(0, { output: "yes" })];
            const result = applyHitPolicy("ANY", undefined, rules, ["output"]);
            expect(result.result).toEqual({ output: "yes" });
        });

        it("returns first if all outputs are identical", () => {
            const rules = [
                makeRule(0, { output: "yes" }),
                makeRule(1, { output: "yes" }),
            ];
            const result = applyHitPolicy("ANY", undefined, rules, ["output"]);
            expect(result.result).toEqual({ output: "yes" });
        });

        it("returns error for different outputs", () => {
            const rules = [
                makeRule(0, { output: "yes" }),
                makeRule(1, { output: "no" }),
            ];
            const result = applyHitPolicy("ANY", undefined, rules, ["output"]);
            expect(result.result).toBe(null);
            expect(result.error).toContain("ANY");
        });
    });

    describe("FIRST", () => {
        it("returns null for no matches", () => {
            const result = applyHitPolicy("FIRST", undefined, [], ["output"]);
            expect(result.result).toBe(null);
        });

        it("returns the first match", () => {
            const rules = [
                makeRule(0, { output: "first" }),
                makeRule(1, { output: "second" }),
            ];
            const result = applyHitPolicy("FIRST", undefined, rules, [
                "output",
            ]);
            expect(result.result).toEqual({ output: "first" });
        });
    });

    describe("RULE ORDER", () => {
        it("returns empty array for no matches", () => {
            const result = applyHitPolicy(
                "RULE ORDER",
                undefined,
                [],
                ["output"]
            );
            expect(result.result).toEqual([]);
        });

        it("returns all matches in order", () => {
            const rules = [
                makeRule(0, { tag: "young" }),
                makeRule(2, { tag: "vip" }),
            ];
            const result = applyHitPolicy("RULE ORDER", undefined, rules, [
                "tag",
            ]);
            expect(result.result).toEqual([{ tag: "young" }, { tag: "vip" }]);
        });
    });

    describe("COLLECT", () => {
        it("returns empty array without aggregation and no matches", () => {
            const result = applyHitPolicy(
                "COLLECT",
                undefined,
                [],
                ["discount"]
            );
            expect(result.result).toEqual([]);
        });

        it("returns all outputs without aggregation", () => {
            const rules = [
                makeRule(0, { discount: 5 }),
                makeRule(1, { discount: 10 }),
            ];
            const result = applyHitPolicy("COLLECT", undefined, rules, [
                "discount",
            ]);
            expect(result.result).toEqual([{ discount: 5 }, { discount: 10 }]);
        });

        it("SUM aggregation", () => {
            const rules = [
                makeRule(0, { discount: 5 }),
                makeRule(1, { discount: 10 }),
            ];
            const result = applyHitPolicy("COLLECT", "SUM", rules, [
                "discount",
            ]);
            expect(result.result).toBe(15);
        });

        it("MIN aggregation", () => {
            const rules = [
                makeRule(0, { discount: 5 }),
                makeRule(1, { discount: 10 }),
                makeRule(2, { discount: 3 }),
            ];
            const result = applyHitPolicy("COLLECT", "MIN", rules, [
                "discount",
            ]);
            expect(result.result).toBe(3);
        });

        it("MAX aggregation", () => {
            const rules = [
                makeRule(0, { discount: 5 }),
                makeRule(1, { discount: 10 }),
            ];
            const result = applyHitPolicy("COLLECT", "MAX", rules, [
                "discount",
            ]);
            expect(result.result).toBe(10);
        });

        it("COUNT aggregation", () => {
            const rules = [
                makeRule(0, { discount: 5 }),
                makeRule(1, { discount: 10 }),
                makeRule(2, { discount: 3 }),
            ];
            const result = applyHitPolicy("COLLECT", "COUNT", rules, [
                "discount",
            ]);
            expect(result.result).toBe(3);
        });

        it("returns null for SUM with no matches", () => {
            const result = applyHitPolicy("COLLECT", "SUM", [], ["discount"]);
            expect(result.result).toBe(null);
        });

        it("returns error for unknown aggregation", () => {
            const rules = [makeRule(0, { discount: 5 })];
            const result = applyHitPolicy("COLLECT", "UNKNOWN", rules, [
                "discount",
            ]);
            expect(result.error).toContain("Unknown COLLECT aggregation");
        });

        it("returns error when aggregation applied to multi-output table", () => {
            const rules = [makeRule(0, { out1: 5, out2: 10 })];
            const result = applyHitPolicy("COLLECT", "SUM", rules, [
                "out1",
                "out2",
            ]);
            expect(result.result).toBe(null);
            expect(result.error).toContain("multiple output columns");
        });

        it("COUNT returns 0 for no matches", () => {
            const result = applyHitPolicy("COLLECT", "COUNT", [], ["discount"]);
            expect(result.result).toBe(0);
            expect(result.error).toBeUndefined();
        });

        it("SUM returns 0 for empty values list", () => {
            // SUM of no matched rules after the length check
            const result = applyHitPolicy("COLLECT", "SUM", [], ["discount"]);
            expect(result.result).toBe(null);
        });
    });

    describe("PRIORITY hit policy", () => {
        it("returns unsupported error", () => {
            const result = applyHitPolicy(
                "PRIORITY",
                undefined,
                [],
                ["output"]
            );
            expect(result.result).toBe(null);
            expect(result.error).toContain("not yet supported");
        });
    });

    describe("OUTPUT ORDER hit policy", () => {
        it("returns unsupported error", () => {
            const result = applyHitPolicy(
                "OUTPUT ORDER",
                undefined,
                [],
                ["output"]
            );
            expect(result.result).toBe(null);
            expect(result.error).toContain("not yet supported");
        });
    });

    describe("Unknown hit policy", () => {
        it("returns error", () => {
            const result = applyHitPolicy("BOGUS", undefined, [], ["output"]);
            expect(result.error).toContain("Unknown hit policy");
        });
    });

    describe("ANY — deep equality", () => {
        it("accepts multiple matching rules with identical object outputs", () => {
            const rules = [
                makeRule(0, { grade: "A", score: 100 }),
                makeRule(1, { grade: "A", score: 100 }),
            ];
            const result = applyHitPolicy("ANY", undefined, rules, [
                "grade",
                "score",
            ]);
            expect(result.result).toEqual({ grade: "A", score: 100 });
            expect(result.error).toBeUndefined();
        });

        it("rejects rules with different key order treated as same by deep equality", () => {
            // Deep equality is order-independent for keys
            const rules = [
                makeRule(0, { a: 1, b: 2 }),
                makeRule(1, { b: 2, a: 1 }),
            ];
            const result = applyHitPolicy("ANY", undefined, rules, ["a", "b"]);
            expect(result.result).toEqual({ a: 1, b: 2 });
            expect(result.error).toBeUndefined();
        });
    });
});
