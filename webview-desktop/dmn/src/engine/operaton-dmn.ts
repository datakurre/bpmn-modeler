/**
 * operaton-dmn.ts — TypeScript wrapper for the TeaVM-compiled Operaton DMN engine.
 *
 * Lifecycle:
 *   1. FEEL JS callbacks are registered on globalThis so the compiled
 *      JsFeelEngine in the TeaVM bundle can call them.
 *   2. The TeaVM bundle is loaded; it installs globalThis.OperatonDmnEngine.
 *   3. evaluateDecisionWithOperaton() serialises the DmnModel + input variables
 *      to JSON, calls the Java engine, and maps the result to EvaluationResult.
 *
 * Falls back gracefully (returns null) if the bundle is unavailable.
 */

import { evaluate as feelinEvaluate, unaryTest as feelinUnaryTest } from "feelin";
import type { DmnModel } from "./parse";
import type {
    EvaluationResult,
    EvaluationTrace,
} from "./evaluate";
import type { MatchedRule } from "./hit-policy";

// ── State ───────────────────────────────────────────────────────────

let initialized = false;
let loadAttempted = false;

// ── FEEL callbacks ──────────────────────────────────────────────────

/**
 * Register the JS FEEL callback globals expected by the compiled JsFeelEngine
 * in the TeaVM bundle.  The bundle was compiled with JsFeelEngine, which calls:
 *   window.__feelEvalExpression(expression, contextJson) → JSON string
 *   window.__feelEvalUnaryTests(tests, inputValueJson, contextJson) → boolean
 */
function registerFeelCallbacks() {
    const g = globalThis as Record<string, unknown>;
    if (g.__feelEvalExpression) return; // already registered

    g.__feelEvalExpression = (expression: string, contextJson: string): string => {
        try {
            const ctx = JSON.parse(contextJson) as Record<string, unknown>;
            const raw = feelinEvaluate(expression, ctx);
            const value = (raw as { value: unknown }).value ?? null;
            return JSON.stringify(value);
        } catch {
            return "null";
        }
    };

    g.__feelEvalUnaryTests = (
        tests: string,
        inputValueJson: string,
        contextJson: string
    ): boolean => {
        try {
            const trimmed = tests.trim();
            if (!trimmed || trimmed === "-") return true;
            const inputValue: unknown = JSON.parse(inputValueJson);
            const ctx = JSON.parse(contextJson) as Record<string, unknown>;
            const raw = feelinUnaryTest(trimmed, { ...ctx, "?": inputValue });
            return !!(raw as { value: unknown }).value;
        } catch {
            return false;
        }
    };
}

// ── Initialisation ──────────────────────────────────────────────────

/**
 * Load and initialise the Operaton DMN engine bundle.
 * Safe to call multiple times — only loads once.
 * Returns true if the engine is available.
 */
export async function initializeOperatonEngine(): Promise<boolean> {
    if (loadAttempted) return initialized;
    loadAttempted = true;

    // Register JS FEEL callbacks required by the compiled JsFeelEngine in the
    // TeaVM bundle.  The bundle calls window.__feelEvalExpression and
    // window.__feelEvalUnaryTests; we back them with the feelin JS library.
    registerFeelCallbacks();

    // Load the TeaVM bundle.
    // Use @vite-ignore so Vite does NOT code-split this into assets/ — the
    // bundle is copied to the webview root via viteStaticCopy so the runtime
    // relative import resolves.
    try {
        const operatonBundlePath = "./operaton-dmn-bundle.js";
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const bundle = await import(/* @vite-ignore */ operatonBundlePath);
        await new Promise<void>((resolve, reject) => {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
            bundle.main([], (err?: Error) => {
                if (err) reject(err);
                else resolve();
            });
        });
        initialized =
            typeof (globalThis as Record<string, unknown>).OperatonDmnEngine ===
            "object";
        if (!initialized) {
            console.error(
                "[OperatonDMN] TeaVM bundle loaded but globalThis.OperatonDmnEngine was not installed."
            );
        }
    } catch (err) {
        console.error(
            "[OperatonDMN] Failed to load or initialise TeaVM bundle:",
            err
        );
        initialized = false;
    }

    return initialized;
}

/** True if the engine has been successfully initialised. */
export function isOperatonEngineAvailable(): boolean {
    return initialized;
}

// ── Error translation ───────────────────────────────────────────────

/**
 * Map raw TeaVM / Java engine errors to readable messages.
 *
 * TeaVM compiles Java static methods with a `$` prefix, so a TypeError like
 * "Cannot read properties of null (reading '$uniqueHitPolicyOnlyAllowsSingleMatchingRule')"
 * means the JVM class was not initialised and the static factory method is
 * unavailable.  We detect the mangled name embedded in the message and return
 * a description that makes sense to the end-user.
 *
 * Also used to sanitise `{"error":"…"}` strings returned from the Java engine
 * via JSON (e.g. when TeaVM wraps the JS error in a Java exception message).
 */
function translateEngineError(e: unknown): string {
    const raw = e instanceof Error ? e.message : String(e);
    return translateErrorMessage(raw);
}

