/**
 * DMN Evaluation Engine — barrel export.
 */

export { parseDmnXml } from "./parse";
export type {
    DmnModel,
    DmnDecision,
    DmnDecisionTable,
    DmnInput,
    DmnOutput,
    DmnRule,
} from "./parse";

export type {
    EvaluationResult,
    EvaluationTrace,
    EvaluationOptions,
} from "./evaluate";

export {
    aggregateBatchResults,
    parseCSV,
    getColumnTypes,
} from "./batch";
export type { BatchRow, BatchAggregation } from "./batch";

export { applyHitPolicy } from "./hit-policy";
export type { MatchedRule, HitPolicyResult } from "./hit-policy";

export { resolveEvaluationOrder, getDependencies } from "./drg";

export { coerceValue } from "./types";

export {
    exportBatchAsJSON,
    exportBatchAsCSV,
    exportTraceAsJSON,
} from "./export";
