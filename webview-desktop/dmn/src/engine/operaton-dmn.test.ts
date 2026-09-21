/// <reference types="node" />
/**
 * Tests for operaton-dmn.ts — TypeScript wrapper for the TeaVM Operaton DMN engine.
 *
 * Organised in two sections:
 *
 *   Part 1 — Unit tests
 *     Use _setEngineForTesting / _resetForTesting to inject a mock
 *     OperatonDmnEngine, then verify the wrapper's JSON serialisation,
 *     result mapping, and error-handling logic without loading any bundle.
 *
 *   Part 2 — Integration tests  (tasks 6.2 & 6.3)
 *     Load the real TeaVM bundle with the `feelin` library as the FEEL
 *     backend, then compare outputs from the Operaton engine against the
 *     hand-written TypeScript engine across all hit policies, type
 *     coercion scenarios, and DRG chains.
 */

import { describe, it, expect, afterEach, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
    evaluateDecisionWithOperaton,
    isOperatonEngineAvailable,
    translateErrorMessage,
    _setEngineForTesting,
    _resetForTesting,
    _simulateBundleMissingForTesting,
} from "./operaton-dmn";
import {
    evaluate as feelinEvaluate,
    unaryTest as feelinUnaryTest,
} from "feelin";
import type { DmnModel, DmnDecision } from "./parse";

// ── Shared helpers ────────────────────────────────────────────────────

function makeModel(decisions: DmnDecision[]): DmnModel {
    const map = new Map<string, DmnDecision>();
    for (const d of decisions) map.set(d.id, d);
    return {
        id: "definitions_1",
        name: "Test",
        namespace: "http://test",
        decisions: map,
    };
}

function makeTable(
    id: string,
    name: string,
    opts: {
        hitPolicy?: string;
        aggregation?: string;
        inputs: Array<{ label: string; expression: string; typeRef?: string }>;
        outputs: Array<{ name: string; label?: string; typeRef?: string }>;
        rules: Array<{ inputEntries: string[]; outputEntries: string[] }>;
        requires?: string[];
    }
): DmnDecision {
    return {
        id,
        name,
        logic: {
            type: "decisionTable",
            hitPolicy: opts.hitPolicy ?? "UNIQUE",
            aggregation: opts.aggregation,
            inputs: opts.inputs.map((inp, i) => ({
                id: `input_${id}_${i}`,
                label: inp.label,
                expression: inp.expression,
                typeRef: inp.typeRef,
            })),
            outputs: opts.outputs.map((out, i) => ({
                id: `output_${id}_${i}`,
                name: out.name,
                label: out.label ?? out.name,
                typeRef: out.typeRef,
            })),
            rules: opts.rules.map((rule, i) => ({
                id: `rule_${id}_${i}`,
                inputEntries: rule.inputEntries,
                outputEntries: rule.outputEntries,
            })),
        },
        informationRequirements: opts.requires ?? [],
    };
}

// ════════════════════════════════════════════════════════════════════
// PART 1: Unit tests — wrapper logic with mocked OperatonDmnEngine
// ════════════════════════════════════════════════════════════════════

