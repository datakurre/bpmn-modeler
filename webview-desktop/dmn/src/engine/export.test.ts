import { describe, it, expect } from "vitest";
import {
    exportBatchAsJSON,
    exportBatchAsCSV,
    exportTraceAsJSON,
} from "./export";
import type { BatchRow } from "./batch";
import type { EvaluationTrace } from "./evaluate";

describe("exportBatchAsJSON", () => {
    it("formats batch results as pretty JSON", () => {
        const rows: BatchRow[] = [
            {
                index: 0,
                inputData: { age: 25 },
                result: "approved",
                trace: [],
            },
            {
                index: 1,
                inputData: { age: 17 },
                result: null,
                trace: [],
                error: "rejected",
            },
        ];

        const json = exportBatchAsJSON(rows);
        const parsed = JSON.parse(json);

        expect(parsed).toEqual([
            { index: 1, input: { age: 25 }, result: "approved", error: null },
            { index: 2, input: { age: 17 }, result: null, error: "rejected" },
        ]);
    });

    it("returns empty array JSON for no rows", () => {
        expect(exportBatchAsJSON([])).toBe("[]");
    });
});

describe("exportBatchAsCSV", () => {
    it("creates CSV with header and rows", () => {
        const rows: BatchRow[] = [
            {
                index: 0,
                inputData: { name: "Alice", age: 25 },
                result: "yes",
                trace: [],
            },
            {
                index: 1,
                inputData: { name: "Bob", age: 30 },
                result: "no",
                trace: [],
                error: "too old",
            },
        ];

        const csv = exportBatchAsCSV(rows);
        const lines = csv.split("\n");

        expect(lines[0]).toBe("#,age,name,Result,Error");
        expect(lines[1]).toBe("1,25,Alice,yes,");
        expect(lines[2]).toBe("2,30,Bob,no,too old");
    });

    it("returns empty string for no rows", () => {
        expect(exportBatchAsCSV([])).toBe("");
    });

    it("quotes cells containing commas", () => {
        const rows: BatchRow[] = [
            {
                index: 0,
                inputData: { x: "a,b" },
                result: "ok",
                trace: [],
            },
        ];

        const csv = exportBatchAsCSV(rows);
        const lines = csv.split("\n");
        expect(lines[1]).toBe('1,"a,b",ok,');
    });

    it("handles object results by serializing to JSON", () => {
        const rows: BatchRow[] = [
            {
                index: 0,
                inputData: { x: 1 },
                result: { a: 1, b: 2 },
                trace: [],
            },
        ];

        const csv = exportBatchAsCSV(rows);
        const lines = csv.split("\n");
        // JSON result contains commas so it should be quoted
        expect(lines[1]).toContain('"');
    });
});

describe("exportTraceAsJSON", () => {
    it("formats trace entries as pretty JSON", () => {
        const trace: EvaluationTrace[] = [
            {
                decisionId: "d1",
                decisionName: "Decision 1",
                type: "decisionTable",
                result: "approved",
                matchedRules: [0],
                hitPolicy: "UNIQUE",
                durationMs: 5,
            },
        ];

        const json = exportTraceAsJSON(trace);
        const parsed = JSON.parse(json);

        expect(parsed).toHaveLength(1);
        expect(parsed[0].decisionId).toBe("d1");
        expect(parsed[0].result).toBe("approved");
    });

    it("returns empty array JSON for empty trace", () => {
        expect(exportTraceAsJSON([])).toBe("[]");
    });
});
