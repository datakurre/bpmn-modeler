/**
 * Hit-policy implementations for DMN decision tables.
 *
 * Implements: UNIQUE, ANY, FIRST, RULE ORDER, COLLECT (+SUM/MIN/MAX/COUNT)
 *
 * Modeled after Operaton's engine-dmn hit-policy logic.
 */

export interface MatchedRule {
    id: string;
    index: number;
    outputs: Record<string, unknown>;
}

export interface HitPolicyResult {
    result: unknown;
    error?: string;
}

/**
 * Apply a hit policy to a list of matched rules.
 *
 * @param hitPolicy - The hit policy (UNIQUE, ANY, FIRST, RULE ORDER, COLLECT)
 * @param aggregation - The aggregation for COLLECT (SUM, MIN, MAX, COUNT)
 * @param matchedRules - The rules that matched
 * @param outputNames - Names of the output columns
 * @returns The result after applying the hit policy
 */
export function applyHitPolicy(
    hitPolicy: string,
    aggregation: string | undefined,
    matchedRules: MatchedRule[],
    outputNames: string[]
): HitPolicyResult {
    switch (hitPolicy) {
        case "UNIQUE":
            return applyUnique(matchedRules);
        case "ANY":
            return applyAny(matchedRules);
        case "FIRST":
            return applyFirst(matchedRules);
        case "RULE ORDER":
            return applyRuleOrder(matchedRules);
        case "COLLECT":
            return applyCollect(matchedRules, aggregation, outputNames);
        case "PRIORITY":
        case "OUTPUT ORDER":
            return {
                result: null,
                error: `Hit policy "${hitPolicy}" is not yet supported`,
            };
        default:
            return { result: null, error: `Unknown hit policy: ${hitPolicy}` };
    }
}

function applyUnique(matchedRules: MatchedRule[]): HitPolicyResult {
    if (matchedRules.length === 0) {
        return { result: null };
    }
    if (matchedRules.length > 1) {
        return {
            result: null,
            error: `UNIQUE hit policy violated: ${matchedRules.length} rules matched`,
        };
    }
    return { result: matchedRules[0].outputs };
}

function applyAny(matchedRules: MatchedRule[]): HitPolicyResult {
    if (matchedRules.length === 0) {
        return { result: null };
    }

    // All matched rules must produce the same output (structural deep equality)
    const first = matchedRules[0].outputs;
    for (let i = 1; i < matchedRules.length; i++) {
        if (!deepEqual(first, matchedRules[i].outputs)) {
            return {
                result: null,
                error: "ANY hit policy violated: matched rules produce different outputs",
            };
        }
    }

    return { result: first };
}

function deepEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (a === null || b === null || a === undefined || b === undefined)
        return false;
    if (typeof a !== "object" || typeof b !== "object") return false;
    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;
    const keysA = Object.keys(aObj).sort();
    const keysB = Object.keys(bObj).sort();
    if (keysA.length !== keysB.length) return false;
    for (const key of keysA) {
        if (!deepEqual(aObj[key], bObj[key])) return false;
    }
    return true;
}

function applyFirst(matchedRules: MatchedRule[]): HitPolicyResult {
    if (matchedRules.length === 0) {
        return { result: null };
    }
    return { result: matchedRules[0].outputs };
}

function applyRuleOrder(matchedRules: MatchedRule[]): HitPolicyResult {
    if (matchedRules.length === 0) {
        return { result: [] };
    }
    return { result: matchedRules.map((r) => r.outputs) };
}

function applyCollect(
    matchedRules: MatchedRule[],
    aggregation: string | undefined,
    outputNames: string[]
): HitPolicyResult {
    if (!aggregation) {
        // No aggregation — return list of all matched outputs
        return { result: matchedRules.map((r) => r.outputs) };
    }

    // Aggregation: reference throws when applied to multi-output tables
    if (outputNames.length > 1) {
        return {
            result: null,
            error: `COLLECT aggregation "${aggregation}" is not applicable to tables with multiple output columns`,
        };
    }

    // COUNT uses the number of matched rules (including those with null output)
    if (aggregation === "COUNT") {
        return { result: matchedRules.length };
    }

    if (matchedRules.length === 0) {
        return { result: null };
    }

    // SUM/MIN/MAX: collect non-null numeric output values
    const outputName = outputNames[0];
    const values = matchedRules
        .map((r) => r.outputs[outputName])
        .filter((v) => v !== null && v !== undefined)
        .map(Number)
        .filter((v) => !isNaN(v));

    switch (aggregation) {
        case "SUM":
            return { result: values.reduce((a, b) => a + b, 0) };
        case "MIN":
            return {
                result: values.length > 0 ? Math.min(...values) : null,
            };
        case "MAX":
            return {
                result: values.length > 0 ? Math.max(...values) : null,
            };
        default:
            return {
                result: null,
                error: `Unknown COLLECT aggregation: ${aggregation}`,
            };
    }
}
