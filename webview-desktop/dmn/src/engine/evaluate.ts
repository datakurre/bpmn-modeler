/**
 * Shared types for DMN evaluation results and traces.
 *
 * These types are used throughout the evaluation pipeline — by the Operaton
 * engine wrapper (operaton-dmn.ts), the export utilities (export.ts), the
 * batch helpers (batch.ts), and the UI (evaluation-panel.ts).
 */

import type { MatchedRule } from "./hit-policy";

// ── Evaluation result ───────────────────────────────────────────────

/** Result of evaluating a single decision. */
export interface EvaluationResult {
    result: unknown;
    trace: EvaluationTrace[];
    error?: string;
}

/** Options controlling evaluation behaviour (reserved for future use). */
export interface EvaluationOptions {
    // Currently empty — reserved for future flags such as tracing verbosity.
}

// ── Trace ───────────────────────────────────────────────────────────

/**
 * One entry in the evaluation trace — describes what happened when a single
 * decision was evaluated.
 */
export interface EvaluationTrace {
    decisionId: string;
    decisionName: string;
    /** "decisionTable" | "literalExpression" | "override" */
    type: string;
    inputValues?: Record<string, unknown>;
    matchedRules: MatchedRule[];
    result: unknown;
    hitPolicy?: string;
    aggregation?: string;
    /** Evaluation duration in milliseconds (optional — not always populated). */
    durationMs?: number;
    error?: string;
}
