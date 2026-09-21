/**
 * Pure-TypeScript DMN fallback evaluator.
 *
 * Used when the TeaVM-compiled Operaton engine bundle cannot be loaded.
 * Evaluates DMN decision tables and literal expressions using the `feelin`
 * FEEL library, the hit-policy helpers, and the DRG resolver.
 *
 * Limitations compared to the full Operaton engine:
 * - PRIORITY and OUTPUT ORDER hit policies are not supported.
 * - Some advanced FEEL built-in functions may behave differently.
 */

import {
    evaluate as feelinEvaluate,
    unaryTest as feelinUnaryTest,
} from "feelin";
import type { DmnModel, DmnDecisionTable } from "./parse";
import { resolveEvaluationOrder } from "./drg";
import { applyHitPolicy, type MatchedRule } from "./hit-policy";
import { coerceValue } from "./types";
import type { EvaluationResult, EvaluationTrace } from "./evaluate";

// ── Public API ──────────────────────────────────────────────────────

/**
 * Evaluate a decision using the pure-TypeScript fallback engine.
 *
 * @param model - Parsed DMN model
 * @param decisionId - ID of the target decision to evaluate
 * @param inputData - Input variable bindings
 * @returns EvaluationResult with result, trace, and optional error
 */
export function evaluateDecisionTs(
    model: DmnModel,
    decisionId: string,
    inputData: Record<string, unknown>
): EvaluationResult {
    let order: string[];
    try {
        order = resolveEvaluationOrder(model, decisionId);
    } catch (e) {
        return {
            result: null,
            trace: [],
            error: `DRG resolution failed: ${e instanceof Error ? e.message : String(e)}`,
        };
    }

    const trace: EvaluationTrace[] = [];
    const context: Record<string, unknown> = { ...inputData };
    let finalResult: unknown = null;

    for (const id of order) {
        const decision = model.decisions.get(id);
        if (!decision) {
            return {
                result: null,
                trace,
                error: `Decision not found: ${id}`,
            };
        }

        const entry = evaluateOneDecision(decision.id, decision, context);
        trace.push(entry);

        if (entry.error) {
            return { result: null, trace, error: entry.error };
        }

        // Make this decision's output available as a named variable
        if (decision.logic?.type === "literalExpression") {
            const varName =
                (decision.logic as { variable?: string }).variable ??
                decision.id;
            context[varName] = entry.result;
        } else if (decision.logic?.type === "decisionTable") {
            const dt = decision.logic as unknown as DmnDecisionTable;
            if (dt.outputs.length === 1 && entry.result !== null && typeof entry.result === "object" && !Array.isArray(entry.result)) {
                // Single-output table: flatten the output into the context so
                // downstream decisions can reference it by output name directly.
                const outputName = dt.outputs[0].name;
                context[outputName] = (entry.result as Record<string, unknown>)[outputName];
            }
            // Also expose the full result under both the decision name and id
            // so downstream decisions can reference it as an object if needed.
            context[decision.name] = entry.result;
            context[decision.id] = entry.result;
        } else {
            context[decision.name] = entry.result;
            context[decision.id] = entry.result;
        }

        if (id === decisionId) {
            finalResult = entry.result;
        }
    }

    return { result: finalResult, trace };
}

// ── Internal helpers ────────────────────────────────────────────────

interface DecisionLike {
    id: string;
    name: string;
    logic: any;
}

function evaluateOneDecision(
    decisionId: string,
    decision: DecisionLike,
    context: Record<string, unknown>
): EvaluationTrace {
    const base: Omit<EvaluationTrace, "result"> = {
        decisionId,
        decisionName: decision.name,
        type: "unknown",
        matchedRules: [],
    };

    if (!decision.logic) {
        return { ...base, type: "unknown", result: null, error: "No decision logic" };
    }

    if (decision.logic.type === "literalExpression") {
        return evaluateLiteralExpression(
            decision.logic as unknown as LiteralExprLogic,
            context,
            base,
        );
    }

    if (decision.logic.type === "decisionTable") {
        return evaluateDecisionTable(decision.logic as unknown as DmnDecisionTable, context, base);
    }

    return { ...base, result: null, error: `Unsupported logic type: ${decision.logic.type}` };
}

interface LiteralExprLogic {
    type: "literalExpression";
    expression: string;
    typeRef?: string;
    variable?: string;
}

function evaluateLiteralExpression(
    logic: LiteralExprLogic,
    context: Record<string, unknown>,
    base: Omit<EvaluationTrace, "result">
): EvaluationTrace {
    try {
        const raw = feelinEvaluate(logic.expression, context);
        const value = (raw as { value: unknown }).value ?? null;
        const coerced = coerceValue(value, logic.typeRef);
        return { ...base, type: "literalExpression", result: coerced };
    } catch (e) {
        return {
            ...base,
            type: "literalExpression",
            result: null,
            error: `FEEL evaluation error: ${e instanceof Error ? e.message : String(e)}`,
        };
    }
}

function evaluateDecisionTable(
    dt: DmnDecisionTable,
    context: Record<string, unknown>,
    base: Omit<EvaluationTrace, "result">
): EvaluationTrace {
    const matchedRules: MatchedRule[] = [];

    for (let i = 0; i < dt.rules.length; i++) {
        const rule = dt.rules[i];

        // Evaluate input entries as FEEL unary tests
        let allInputsMatch = true;
        for (let j = 0; j < dt.inputs.length; j++) {
            const input = dt.inputs[j];
            const unaryTest = rule.inputEntries[j] ?? "";

            if (!unaryTest.trim() || unaryTest.trim() === "-") continue;

            // Determine the context variable name for this input
            const varName =
                input.inputVariableName ?? input.expression ?? input.label;
            const inputValue: unknown = context[varName];

            const inputCtx = { ...context, "?": inputValue };
            try {
                const raw = feelinUnaryTest(unaryTest, inputCtx);
                const matched = !!(raw as { value: unknown }).value;
                if (!matched) {
                    allInputsMatch = false;
                    break;
                }
            } catch {
                allInputsMatch = false;
                break;
            }
        }

        if (!allInputsMatch) continue;

        // Evaluate output entries
        const outputs: Record<string, unknown> = {};
        for (let k = 0; k < dt.outputs.length; k++) {
            const output = dt.outputs[k];
            const expr = rule.outputEntries[k] ?? "";
            if (!expr.trim()) {
                outputs[output.name] = null;
                continue;
            }
            try {
                const raw = feelinEvaluate(expr, context);
                const value = (raw as { value: unknown }).value ?? null;
                outputs[output.name] = coerceValue(value, output.typeRef);
            } catch {
                outputs[output.name] = null;
            }
        }

        matchedRules.push({ id: rule.id, index: i, outputs });
    }

    const outputNames = dt.outputs.map((o) => o.name);
    const { result, error } = applyHitPolicy(
        dt.hitPolicy,
        dt.aggregation,
        matchedRules,
        outputNames
    );

    return {
        ...base,
        type: "decisionTable",
        matchedRules,
        hitPolicy: dt.hitPolicy,
        aggregation: dt.aggregation,
        result,
        error,
    };
}
