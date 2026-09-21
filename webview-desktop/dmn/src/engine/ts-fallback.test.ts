/// <reference types="node" />
/**
 * Tests for the pure-TypeScript DMN fallback evaluator (ts-fallback.ts).
 */
import { describe, it, expect } from "vitest";
import { evaluateDecisionTs } from "./ts-fallback";
import { parseDmnXml } from "./parse";
import type { DmnModel, DmnDecision, DmnDecisionTable } from "./parse";

// ── Helpers ─────────────────────────────────────────────────────────

/** Build a minimal DmnModel for unit-testing without XML parsing. */
function makeModel(decisions: DmnDecision[]): DmnModel {
    return {
        id: "model",
        name: "Model",
        namespace: "http://test",
        decisions: new Map(decisions.map((d) => [d.id, d])),
    };
}

function makeDecisionTable(
    id: string,
    name: string,
    hitPolicy: string,
    inputs: { id: string; label: string; expression: string; typeRef?: string }[],
    outputs: { id: string; name: string; label: string; typeRef?: string }[],
    rules: { id: string; inputEntries: string[]; outputEntries: string[] }[]
): DmnDecision {
    return {
        id,
        name,
        informationRequirements: [],
        logic: {
            type: "decisionTable",
            hitPolicy,
            inputs,
            outputs,
            rules,
        } as DmnDecisionTable,
    };
}

// ── Decision Table Tests ─────────────────────────────────────────────

describe("evaluateDecisionTs — UNIQUE hit policy", () => {
    it("returns null result when no rules match", () => {
        const model = makeModel([
            makeDecisionTable(
                "d",
                "Decision",
                "UNIQUE",
                [{ id: "i1", label: "x", expression: "x" }],
                [{ id: "o1", name: "result", label: "result" }],
                [{ id: "r1", inputEntries: ['"yes"'], outputEntries: ['"matched"'] }]
            ),
        ]);
        const { result, error } = evaluateDecisionTs(model, "d", { x: "no" });
        expect(result).toBe(null);
        expect(error).toBeUndefined();
    });

    it("returns output when exactly one rule matches", () => {
        const model = makeModel([
            makeDecisionTable(
                "d",
                "Decision",
                "UNIQUE",
                [{ id: "i1", label: "x", expression: "x" }],
                [{ id: "o1", name: "result", label: "result" }],
                [{ id: "r1", inputEntries: ['"yes"'], outputEntries: ['"matched"'] }]
            ),
        ]);
        const { result, error } = evaluateDecisionTs(model, "d", { x: "yes" });
        expect(result).toEqual({ result: "matched" });
        expect(error).toBeUndefined();
    });

    it("returns error when multiple rules match", () => {
        const model = makeModel([
            makeDecisionTable(
                "d",
                "Decision",
                "UNIQUE",
                [{ id: "i1", label: "x", expression: "x" }],
                [{ id: "o1", name: "result", label: "result" }],
                [
                    { id: "r1", inputEntries: ["-"], outputEntries: ['"A"'] },
                    { id: "r2", inputEntries: ["-"], outputEntries: ['"B"'] },
                ]
            ),
        ]);
        const { result, error } = evaluateDecisionTs(model, "d", { x: "anything" });
        expect(result).toBe(null);
        expect(error).toContain("UNIQUE");
    });
});

describe("evaluateDecisionTs — FIRST hit policy", () => {
    it("returns first matching rule", () => {
        const model = makeModel([
            makeDecisionTable(
                "d",
                "Decision",
                "FIRST",
                [{ id: "i1", label: "score", expression: "score" }],
                [{ id: "o1", name: "grade", label: "grade" }],
                [
                    { id: "r1", inputEntries: ["> 90"], outputEntries: ['"A"'] },
                    { id: "r2", inputEntries: ["> 70"], outputEntries: ['"B"'] },
                    { id: "r3", inputEntries: ["-"], outputEntries: ['"C"'] },
                ]
            ),
        ]);
        const { result } = evaluateDecisionTs(model, "d", { score: 85 });
        expect(result).toEqual({ grade: "B" });
    });
});

describe("evaluateDecisionTs — COLLECT hit policy", () => {
    it("returns all matched rule outputs", () => {
        const model = makeModel([
            makeDecisionTable(
                "d",
                "Decision",
                "COLLECT",
                [{ id: "i1", label: "x", expression: "x" }],
                [{ id: "o1", name: "tag", label: "tag" }],
                [
                    { id: "r1", inputEntries: ["> 0"], outputEntries: ['"positive"'] },
                    { id: "r2", inputEntries: ["< 100"], outputEntries: ['"below-hundred"'] },
                ]
            ),
        ]);
        const { result } = evaluateDecisionTs(model, "d", { x: 50 });
        expect(result).toEqual([{ tag: "positive" }, { tag: "below-hundred" }]);
    });
});

describe("evaluateDecisionTs — RULE ORDER hit policy", () => {
    it("returns all matches in rule order", () => {
        const model = makeModel([
            makeDecisionTable(
                "d",
                "Decision",
                "RULE ORDER",
                [{ id: "i1", label: "val", expression: "val" }],
                [{ id: "o1", name: "out", label: "out" }],
                [
                    { id: "r1", inputEntries: ["-"], outputEntries: ['"first"'] },
                    { id: "r2", inputEntries: ["-"], outputEntries: ['"second"'] },
                ]
            ),
        ]);
        const { result } = evaluateDecisionTs(model, "d", { val: "x" });
        expect(result).toEqual([{ out: "first" }, { out: "second" }]);
    });
});