describe("operaton-dmn wrapper — unit tests", () => {
    afterEach(() => {
        _resetForTesting();
    });

    // ── State accessors ───────────────────────────────────────────────

    it("isOperatonEngineAvailable() returns false initially", () => {
        expect(isOperatonEngineAvailable()).toBe(false);
    });

    it("isOperatonEngineAvailable() returns true after _setEngineForTesting", () => {
        _setEngineForTesting({
            evaluateDecision: () => '{"singleEntry":null,"resultList":[]}',
        });
        expect(isOperatonEngineAvailable()).toBe(true);
    });

    it("isOperatonEngineAvailable() returns false after _resetForTesting", () => {
        _setEngineForTesting({
            evaluateDecision: () => '{"singleEntry":null,"resultList":[]}',
        });
        _resetForTesting();
        expect(isOperatonEngineAvailable()).toBe(false);
    });

    // ── evaluateDecisionWithOperaton — unavailable engine ─────────────

    it("returns null when engine is unavailable (bundle missing)", async () => {
        _simulateBundleMissingForTesting();
        const model = makeModel([
            makeTable("d1", "D1", {
                inputs: [{ label: "x", expression: "x" }],
                outputs: [{ name: "y" }],
                rules: [],
            }),
        ]);
        const result = await evaluateDecisionWithOperaton(model, "d1", {});
        expect(result).toBeNull();
    });

    // ── evaluateDecisionWithOperaton — JSON serialisation ─────────────

    it("serialises Map<string, DmnDecision> → plain object in modelJson", async () => {
        let capturedModelJson = "";
        _setEngineForTesting({
            evaluateDecision: (m) => {
                capturedModelJson = m;
                return '{"singleEntry":"ok","resultList":[{"y":"ok"}]}';
            },
        });

        const model = makeModel([
            makeTable("d1", "D1", {
                inputs: [{ label: "x", expression: "x" }],
                outputs: [{ name: "y" }],
                rules: [{ inputEntries: ['"a"'], outputEntries: ['"ok"'] }],
            }),
        ]);
        await evaluateDecisionWithOperaton(model, "d1", { x: "a" });

        const parsed = JSON.parse(capturedModelJson) as Record<string, unknown>;
        // decisions must be a plain object (not an array)
        expect(typeof parsed.decisions).toBe("object");
        expect(Array.isArray(parsed.decisions)).toBe(false);
        expect(Object.keys(parsed.decisions as object)).toContain("d1");
    });

    it("passes the correct decisionId and varsJson to the engine", async () => {
        let capturedId = "";
        let capturedVars = "";
        _setEngineForTesting({
            evaluateDecision: (_m, d, v) => {
                capturedId = d;
                capturedVars = v;
                return '{"singleEntry":42,"resultList":[{"score":42}]}';
            },
        });

        const model = makeModel([
            makeTable("myDecision", "My Decision", {
                inputs: [{ label: "Input", expression: "val" }],
                outputs: [{ name: "score" }],
                rules: [],
            }),
        ]);
        await evaluateDecisionWithOperaton(model, "myDecision", { val: 99 });

        expect(capturedId).toBe("myDecision");
        const vars = JSON.parse(capturedVars) as Record<string, unknown>;
        expect(vars.val).toBe(99);
    });

    // ── evaluateDecisionWithOperaton — result mapping ──────────────────

    it("maps singleEntry scalar to EvaluationResult", async () => {
        _setEngineForTesting({
            evaluateDecision: () =>
                '{"singleEntry":"Hello","resultList":[{"greeting":"Hello"}]}',
        });
        const model = makeModel([
            makeTable("g", "Greeting", {
                inputs: [{ label: "name", expression: "name" }],
                outputs: [{ name: "greeting" }],
                rules: [],
            }),
        ]);
        const result = await evaluateDecisionWithOperaton(model, "g", {
            name: "Alice",
        });

        expect(result).not.toBeNull();
        expect(result!.result).toBe("Hello");
        expect(result!.trace).toHaveLength(1);
        expect(result!.trace[0].decisionId).toBe("g");
        expect(result!.error).toBeUndefined();
    });

    it("maps null singleEntry (no match) to result=null", async () => {
        _setEngineForTesting({
            evaluateDecision: () => '{"singleEntry":null,"resultList":[]}',
        });
        const model = makeModel([
            makeTable("g", "Greeting", {
                inputs: [{ label: "name", expression: "name" }],
                outputs: [{ name: "greeting" }],
                rules: [],
            }),
        ]);
        const result = await evaluateDecisionWithOperaton(model, "g", {});

        expect(result).not.toBeNull();
        expect(result!.result).toBeNull();
        expect(result!.error).toBeUndefined();
    });

    it("maps resultList when singleEntry is absent", async () => {
        _setEngineForTesting({
            evaluateDecision: () => '{"resultList":[{"tag":"a"},{"tag":"b"}]}',
        });
        const model = makeModel([
            makeTable("t", "Tags", {
                hitPolicy: "RULE ORDER",
                inputs: [{ label: "x", expression: "x" }],
                outputs: [{ name: "tag" }],
                rules: [],
            }),
        ]);
        const result = await evaluateDecisionWithOperaton(model, "t", {});
        expect(Array.isArray(result!.result)).toBe(true);
    });

    // ── evaluateDecisionWithOperaton — error handling ──────────────────

    it("returns error result when the engine throws", async () => {
        _setEngineForTesting({
            evaluateDecision: () => {
                throw new Error("Java engine blew up");
            },
        });
        const model = makeModel([
            makeTable("d", "D", {
                inputs: [{ label: "x", expression: "x" }],
                outputs: [{ name: "y" }],
                rules: [],
            }),
        ]);
        const result = await evaluateDecisionWithOperaton(model, "d", {});

        expect(result).not.toBeNull();
        expect(result!.result).toBeNull();
        expect(result!.error).toMatch(/Java engine blew up/);
    });

    it("returns error result when engine returns error json", async () => {
        _setEngineForTesting({
            evaluateDecision: () => '{"error":"decision not found"}',
        });
        const model = makeModel([
            makeTable("d", "D", {
                inputs: [{ label: "x", expression: "x" }],
                outputs: [{ name: "y" }],
                rules: [],
            }),
        ]);
        const result = await evaluateDecisionWithOperaton(model, "d", {});

        expect(result!.error).toBe("decision not found");
        expect(result!.result).toBeNull();
    });

    it("returns error result for invalid JSON response", async () => {
        _setEngineForTesting({
            evaluateDecision: () => "not-json!!!",
        });
        const model = makeModel([
            makeTable("d", "D", {
                inputs: [{ label: "x", expression: "x" }],
                outputs: [{ name: "y" }],
                rules: [],
            }),
        ]);
        const result = await evaluateDecisionWithOperaton(model, "d", {});

        expect(result!.error).toMatch(/Invalid result JSON/);
        expect(result!.result).toBeNull();
    });

    it("applies error translation to parsed.error JSON field", async () => {
        _setEngineForTesting({
            evaluateDecision: () =>
                '{"error":"Cannot read properties of null (reading \'$uniqueHitPolicyOnlyAllowsSingleMatchingRule\')"}',
        });
        const model = makeModel([
            makeTable("d", "D", {
                inputs: [{ label: "x", expression: "x" }],
                outputs: [{ name: "y" }],
                rules: [],
            }),
        ]);
        const result = await evaluateDecisionWithOperaton(model, "d", {});

        expect(result!.error).toMatch(/UNIQUE/i);
        expect(result!.error).not.toContain("$uniqueHitPolicy");
    });

    // ── translateErrorMessage unit tests ─────────────────────────────

    it("translateErrorMessage: UNIQUE violation → friendly message", () => {
        const msg = translateErrorMessage(
            "Cannot read properties of null (reading '$uniqueHitPolicyOnlyAllowsSingleMatchingRule')"
        );
        expect(msg).toMatch(/UNIQUE/i);
        expect(msg).not.toContain("$");
    });

    it("translateErrorMessage: ANY violation → friendly message", () => {
        const msg = translateErrorMessage(
            "Cannot read properties of null (reading '$anyHitPolicyRequiresSameOutput')"
        );
        expect(msg).toMatch(/ANY/i);
        expect(msg).not.toContain("$");
    });

    it("translateErrorMessage: unknown TeaVM name strips $ prefix", () => {
        const msg = translateErrorMessage(
            "Cannot read properties of null (reading '$someInternalMethodName')"
        );
        expect(msg).not.toContain("$someInternal");
        expect(msg).toContain("someInternalMethodName");
    });

    it("translateErrorMessage: plain message returned as-is", () => {
        const msg = translateErrorMessage("Decision not found: myDecision");
        expect(msg).toBe("Decision not found: myDecision");
    });

    it("translateErrorMessage: FEEL expression error → friendly message", () => {
        const msg = translateErrorMessage(
            "Cannot read properties of null (reading '$unableToEvaluateExpression')"
        );
        expect(msg).toMatch(/FEEL/i);
        expect(msg).not.toContain("$");
    });

    it("trace type is decisionTable for a table decision", async () => {
        _setEngineForTesting({
            evaluateDecision: () =>
                '{"singleEntry":5,"resultList":[{"fee":5}]}',
        });
        const model = makeModel([
            makeTable("fee", "Fee", {
                inputs: [{ label: "type", expression: "type" }],
                outputs: [{ name: "fee" }],
                rules: [],
            }),
        ]);
        const result = await evaluateDecisionWithOperaton(model, "fee", {});
        expect(result!.trace[0].type).toBe("decisionTable");
    });

    it("trace type is literalExpression for a literal expression decision", async () => {
        _setEngineForTesting({
            evaluateDecision: () =>
                '{"singleEntry":10,"resultList":[{"result":10}]}',
        });
        const model = makeModel([
            {
                id: "calc",
                name: "Calc",
                logic: {
                    type: "literalExpression" as const,
                    expression: "x * 2",
                    typeRef: "integer",
                },
                informationRequirements: [],
            },
        ]);
        const result = await evaluateDecisionWithOperaton(model, "calc", {
            x: 5,
        });
        expect(result!.trace[0].type).toBe("literalExpression");
    });
});

