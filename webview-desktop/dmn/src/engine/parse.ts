/**
 * DMN XML Parser — parses DMN 1.3 XML into an internal model using dmn-moddle.
 *
 * Uses dmn-moddle and camunda-dmn-moddle to parse DMN XML and extract
 * decisions, decision tables, literal expressions, and DRG information.
 */

import { DmnModdle } from "dmn-moddle";
import camundaDescriptor from "camunda-dmn-moddle/resources/camunda.json";

// ── Types ───────────────────────────────────────────────────────────

export interface DmnInput {
    id: string;
    label: string;
    expression: string;
    typeRef?: string;
    /** camunda:inputVariable — the named context binding for unary tests */
    inputVariableName?: string;
    /** Per-expression language override (e.g. "feel", "juel"). Defaults to FEEL. */
    expressionLanguage?: string;
}

export interface DmnOutput {
    id: string;
    name: string;
    label: string;
    typeRef?: string;
}

export interface DmnRule {
    id: string;
    inputEntries: string[];
    outputEntries: string[];
    description?: string;
}

export interface DmnDecisionTable {
    type: "decisionTable";
    hitPolicy: string;
    aggregation?: string;
    inputs: DmnInput[];
    outputs: DmnOutput[];
    rules: DmnRule[];
}

export interface DmnLiteralExpression {
    type: "literalExpression";
    expression: string;
    typeRef?: string;
    variable?: string;
    /** Per-expression language override (e.g. "feel", "juel"). Defaults to FEEL. */
    expressionLanguage?: string;
}

export type DmnDecisionLogic = DmnDecisionTable | DmnLiteralExpression;

export interface DmnDecision {
    id: string;
    name: string;
    logic: DmnDecisionLogic | null;
    informationRequirements: string[];
}

export interface DmnModel {
    id: string;
    name: string;
    namespace: string;
    decisions: Map<string, DmnDecision>;
}

// ── Parser ──────────────────────────────────────────────────────────

/**
 * Parse DMN XML into an internal model.
 */
export async function parseDmnXml(xml: string): Promise<DmnModel> {
    const moddle = new DmnModdle({ camunda: camundaDescriptor });
    const { rootElement } = await moddle.fromXML(xml);

    const decisions = new Map<string, DmnDecision>();

    for (const element of rootElement.drgElement ?? []) {
        if (element.$type === "dmn:Decision") {
            const decision = extractDecision(element);
            decisions.set(decision.id, decision);
        }
    }

    return {
        id: rootElement.id,
        name: rootElement.name ?? "",
        namespace: rootElement.namespace ?? "",
        decisions,
    };
}

/**
 * Extract a decision from a moddle element.
 */
function extractDecision(element: any): DmnDecision {
    const id: string = element.id;
    const name: string = element.name || id;

    // Resolve information requirements (dependencies)
    const informationRequirements: string[] = [];
    for (const req of element.informationRequirement || []) {
        const requiredDecision = req.requiredDecision;
        if (requiredDecision) {
            const href: string = requiredDecision.href || "";
            const refId = href.startsWith("#") ? href.substring(1) : href;
            if (refId) {
                informationRequirements.push(refId);
            }
        }
    }

    // Extract decision logic
    const logic = extractDecisionLogic(element.decisionLogic, element.variable);

    return { id, name, logic, informationRequirements };
}

/**
 * Extract decision logic (decision table or literal expression).
 */
function extractDecisionLogic(
    decisionLogic: any,
    variable?: any
): DmnDecisionLogic | null {
    if (!decisionLogic) {
        return null;
    }

    if (decisionLogic.$type === "dmn:DecisionTable") {
        return extractDecisionTable(decisionLogic);
    }

    if (decisionLogic.$type === "dmn:LiteralExpression") {
        return extractLiteralExpression(decisionLogic, variable);
    }

    return null;
}

/**
 * Extract a decision table.
 */
function extractDecisionTable(dt: any): DmnDecisionTable {
    const inputs: DmnInput[] = (dt.input || []).map((input: any) => ({
        id: input.id,
        label: input.label || "",
        // When the input expression text is empty, fall back to the column
        // label as the variable name — the conventional behaviour in DMN
        // editors where the label doubles as the context key.
        expression:
            input.inputExpression?.text || input.label || "",
        typeRef: input.inputExpression?.typeRef || input.typeRef || undefined,
        inputVariableName: input.inputVariable || undefined,
        expressionLanguage:
            input.inputExpression?.expressionLanguage ||
            input.expressionLanguage ||
            undefined,
    }));

    const outputs: DmnOutput[] = (dt.output || []).map((output: any) => ({
        id: output.id,
        name: output.name || "",
        label: output.label || "",
        typeRef: output.typeRef || undefined,
    }));

    const rules: DmnRule[] = (dt.rule || []).map((rule: any) => ({
        id: rule.id,
        inputEntries: (rule.inputEntry || []).map(
            (entry: any) => entry.text || ""
        ),
        outputEntries: (rule.outputEntry || []).map(
            (entry: any) => entry.text || ""
        ),
        description: rule.description || undefined,
    }));

    // Parse hit policy — default is UNIQUE
    const hitPolicy: string = (dt.hitPolicy || "UNIQUE").toUpperCase();
    const aggregation: string | undefined = dt.aggregation
        ? dt.aggregation.toUpperCase()
        : undefined;

    return {
        type: "decisionTable",
        hitPolicy,
        aggregation,
        inputs,
        outputs,
        rules,
    };
}

/**
 * Extract a literal expression.
 */
function extractLiteralExpression(
    le: any,
    variable?: any
): DmnLiteralExpression {
    return {
        type: "literalExpression",
        expression: le.text || "",
        // typeRef can come from the decision-level variable or the expression itself
        typeRef: variable?.typeRef || le.typeRef || undefined,
        variable: variable?.name || le.variable?.name || undefined,
        expressionLanguage: le.expressionLanguage || undefined,
    };
}
