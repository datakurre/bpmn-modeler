/**
 * Batch evaluation — types and utilities for batch DMN evaluation.
 *
 * The actual per-row evaluation is performed in the evaluation panel
 * using the Operaton DMN engine (evaluateDecisionWithOperaton).
 */

import type { EvaluationTrace } from "./evaluate";
import type { DmnModel, DmnDecisionTable } from "./parse";

// ── Types ───────────────────────────────────────────────────────────

export interface BatchRow {
    index: number;
    inputData: Record<string, unknown>;
    result: unknown;
    trace: EvaluationTrace[];
    error?: string;
}

export interface BatchAggregation {
    totalRows: number;
    successRows: number;
    errorRows: number;
    decisions: {
        decisionId: string;
        decisionName: string;
        evaluatedCount: number;
    }[];
}

// ── Utilities ────────────────────────────────────────────────────────

/**
 * Build a column→typeRef map from a decision's input definitions.
 * Used by parseCSV to coerce values to the appropriate type.
 *
 * @param model - Parsed DMN model
 * @param decisionId - Decision whose inputs define the column types
 * @returns Map from column name (expression or label) to typeRef string
 */
export function getColumnTypes(
    model: DmnModel,
    decisionId: string
): Record<string, string> {
    const decision = model.decisions.get(decisionId);
    if (!decision || decision.logic?.type !== "decisionTable") {
        return {};
    }
    const dt = decision.logic as DmnDecisionTable;
    const types: Record<string, string> = {};
    for (const input of dt.inputs) {
        const key = input.expression || input.label;
        if (key && input.typeRef) {
            types[key] = input.typeRef.toLowerCase();
        }
    }
    return types;
}

/**
 * Aggregate batch results into summary statistics.
 */
export function aggregateBatchResults(rows: BatchRow[]): BatchAggregation {
    const successRows = rows.filter((r) => !r.error).length;
    const errorRows = rows.filter((r) => !!r.error).length;

    // Count per-decision evaluations
    const decisionCounts = new Map<
        string,
        { decisionName: string; count: number }
    >();
    for (const row of rows) {
        for (const entry of row.trace) {
            const existing = decisionCounts.get(entry.decisionId);
            if (existing) {
                existing.count++;
            } else {
                decisionCounts.set(entry.decisionId, {
                    decisionName: entry.decisionName,
                    count: 1,
                });
            }
        }
    }

    return {
        totalRows: rows.length,
        successRows,
        errorRows,
        decisions: Array.from(decisionCounts.entries()).map(
            ([decisionId, { decisionName, count }]) => ({
                decisionId,
                decisionName,
                evaluatedCount: count,
            })
        ),
    };
}

/**
 * Parse CSV text into an array of input data objects.
 *
 * The first line is treated as headers (variable names).
 * Values are coerced according to `columnTypes` when provided;
 * otherwise a conservative default is applied:
 *   - "true"/"false" → boolean
 *   - empty string → undefined
 *   - everything else → string (no number coercion without explicit typeRef)
 *
 * Supports RFC 4180 quoted fields (commas and double-quotes inside values).
 *
 * @param csvText - Raw CSV text
 * @param columnTypes - Optional map of column name → DMN typeRef (e.g. "integer", "double", "boolean", "string")
 */
export function parseCSV(
    csvText: string,
    columnTypes: Record<string, string> = {}
): Record<string, unknown>[] {
    const lines = csvText
        .trim()
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0);

    if (lines.length < 2) return [];

    const headers = splitCsvLine(lines[0]).map((h) => h.trim());
    const rows: Record<string, unknown>[] = [];

    for (let i = 1; i < lines.length; i++) {
        const values = splitCsvLine(lines[i]).map((v) => v.trim());
        const row: Record<string, unknown> = {};

        for (let j = 0; j < headers.length; j++) {
            const key = headers[j];
            const raw = values[j] ?? "";
            const typeRef = (columnTypes[key] ?? "").toLowerCase();

            if (raw === "") {
                row[key] = undefined;
                continue;
            }

            switch (typeRef) {
                case "boolean":
                    row[key] = raw.toLowerCase() === "true";
                    break;
                case "integer":
                case "long":
                    row[key] = parseInt(raw, 10);
                    break;
                case "double":
                case "number":
                    row[key] = parseFloat(raw);
                    break;
                case "string":
                    // Explicit string type — never coerce
                    row[key] = raw;
                    break;
                default:
                    // No typeRef known: keep booleans, keep everything else as string
                    if (raw.toLowerCase() === "true") {
                        row[key] = true;
                    } else if (raw.toLowerCase() === "false") {
                        row[key] = false;
                    } else {
                        row[key] = raw;
                    }
            }
        }

        rows.push(row);
    }

    return rows;
}

/**
 * Split a single CSV line into fields, handling RFC 4180 quoted fields.
 *
 * Quoted fields may contain commas and escaped double-quotes ("").
 */
function splitCsvLine(line: string): string[] {
    const fields: string[] = [];
    let field = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            if (inQuotes && line[i + 1] === '"') {
                // Escaped double-quote inside a quoted field
                field += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (ch === "," && !inQuotes) {
            fields.push(field);
            field = "";
        } else {
            field += ch;
        }
    }
    fields.push(field);
    return fields;
}
