/**
 * Export utilities — convert evaluation results to CSV/JSON for download.
 */

import type { BatchRow } from "./batch";
import type { EvaluationTrace } from "./evaluate";

// ── Batch Results Export ────────────────────────────────────────────

/**
 * Export batch results as a JSON string.
 */
export function exportBatchAsJSON(rows: BatchRow[]): string {
    const data = rows.map((r) => ({
        index: r.index + 1,
        input: r.inputData,
        result: r.result,
        error: r.error ?? null,
    }));
    return JSON.stringify(data, null, 2);
}

/**
 * Export batch results as CSV text.
 *
 * Columns: Row#, then all input variable names, then Result, then Error.
 */
export function exportBatchAsCSV(rows: BatchRow[]): string {
    if (rows.length === 0) return "";

    // Collect all input keys across all rows
    const inputKeys = new Set<string>();
    for (const row of rows) {
        for (const key of Object.keys(row.inputData)) {
            inputKeys.add(key);
        }
    }
    const sortedKeys = [...inputKeys].sort();

    // Header
    const header = ["#", ...sortedKeys, "Result", "Error"];

    // Rows
    const csvRows = rows.map((row) => {
        const cells: string[] = [
            String(row.index + 1),
            ...sortedKeys.map((k) => csvCell(row.inputData[k])),
            csvCell(row.result),
            row.error ?? "",
        ];
        return cells.join(",");
    });

    return [header.join(","), ...csvRows].join("\n");
}

// ── Trace Export ────────────────────────────────────────────────────

/**
 * Export evaluation trace as a JSON string.
 */
export function exportTraceAsJSON(trace: EvaluationTrace[]): string {
    return JSON.stringify(trace, null, 2);
}

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * Format a value as a CSV cell, quoting when necessary.
 */
function csvCell(value: unknown): string {
    if (value === null || value === undefined) return "";

    const str =
        typeof value === "object" ? JSON.stringify(value) : String(value);

    // Quote the cell if it contains commas, quotes, or newlines
    if (str.includes(",") || str.includes('"') || str.includes("\n")) {
        return '"' + str.replace(/"/g, '""') + '"';
    }

    return str;
}