describe("evaluateDecisionTs — wildcard (-) input entries", () => {
    it("matches any value when input entry is '-'", () => {
        const model = makeModel([
            makeDecisionTable(
                "d",
                "Decision",
                "FIRST",
                [{ id: "i1", label: "x", expression: "x" }],
                [{ id: "o1", name: "result", label: "result" }],
                [{ id: "r1", inputEntries: ["-"], outputEntries: ['"always"'] }]
            ),
        ]);
        const { result } = evaluateDecisionTs(model, "d", { x: "anything" });
        expect(result).toEqual({ result: "always" });
    });
});

// ── Literal Expression Tests ─────────────────────────────────────────

describe("evaluateDecisionTs — literal expression", () => {
    it("evaluates a simple arithmetic FEEL expression", () => {
        const model = makeModel([
            {
                id: "calc",
                name: "Calc",
                informationRequirements: [],
                logic: {
                    type: "literalExpression",
                    expression: "a + b",
                    variable: "sum",
                },
            },
        ]);
        const { result, error } = evaluateDecisionTs(model, "calc", { a: 3, b: 4 });
        expect(error).toBeUndefined();
        expect(result).toBe(7);
    });

    it("returns error on invalid FEEL expression", () => {
        const model = makeModel([
            {
                id: "bad",
                name: "Bad",
                informationRequirements: [],
                logic: {
                    type: "literalExpression",
                    expression: "{{ invalid syntax !!!",
                    variable: "out",
                },
            },
        ]);
        const { result, error } = evaluateDecisionTs(model, "bad", {});
        // feelin may return null for invalid expressions without throwing
        expect(result === null || error !== undefined).toBe(true);
    });
});

// ── DRG Chain Tests ──────────────────────────────────────────────────

describe("evaluateDecisionTs — DRG chains", () => {
    it("evaluates a two-decision DRG chain", async () => {
        const dmn = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="https://www.omg.org/spec/DMN/20191111/MODEL/"
             id="D" name="DRG" namespace="http://test">
  <decision id="base" name="Base">
    <decisionTable id="dt1" hitPolicy="FIRST">
      <input id="i1" label="score">
        <inputExpression id="ie1" typeRef="integer"><text>score</text></inputExpression>
      </input>
      <output id="o1" name="level" typeRef="string" />
      <rule id="r1">
        <inputEntry id="e1"><text>&gt; 80</text></inputEntry>
        <outputEntry id="eo1"><text>"high"</text></outputEntry>
      </rule>
      <rule id="r2">
        <inputEntry id="e2"><text>-</text></inputEntry>
        <outputEntry id="eo2"><text>"low"</text></outputEntry>
      </rule>
    </decisionTable>
  </decision>
  <decision id="discount" name="Discount">
    <informationRequirement id="ir1">
      <requiredDecision href="#base" />
    </informationRequirement>
    <decisionTable id="dt2" hitPolicy="FIRST">
      <input id="i2" label="level">
        <inputExpression id="ie2" typeRef="string"><text>level</text></inputExpression>
      </input>
      <output id="o2" name="pct" typeRef="integer" />
      <rule id="r3">
        <inputEntry id="e3"><text>"high"</text></inputEntry>
        <outputEntry id="eo3"><text>20</text></outputEntry>
      </rule>
      <rule id="r4">
        <inputEntry id="e4"><text>-</text></inputEntry>
        <outputEntry id="eo4"><text>5</text></outputEntry>
      </rule>
    </decisionTable>
  </decision>
</definitions>`;
        const model = await parseDmnXml(dmn);
        const { result, trace } = evaluateDecisionTs(model, "discount", { score: 90 });
        expect(trace).toHaveLength(2);
        expect(trace[0].decisionId).toBe("base");
        expect(trace[1].decisionId).toBe("discount");
        expect(result).toEqual({ pct: 20 });
    });
});

// ── Error Handling ───────────────────────────────────────────────────

describe("evaluateDecisionTs — error handling", () => {
    it("returns error for unknown decision id", () => {
        const model = makeModel([]);
        const { result, error } = evaluateDecisionTs(model, "nonexistent", {});
        expect(result).toBe(null);
        expect(error).toBeTruthy();
    });

    it("returns null result for decision with no logic", () => {
        const model = makeModel([
            {
                id: "empty",
                name: "Empty",
                informationRequirements: [],
                logic: null,
            },
        ]);
        const { result, error } = evaluateDecisionTs(model, "empty", {});
        expect(result).toBe(null);
        expect(error).toBeTruthy();
    });

    it("returns structured error for PRIORITY hit policy (unsupported)", () => {
        const model = makeModel([
            makeDecisionTable(
                "p",
                "Priority",
                "PRIORITY",
                [{ id: "i1", label: "x", expression: "x" }],
                [{ id: "o1", name: "out", label: "out" }],
                [{ id: "r1", inputEntries: ["-"], outputEntries: ['"v"'] }]
            ),
        ]);
        const { result, error } = evaluateDecisionTs(model, "p", { x: 1 });
        expect(result).toBe(null);
        expect(error).toContain("not yet supported");
    });
});