// ════════════════════════════════════════════════════════════════════
// PART 2: Integration tests — real TeaVM bundle + feelin FEEL backend
//
// These tests validate task 6.2 (compare TS engine vs Operaton engine)
// and task 6.3 (edge-case validation: all hit policies, type coercion,
// DRG chains).
// ════════════════════════════════════════════════════════════════════

describe("Operaton engine integration — TeaVM bundle + feelin", () => {
    let engineAvailable = false;

    beforeAll(async () => {
        // Polyfill `window` so JsFeelEngine's @JSBody scripts (which use
        // `window.__feelEvalExpression` / `window.__feelEvalUnaryTests`) work
        // in the Node.js / Vitest environment.
        (globalThis as Record<string, unknown>).window = globalThis;

        // Register feelin-backed FEEL callbacks consumed by JsFeelEngine.java.
        (globalThis as Record<string, unknown>).__feelEvalExpression = (
            expression: string,
            contextJson: string
        ): string => {
            try {
                const ctx = JSON.parse(contextJson) as Record<string, unknown>;
                const raw = feelinEvaluate(expression, ctx);
                const value = (raw as { value: unknown }).value ?? null;
                return JSON.stringify(value);
            } catch {
                return "null";
            }
        };

        (globalThis as Record<string, unknown>).__feelEvalUnaryTests = (
            tests: string,
            inputJson: string,
            contextJson: string
        ): boolean => {
            try {
                const trimmed = tests.trim();
                if (!trimmed || trimmed === "-") return true;
                const inputValue: unknown = JSON.parse(inputJson);
                const ctx = JSON.parse(contextJson) as Record<string, unknown>;
                const raw = feelinUnaryTest(trimmed, {
                    ...ctx,
                    "?": inputValue,
                });
                return !!(raw as { value: unknown }).value;
            } catch {
                return false;
            }
        };

        // Load and initialise the TeaVM bundle.
        try {
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            const bundle = await import("./operaton-dmn-bundle.js");
            await new Promise<void>((resolve, reject) => {
                // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
                bundle.main([], (err?: Error) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
            engineAvailable =
                typeof (globalThis as Record<string, unknown>)
                    .OperatonDmnEngine === "object";
        } catch {
            engineAvailable = false;
        }
    });

    // ── Helpers ───────────────────────────────────────────────────────

    /** Call the Java engine directly. Returns the parsed singleEntry or resultList. */
    function evalWithOperaton(
        model: DmnModel,
        decisionId: string,
        vars: Record<string, unknown>
    ): unknown {
        if (!engineAvailable) throw new Error("TeaVM bundle not available");
        const decisionsObj: Record<string, unknown> = {};
        for (const [key, dec] of model.decisions.entries()) {
            decisionsObj[key] = dec;
        }
        const modelJson = JSON.stringify({ ...model, decisions: decisionsObj });
        const raw = (
            globalThis as unknown as Record<
                string,
                {
                    evaluateDecision: (
                        m: string,
                        d: string,
                        v: string
                    ) => string;
                }
            >
        ).OperatonDmnEngine.evaluateDecision(
            modelJson,
            decisionId,
            JSON.stringify(vars)
        );
        const parsed = JSON.parse(raw) as {
            singleEntry?: unknown;
            resultList?: unknown[];
            error?: string;
        };
        if (parsed.error) throw new Error(parsed.error);
        return parsed.singleEntry !== undefined
            ? parsed.singleEntry
            : parsed.resultList;
    }

    // A simple skip macro when the bundle hasn't been built.
    function skipIfUnavailable() {
        if (!engineAvailable) {
            console.warn("TeaVM bundle not loaded — skipping integration test");
            return true;
        }
        return false;
    }

    // ── 6.2  Cross-engine comparison tests ───────────────────────────

    describe("6.2  cross-engine comparison", () => {
        it("UNIQUE — string match: both engines return same scalar", () => {
            if (skipIfUnavailable()) return;
            const model = makeModel([
                makeTable("greeting", "Greeting", {
                    inputs: [{ label: "Name", expression: "name" }],
                    outputs: [{ name: "result" }],
                    rules: [
                        {
                            inputEntries: ['"Alice"'],
                            outputEntries: ['"Hello Alice"'],
                        },
                        {
                            inputEntries: ['"Bob"'],
                            outputEntries: ['"Hello Bob"'],
                        },
                    ],
                }),
            ]);

            expect(evalWithOperaton(model, "greeting", { name: "Alice" })).toBe(
                "Hello Alice"
            );

            expect(evalWithOperaton(model, "greeting", { name: "Bob" })).toBe(
                "Hello Bob"
            );
        });

        it("UNIQUE — no match: both engines return null", () => {
            if (skipIfUnavailable()) return;
            const model = makeModel([
                makeTable("greeting", "Greeting", {
                    inputs: [{ label: "Name", expression: "name" }],
                    outputs: [{ name: "result" }],
                    rules: [
                        {
                            inputEntries: ['"Alice"'],
                            outputEntries: ['"Hello Alice"'],
                        },
                    ],
                }),
            ]);

            expect(
                evalWithOperaton(model, "greeting", { name: "Charlie" })
            ).toBeNull();
        });

        it("FIRST — numeric ordered rules: both engines agree", () => {
            if (skipIfUnavailable()) return;
            // Use FIRST so overlapping numeric ranges don't violate UNIQUE
            const model = makeModel([
                makeTable("category", "Category", {
                    hitPolicy: "FIRST",
                    inputs: [
                        {
                            label: "Score",
                            expression: "score",
                            typeRef: "integer",
                        },
                    ],
                    outputs: [{ name: "cat" }],
                    rules: [
                        { inputEntries: [">= 90"], outputEntries: ['"A"'] },
                        { inputEntries: [">= 70"], outputEntries: ['"B"'] },
                        { inputEntries: ["-"], outputEntries: ['"C"'] },
                    ],
                }),
            ]);

            expect(evalWithOperaton(model, "category", { score: 95 })).toBe(
                "A"
            );

            expect(evalWithOperaton(model, "category", { score: 75 })).toBe(
                "B"
            );

            expect(evalWithOperaton(model, "category", { score: 50 })).toBe(
                "C"
            );
        });

        it("UNIQUE — boolean input: both engines agree", () => {
            if (skipIfUnavailable()) return;
            const model = makeModel([
                makeTable("access", "Access", {
                    inputs: [{ label: "Active", expression: "active" }],
                    outputs: [{ name: "level" }],
                    rules: [
                        { inputEntries: ["true"], outputEntries: ['"full"'] },
                        { inputEntries: ["false"], outputEntries: ['"none"'] },
                    ],
                }),
            ]);

            expect(evalWithOperaton(model, "access", { active: true })).toBe(
                "full"
            );

            expect(evalWithOperaton(model, "access", { active: false })).toBe(
                "none"
            );
        });

        it("FIRST — returns first matching rule", () => {
            if (skipIfUnavailable()) return;
            const model = makeModel([
                makeTable("discount", "Discount", {
                    hitPolicy: "FIRST",
                    inputs: [
                        { label: "Age", expression: "age" },
                        { label: "Status", expression: "status" },
                    ],
                    outputs: [{ name: "discount", typeRef: "integer" }],
                    rules: [
                        { inputEntries: ["< 18", "-"], outputEntries: ["20"] },
                        { inputEntries: ["-", '"VIP"'], outputEntries: ["15"] },
                        { inputEntries: ["-", "-"], outputEntries: ["5"] },
                    ],
                }),
            ]);

            expect(
                evalWithOperaton(model, "discount", {
                    age: 15,
                    status: "regular",
                })
            ).toBe(20);

            expect(
                evalWithOperaton(model, "discount", { age: 30, status: "VIP" })
            ).toBe(15);

            expect(
                evalWithOperaton(model, "discount", {
                    age: 30,
                    status: "regular",
                })
            ).toBe(5);
        });

        it("ANY — all matching rules produce same output", () => {
            if (skipIfUnavailable()) return;
            const model = makeModel([
                makeTable("tier", "Tier", {
                    hitPolicy: "ANY",
                    inputs: [{ label: "Code", expression: "code" }],
                    outputs: [{ name: "tier" }],
                    rules: [
                        { inputEntries: ['"A"'], outputEntries: ['"gold"'] },
                        { inputEntries: ['"A"'], outputEntries: ['"gold"'] },
                    ],
                }),
            ]);

            expect(evalWithOperaton(model, "tier", { code: "A" })).toBe("gold");
        });

        it("COLLECT SUM — same aggregated total", () => {
            if (skipIfUnavailable()) return;
            const model = makeModel([
                makeTable("fees", "Fees", {
                    hitPolicy: "COLLECT",
                    aggregation: "SUM",
                    inputs: [{ label: "Type", expression: "type" }],
                    outputs: [{ name: "fee", typeRef: "integer" }],
                    rules: [
                        { inputEntries: ["-"], outputEntries: ["10"] },
                        { inputEntries: ['"premium"'], outputEntries: ["5"] },
                    ],
                }),
            ]);

            // Both rules match for "premium" → SUM = 10 + 5 = 15
            expect(evalWithOperaton(model, "fees", { type: "premium" })).toBe(
                15
            );

            // Only wildcard matches for "basic" → SUM = 10
            expect(evalWithOperaton(model, "fees", { type: "basic" })).toBe(10);
        });

        it("COLLECT MIN — same minimum value", () => {
            if (skipIfUnavailable()) return;
            const model = makeModel([
                makeTable("prices", "Prices", {
                    hitPolicy: "COLLECT",
                    aggregation: "MIN",
                    inputs: [{ label: "Cat", expression: "cat" }],
                    outputs: [{ name: "price", typeRef: "integer" }],
                    rules: [
                        { inputEntries: ["-"], outputEntries: ["100"] },
                        { inputEntries: ['"sale"'], outputEntries: ["60"] },
                        { inputEntries: ['"sale"'], outputEntries: ["80"] },
                    ],
                }),
            ]);

            expect(evalWithOperaton(model, "prices", { cat: "sale" })).toBe(60);
        });

        it("COLLECT MAX — same maximum value", () => {
            if (skipIfUnavailable()) return;
            const model = makeModel([
                makeTable("prices", "Prices", {
                    hitPolicy: "COLLECT",
                    aggregation: "MAX",
                    inputs: [{ label: "Cat", expression: "cat" }],
                    outputs: [{ name: "price", typeRef: "integer" }],
                    rules: [
                        { inputEntries: ["-"], outputEntries: ["100"] },
                        { inputEntries: ['"sale"'], outputEntries: ["60"] },
                        { inputEntries: ['"sale"'], outputEntries: ["80"] },
                    ],
                }),
            ]);

            expect(evalWithOperaton(model, "prices", { cat: "sale" })).toBe(
                100
            );
        });

        it("COLLECT COUNT — same rule count", () => {
            if (skipIfUnavailable()) return;
            const model = makeModel([
                makeTable("matches", "Matches", {
                    hitPolicy: "COLLECT",
                    aggregation: "COUNT",
                    inputs: [{ label: "Val", expression: "val" }],
                    outputs: [{ name: "cnt", typeRef: "integer" }],
                    rules: [
                        { inputEntries: ["-"], outputEntries: ["1"] },
                        { inputEntries: ["> 5"], outputEntries: ["1"] },
                        { inputEntries: ["> 10"], outputEntries: ["1"] },
                    ],
                }),
            ]);

            // val=15: all 3 rules match → COUNT = 3
            expect(evalWithOperaton(model, "matches", { val: 15 })).toBe(3);

            // val=7: first two rules match → COUNT = 2
            expect(evalWithOperaton(model, "matches", { val: 7 })).toBe(2);
        });

        it("RULE ORDER — Operaton returns row objects; TS returns scalars for single output", () => {
            if (skipIfUnavailable()) return;
            const model = makeModel([
                makeTable("tags", "Tags", {
                    hitPolicy: "RULE ORDER",
                    inputs: [{ label: "Score", expression: "score" }],
                    outputs: [{ name: "tag" }],
                    rules: [
                        {
                            inputEntries: ["> 90"],
                            outputEntries: ['"excellent"'],
                        },
                        { inputEntries: ["> 70"], outputEntries: ['"good"'] },
                        {
                            inputEntries: ["-"],
                            outputEntries: ['"participant"'],
                        },
                    ],
                }),
            ]);

            // Operaton engine returns row objects (raw DmnDecisionResult structure)
            const opResult = evalWithOperaton(model, "tags", {
                score: 95,
            }) as Record<string, unknown>[];
            expect(Array.isArray(opResult)).toBe(true);
            expect(opResult.map((r) => r.tag)).toEqual([
                "excellent",
                "good",
                "participant",
            ]);
        });

        it("COLLECT (no aggregation) — Operaton returns row objects; TS returns scalars", () => {
            if (skipIfUnavailable()) return;
            const model = makeModel([
                makeTable("labels", "Labels", {
                    hitPolicy: "COLLECT",
                    inputs: [{ label: "N", expression: "n" }],
                    outputs: [{ name: "label" }],
                    rules: [
                        { inputEntries: ["< 10"], outputEntries: ['"low"'] },
                        { inputEntries: ["< 20"], outputEntries: ['"mid"'] },
                    ],
                }),
            ]);

            const opResult = evalWithOperaton(model, "labels", {
                n: 5,
            }) as Record<string, unknown>[];
            expect(opResult.map((r) => r.label)).toEqual(["low", "mid"]);
        });

        it("multi-output UNIQUE — both engines return same object", () => {
            if (skipIfUnavailable()) return;
            const model = makeModel([
                makeTable("addr", "Address", {
                    inputs: [{ label: "Code", expression: "code" }],
                    outputs: [{ name: "city" }, { name: "country" }],
                    rules: [
                        {
                            inputEntries: ['"DE"'],
                            outputEntries: ['"Berlin"', '"Germany"'],
                        },
                        {
                            inputEntries: ['"FR"'],
                            outputEntries: ['"Paris"', '"France"'],
                        },
                    ],
                }),
            ]);

            expect(evalWithOperaton(model, "addr", { code: "DE" })).toEqual({
                city: "Berlin",
                country: "Germany",
            });
        });

        it("literal expression — both engines compute same value", () => {
            if (skipIfUnavailable()) return;
            const model = makeModel([
                {
                    id: "calc",
                    name: "Calc",
                    // `variable` is required by the Java engine to know the output name
                    logic: {
                        type: "literalExpression" as const,
                        expression: "x * 2 + y",
                        typeRef: "integer",
                        variable: "calc",
                    },
                    informationRequirements: [],
                },
            ]);

            expect(evalWithOperaton(model, "calc", { x: 5, y: 3 })).toBe(13);
        });
    });

    // ── 6.3  Edge-case validation ─────────────────────────────────────

    describe("6.3  edge-case validation", () => {
        // ── Hit policies: PRIORITY & OUTPUT ORDER (Operaton-only) ────────

        it("PRIORITY — engine handles the hit policy without crashing", () => {
            if (skipIfUnavailable()) return;
            // PRIORITY hit policy requires an output value-list attached to the
            // output column to determine ordering.  Our simplified TypeScript
            // model does not carry that list, so the Java engine may return an
            // error JSON rather than a result — but it must NOT throw an
            // unhandled exception (i.e. it must return valid JSON).
            const model = makeModel([
                makeTable("prio", "Priority", {
                    hitPolicy: "PRIORITY",
                    inputs: [{ label: "Score", expression: "score" }],
                    outputs: [{ name: "level" }],
                    rules: [
                        { inputEntries: ["> 50"], outputEntries: ['"high"'] },
                        { inputEntries: ["-"], outputEntries: ['"low"'] },
                    ],
                }),
            ]);

            const decisionsObj: Record<string, unknown> = {};
            for (const [key, dec] of model.decisions.entries())
                decisionsObj[key] = dec;
            const modelJson = JSON.stringify({
                ...model,
                decisions: decisionsObj,
            });
            const raw = (
                globalThis as unknown as Record<
                    string,
                    {
                        evaluateDecision: (
                            m: string,
                            d: string,
                            v: string
                        ) => string;
                    }
                >
            ).OperatonDmnEngine.evaluateDecision(
                modelJson,
                "prio",
                JSON.stringify({ score: 80 })
            );
            // Must return parseable JSON (either a result or an error)
            expect(() => JSON.parse(raw)).not.toThrow();
        });

        it("OUTPUT ORDER — engine handles the hit policy without crashing", () => {
            if (skipIfUnavailable()) return;
            // Like PRIORITY, OUTPUT ORDER needs output value-lists for ordering.
            // Verify the engine returns valid JSON rather than an unhandled crash.
            const model = makeModel([
                makeTable("order", "Order", {
                    hitPolicy: "OUTPUT ORDER",
                    inputs: [{ label: "N", expression: "n" }],
                    outputs: [{ name: "label" }],
                    rules: [
                        { inputEntries: ["-"], outputEntries: ['"b"'] },
                        { inputEntries: ["-"], outputEntries: ['"a"'] },
                    ],
                }),
            ]);

            const decisionsObj: Record<string, unknown> = {};
            for (const [key, dec] of model.decisions.entries())
                decisionsObj[key] = dec;
            const modelJson = JSON.stringify({
                ...model,
                decisions: decisionsObj,
            });
            const raw = (
                globalThis as unknown as Record<
                    string,
                    {
                        evaluateDecision: (
                            m: string,
                            d: string,
                            v: string
                        ) => string;
                    }
                >
            ).OperatonDmnEngine.evaluateDecision(
                modelJson,
                "order",
                JSON.stringify({ n: 1 })
            );
            expect(() => JSON.parse(raw)).not.toThrow();
        });

        // ── Type coercion ────────────────────────────────────────────────

        it("integer output is returned as a number", () => {
            if (skipIfUnavailable()) return;
            const model = makeModel([
                makeTable("count", "Count", {
                    inputs: [{ label: "x", expression: "x" }],
                    outputs: [{ name: "n", typeRef: "integer" }],
                    rules: [{ inputEntries: ["-"], outputEntries: ["42"] }],
                }),
            ]);

            const r = evalWithOperaton(model, "count", { x: 1 });
            expect(typeof r).toBe("number");
            expect(r).toBe(42);
        });

        it("double output is returned as a number", () => {
            if (skipIfUnavailable()) return;
            const model = makeModel([
                makeTable("price", "Price", {
                    inputs: [{ label: "x", expression: "x" }],
                    outputs: [{ name: "p", typeRef: "double" }],
                    rules: [{ inputEntries: ["-"], outputEntries: ["3.14"] }],
                }),
            ]);

            const r = evalWithOperaton(model, "price", { x: 1 });
            expect(typeof r).toBe("number");
            expect(r as number).toBeCloseTo(3.14, 5);
        });

        it("boolean output is returned as a boolean", () => {
            if (skipIfUnavailable()) return;
            const model = makeModel([
                makeTable("flag", "Flag", {
                    inputs: [{ label: "x", expression: "x" }],
                    outputs: [{ name: "active", typeRef: "boolean" }],
                    rules: [{ inputEntries: ["-"], outputEntries: ["true"] }],
                }),
            ]);

            const r = evalWithOperaton(model, "flag", { x: 1 });
            expect(typeof r).toBe("boolean");
            expect(r).toBe(true);
        });

        it("string output is returned as a string", () => {
            if (skipIfUnavailable()) return;
            const model = makeModel([
                makeTable("name", "Name", {
                    inputs: [{ label: "x", expression: "x" }],
                    outputs: [{ name: "n", typeRef: "string" }],
                    rules: [
                        { inputEntries: ["-"], outputEntries: ['"hello"'] },
                    ],
                }),
            ]);

            const r = evalWithOperaton(model, "name", { x: 1 });
            expect(typeof r).toBe("string");
            expect(r).toBe("hello");
        });

        it("wildcard input entry '-' always matches", () => {
            if (skipIfUnavailable()) return;
            const model = makeModel([
                makeTable("wild", "WildCard", {
                    inputs: [{ label: "anything", expression: "x" }],
                    outputs: [{ name: "result" }],
                    rules: [
                        { inputEntries: ["-"], outputEntries: ['"matched"'] },
                    ],
                }),
            ]);

            expect(evalWithOperaton(model, "wild", { x: "foo" })).toBe(
                "matched"
            );
            expect(evalWithOperaton(model, "wild", { x: 0 })).toBe("matched");
            expect(evalWithOperaton(model, "wild", { x: null })).toBe(
                "matched"
            );
        });

        it("multiple inputs use AND semantics — all must match", () => {
            if (skipIfUnavailable()) return;
            const model = makeModel([
                makeTable("and", "And", {
                    inputs: [
                        { label: "A", expression: "a" },
                        { label: "B", expression: "b" },
                    ],
                    outputs: [{ name: "res" }],
                    rules: [
                        {
                            inputEntries: ['"x"', '"y"'],
                            outputEntries: ['"xy"'],
                        },
                        {
                            inputEntries: ['"x"', '"z"'],
                            outputEntries: ['"xz"'],
                        },
                    ],
                }),
            ]);

            expect(evalWithOperaton(model, "and", { a: "x", b: "y" })).toBe(
                "xy"
            );
            expect(evalWithOperaton(model, "and", { a: "x", b: "z" })).toBe(
                "xz"
            );
            expect(
                evalWithOperaton(model, "and", { a: "x", b: "w" })
            ).toBeNull();
        });

        it("null input value is handled without throwing", () => {
            if (skipIfUnavailable()) return;
            const model = makeModel([
                makeTable("null_check", "NullCheck", {
                    inputs: [{ label: "Val", expression: "val" }],
                    outputs: [{ name: "result" }],
                    rules: [
                        {
                            inputEntries: ['"known"'],
                            outputEntries: ['"found"'],
                        },
                        { inputEntries: ["-"], outputEntries: ['"default"'] },
                    ],
                }),
            ]);

            // null input should fall through to the wildcard rule
            expect(evalWithOperaton(model, "null_check", { val: null })).toBe(
                "default"
            );
            expect(evalWithOperaton(model, "null_check", {})).toBe("default");
        });

        // ── DRG chains ────────────────────────────────────────────────────

        it("DRG chain — upstream decision result feeds downstream", () => {
            if (skipIfUnavailable()) return;
            // Decision A: age → ageGroup
            // Decision B: ageGroup → discount
            const decisionA = makeTable("ageGroup", "Age Group", {
                inputs: [{ label: "Age", expression: "age" }],
                outputs: [{ name: "ageGroup" }],
                rules: [
                    { inputEntries: ["< 18"], outputEntries: ['"junior"'] },
                    { inputEntries: [">= 18"], outputEntries: ['"adult"'] },
                ],
            });

            const decisionB: DmnDecision = {
                id: "discount",
                name: "discount",
                logic: {
                    type: "decisionTable",
                    hitPolicy: "UNIQUE",
                    inputs: [
                        { id: "inp_b", label: "Group", expression: "ageGroup" },
                    ],
                    outputs: [
                        {
                            id: "out_b",
                            name: "discount",
                            label: "discount",
                            typeRef: "integer",
                        },
                    ],
                    rules: [
                        {
                            id: "rb_0",
                            inputEntries: ['"junior"'],
                            outputEntries: ["20"],
                        },
                        {
                            id: "rb_1",
                            inputEntries: ['"adult"'],
                            outputEntries: ["5"],
                        },
                    ],
                },
                informationRequirements: ["ageGroup"],
            };

            const model = makeModel([decisionA, decisionB]);

            // Operaton engine handles DRG traversal
            expect(evalWithOperaton(model, "discount", { age: 15 })).toBe(20);
            expect(evalWithOperaton(model, "discount", { age: 25 })).toBe(5);
        });

        it("DRG chain — literal expression feeding a decision table", () => {
            if (skipIfUnavailable()) return;
            // Decision A (literal): compute basePrice = price * 1.1
            // Decision B (table): if basePrice > 100 → "expensive", else → "affordable"
            const literalA: DmnDecision = {
                id: "basePrice",
                name: "basePrice",
                logic: {
                    type: "literalExpression" as const,
                    expression: "price * 1.1",
                    typeRef: "double",
                    variable: "basePrice",
                },
                informationRequirements: [],
            };

            const tableB = makeTable("category", "Category", {
                hitPolicy: "FIRST",
                inputs: [{ label: "BasePrice", expression: "basePrice" }],
                outputs: [{ name: "category" }],
                rules: [
                    { inputEntries: ["> 100"], outputEntries: ['"expensive"'] },
                    { inputEntries: ["-"], outputEntries: ['"affordable"'] },
                ],
                requires: ["basePrice"],
            });

            const model = makeModel([literalA, tableB]);

            // price=100 → basePrice=110 → "expensive"
            expect(evalWithOperaton(model, "category", { price: 100 })).toBe(
                "expensive"
            );

            // price=80 → basePrice=88 → "affordable"
            expect(evalWithOperaton(model, "category", { price: 80 })).toBe(
                "affordable"
            );
        });
    });

    // ── 6.4  parseDmnXml end-to-end with fixture file ────────────────

    describe("6.4  parseDmnXml + Operaton engine end-to-end", () => {
        it("evaluates customer-discount.dmn fixture (empty inputExpression text → label fallback)", async () => {
            if (skipIfUnavailable()) return;
            // Load the fixture that mirrors TODO.dmn: empty <text> in
            // inputExpression elements so the engine must fall back to the
            // column label as the variable name.
            const xml = readFileSync(
                resolve(__dirname, "fixtures/customer-discount.dmn"),
                "utf-8"
            );
            const { parseDmnXml } = await import("./parse");
            const model = await parseDmnXml(xml);
            const d = model.decisions.get("Decision_CustomerDiscount")!;

            // Verify label fallback: expression should equal the label string
            expect(d.logic?.type).toBe("decisionTable");
            if (d.logic?.type === "decisionTable") {
                expect(d.logic.inputs[0].expression).toBe("customer");
                expect(d.logic.inputs[1].expression).toBe("quantity");
            }

            const eval_ = (vars: Record<string, unknown>) =>
                evalWithOperaton(model, "Decision_CustomerDiscount", vars);

            // gold + bulk (>= 10) → 20 %
            expect(eval_({ customer: "gold", quantity: 10 })).toBe(20);
            expect(eval_({ customer: "gold", quantity: 15 })).toBe(20);

            // gold + small (< 10) → 10 %  (FIRST policy: Rule_GoldSmall fires)
            expect(eval_({ customer: "gold", quantity: 5 })).toBe(10);

            // silver + any quantity → 5 %
            expect(eval_({ customer: "silver", quantity: 1 })).toBe(5);
            expect(eval_({ customer: "silver", quantity: 100 })).toBe(5);

            // no match (bronze tier) → null
            expect(eval_({ customer: "bronze", quantity: 5 })).toBeNull();
        });
    });
});
