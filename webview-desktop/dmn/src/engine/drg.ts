/**
 * Decision Requirements Graph (DRG) resolver.
 *
 * Resolves the evaluation order for decisions using topological sort.
 */

import { DmnModel } from "./parse";

/**
 * Resolve the evaluation order for a set of decisions using topological sort.
 *
 * @param model - Parsed DMN model
 * @param targetDecisionId - If provided, only include decisions needed for this one
 * @returns Decision IDs in evaluation order (dependencies first)
 * @throws Error if there is a circular dependency
 */
export function resolveEvaluationOrder(
    model: DmnModel,
    targetDecisionId?: string
): string[] {
    if (targetDecisionId) {
        return resolveForDecision(model, targetDecisionId);
    }
    return resolveAll(model);
}

/**
 * Resolve evaluation order for a specific target decision and its transitive dependencies.
 */
function resolveForDecision(model: DmnModel, targetId: string): string[] {
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const order: string[] = [];

    function visit(decisionId: string) {
        if (visited.has(decisionId)) return;

        if (visiting.has(decisionId)) {
            throw new Error(
                `Circular dependency detected involving decision: ${decisionId}`
            );
        }

        visiting.add(decisionId);

        const decision = model.decisions.get(decisionId);
        if (!decision) {
            throw new Error(`Decision not found: ${decisionId}`);
        }

        for (const requiredId of decision.informationRequirements) {
            visit(requiredId);
        }

        visiting.delete(decisionId);
        visited.add(decisionId);
        order.push(decisionId);
    }

    visit(targetId);
    return order;
}

/**
 * Resolve evaluation order for all decisions in the model (full topological sort).
 */
function resolveAll(model: DmnModel): string[] {
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const order: string[] = [];

    function visit(decisionId: string) {
        if (visited.has(decisionId)) return;

        if (visiting.has(decisionId)) {
            throw new Error(
                `Circular dependency detected involving decision: ${decisionId}`
            );
        }

        visiting.add(decisionId);

        const decision = model.decisions.get(decisionId);
        if (!decision) {
            throw new Error(`Decision not found: ${decisionId}`);
        }

        for (const requiredId of decision.informationRequirements) {
            visit(requiredId);
        }

        visiting.delete(decisionId);
        visited.add(decisionId);
        order.push(decisionId);
    }

    for (const decisionId of model.decisions.keys()) {
        visit(decisionId);
    }

    return order;
}

/**
 * Get all decisions that a given decision depends on (transitive closure).
 *
 * @param model - Parsed DMN model
 * @param decisionId - The target decision
 * @returns IDs of all required decisions (not including the target itself)
 */
export function getDependencies(model: DmnModel, decisionId: string): string[] {
    const order = resolveForDecision(model, decisionId);
    // Remove the target itself — it's always the last element
    return order.slice(0, -1);
}