/**
 * Translate a raw error *string* (from a thrown exception or a JSON error
 * field) into a user-friendly message.
 */
export function translateErrorMessage(raw: string): string {
    // TeaVM pattern: "Cannot read properties of null (reading '$<javaMethodName>')"
    // or "null has no properties" variants
    const teavmMatch = /\$([A-Za-z][A-Za-z0-9_]*)/.exec(raw);
    if (teavmMatch) {
        const javaName = teavmMatch[1];
        const friendly = teavmMethodToMessage(javaName);
        if (friendly) return friendly;
        // Generic fallback: strip the $ prefix so at least the name is readable
        return `Engine error: ${raw.replace(/\$([A-Za-z])/g, "$1")}`;
    }

    return raw;
}

/** Map known TeaVM-mangled Java method names to user-friendly messages. */
function teavmMethodToMessage(name: string): string | null {
    // DmnHitPolicyException factory methods
    if (/uniqueHitPolicy.*SingleMatch/i.test(name) || name === "uniqueHitPolicyOnlyAllowsSingleMatchingRule")
        return "Hit policy violation: UNIQUE decision table matched more than one rule.";
    if (/anyHitPolicy.*RequiresSameOutput/i.test(name))
        return "Hit policy violation: ANY decision table matched rules with different outputs.";
    if (/collectHitPolicy.*SingleOutput/i.test(name))
        return "Hit policy violation: COLLECT aggregation requires a single output column.";

    // DmnExpressionException / evaluation failures
    if (/unableToEvaluate/i.test(name) || /expressionEvaluation/i.test(name))
        return "FEEL expression evaluation failed — check expression syntax and input types.";

    return null;
}

// ── Evaluation ──────────────────────────────────────────────────────

/**
 * Evaluate a decision using the Operaton DMN engine (TeaVM).
 *
 * @returns EvaluationResult on success, or null if the engine is unavailable.
 */
export async function evaluateDecisionWithOperaton(
    model: DmnModel,
    decisionId: string,
    inputData: Record<string, unknown>
): Promise<EvaluationResult | null> {
    if (!initialized && !(await initializeOperatonEngine())) {
        return null;
    }

    // Serialise DmnModel: convert Map<string, DmnDecision> → plain object
    const decisionsObj: Record<string, unknown> = {};
    for (const [key, decision] of model.decisions.entries()) {
        decisionsObj[key] = decision;
    }
    const modelJson = JSON.stringify({ ...model, decisions: decisionsObj });
    const varsJson = JSON.stringify(inputData);

    let resultJson: string;
    try {
        resultJson = (
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
        ).OperatonDmnEngine.evaluateDecision(modelJson, decisionId, varsJson);
    } catch (e) {
        return {
            result: null,
            trace: [],
            error: translateEngineError(e),
        };
    }

    let parsed: {
        resultList?: unknown[];
        singleEntry?: unknown;
        error?: string;
        matchedRuleIds?: string[];
    };
    try {
        parsed = JSON.parse(resultJson);
    } catch {
        return {
            result: null,
            trace: [],
            error: "Invalid result JSON from engine",
        };
    }

    if (parsed.error) {
        return { result: null, trace: [], error: translateErrorMessage(parsed.error) };
    }

    const result =
        parsed.singleEntry !== undefined
            ? parsed.singleEntry
            : parsed.resultList;

    const decision = model.decisions.get(decisionId);
    const logicType =
        decision?.logic?.type === "decisionTable"
            ? "decisionTable"
            : "literalExpression";

    // Build MatchedRule objects from the IDs returned by the Java engine.
    // The index is the 0-based position of the rule in the decision table.
    const matchedRulesRaw = parsed.matchedRuleIds ?? [];
    const tableRules =
        decision?.logic?.type === "decisionTable" ? decision.logic.rules : [];
    const matchedRules: MatchedRule[] = matchedRulesRaw.map((ruleId) => {
        const index = tableRules.findIndex((r) => r.id === ruleId);
        return { id: ruleId, index: index >= 0 ? index : 0, outputs: {} };
    });

    const trace: EvaluationTrace[] = [
        {
            decisionId,
            decisionName: decision?.name ?? decisionId,
            type: logicType,
            inputValues: inputData,
            matchedRules,
            result,
        },
    ];

    return { result, trace };
}

// ── Testing hooks ────────────────────────────────────────────────────

/**
 * Inject a mock OperatonDmnEngine for unit tests.
 * Sets the engine on globalThis and marks the module as initialised so
 * evaluateDecisionWithOperaton() skips the bundle load entirely.
 */
export function _setEngineForTesting(engine: {
    evaluateDecision: (m: string, d: string, v: string) => string;
}): void {
    (globalThis as Record<string, unknown>).OperatonDmnEngine = engine;
    initialized = true;
    loadAttempted = true;
}

/** Reset module-level state between unit tests. */
export function _resetForTesting(): void {
    initialized = false;
    loadAttempted = false;
    delete (globalThis as Record<string, unknown>).OperatonDmnEngine;
}

/** Simulate a failed bundle load (loadAttempted=true, initialized=false). */
export function _simulateBundleMissingForTesting(): void {
    initialized = false;
    loadAttempted = true;
}
