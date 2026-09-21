import { describe, it, expect } from "vitest";
import {
    aggregateBatchResults,
    parseCSV,
    getColumnTypes,
    type BatchRow,
} from "./batch";
import type { DmnModel, DmnDecision } from "./parse";

// ── Helpers ─────────────────────────────────────────────────────────

function _makeSimpleModel(): DmnModel {
    const decisions = new Map<string, DmnDecision>();
    decisions.set("decision_1", {
        id: "decision_1",
        name: "Greeting",
        logic: {
            type: "decisionTable",
            hitPolicy: "FIRST",
            inputs: [
                {
                    id: "input_1",
                    label: "Name",
                    expression: "name",
                },
            ],
            outputs: [
                {
                    id: "output_1",
                    name: "greeting",
                    label: "Greeting",
                },
            ],
            rules: [
                {
                    id: "rule_1",
                    inputEntries: ['"Alice"'],
                    outputEntries: ['"Hello Alice"'],
                },
                {
                    id: "rule_2",
                    inputEntries: ['"Bob"'],
                    outputEntries: ['"Hello Bob"'],
                },
                {
                    id: "rule_3",
                    inputEntries: ["-"],
                    outputEntries: ['"Hello stranger"'],
                },
            ],
        },
        informationRequirements: [],
    });
    return {
        id: "definitions_1",
        name: "Test",
        namespace: "http://test",
        decisions,
    };
}

// ── parseCSV ────────────────────────────────────────────────────────

describe("parseCSV", () => {
    it("parses basic CSV with headers — numbers stay as strings without columnTypes", () => {
        const csv = `name,age\nAlice,30\nBob,25`;
        const rows = parseCSV(csv);
        expect(rows).toEqual([
            { name: "Alice", age: "30" },
            { name: "Bob", age: "25" },
        ]);
    });

    it("coerces numbers when columnTypes specifies integer/double", () => {
        const csv = `value\n42\n3.14\n-7`;
        const rows = parseCSV(csv, { value: "integer" });
        expect(rows[0].value).toBe(42);
        const rows2 = parseCSV(csv, { value: "double" });
        expect(rows2[1].value).toBe(3.14);
        expect(rows2[2].value).toBe(-7);
    });

    it("auto-coerces booleans without columnTypes", () => {
        const csv = `flag\ntrue\nfalse\nTRUE`;
        const rows = parseCSV(csv);
        expect(rows[0].flag).toBe(true);
        expect(rows[1].flag).toBe(false);
        expect(rows[2].flag).toBe(true);
    });

    it("treats empty values as undefined", () => {
        const csv = `a,b\n1,\n,2`;
        const rows = parseCSV(csv, { a: "integer", b: "integer" });
        expect(rows[0]).toEqual({ a: 1, b: undefined });
        expect(rows[1]).toEqual({ a: undefined, b: 2 });
    });

    it("returns empty array for header-only CSV", () => {
        const csv = `name,age`;
        const rows = parseCSV(csv);
        expect(rows).toEqual([]);
    });

    it("returns empty array for empty string", () => {
        expect(parseCSV("")).toEqual([]);
        expect(parseCSV("  \n  ")).toEqual([]);
    });

    it("handles whitespace in values", () => {
        const csv = `name , age \n Alice , 30 `;
        const rows = parseCSV(csv, { age: "integer" });
        expect(rows[0]).toEqual({ name: "Alice", age: 30 });
    });

    it("keeps non-numeric strings as strings", () => {
        const csv = `label\nhello\nworld`;
        const rows = parseCSV(csv);
        expect(rows[0].label).toBe("hello");
        expect(rows[1].label).toBe("world");
    });

    it("handles mixed types in same column — no coercion without columnTypes", () => {
        const csv = `value\n42\nhello\ntrue\n3.14`;
        const rows = parseCSV(csv);
        expect(rows[0].value).toBe("42");
        expect(rows[1].value).toBe("hello");
        expect(rows[2].value).toBe(true);
        expect(rows[3].value).toBe("3.14");
    });

    it("handles CSV with only whitespace rows", () => {
        const csv = `name\n   \n  \n`;
        const rows = parseCSV(csv);
        expect(rows).toEqual([]);
    });

    it("handles columns with different lengths", () => {
        const csv = `a,b,c\n1,2\n3,4,5,6`;
        const rows = parseCSV(csv, {
            a: "integer",
            b: "integer",
            c: "integer",
        });
        expect(rows[0]).toEqual({ a: 1, b: 2, c: undefined });
        expect(rows[1].a).toBe(3);
        expect(rows[1].b).toBe(4);
        expect(rows[1].c).toBe(5);
    });

    it("handles negative numbers with columnTypes", () => {
        const csv = `temp\n-10\n-3.5`;
        const rows = parseCSV(csv, { temp: "double" });
        expect(rows[0].temp).toBe(-10);
        expect(rows[1].temp).toBe(-3.5);
    });

    it("handles zero with columnTypes", () => {
        const csv = `value\n0\n0.0`;
        const rows = parseCSV(csv, { value: "double" });
        expect(rows[0].value).toBe(0);
        expect(rows[1].value).toBe(0);
    });

    it("keeps strings that look like numbers with text", () => {
        const csv = `code\n123abc\nabc123`;
        const rows = parseCSV(csv);
        expect(rows[0].code).toBe("123abc");
        expect(rows[1].code).toBe("abc123");
    });

    it("handles boolean case insensitivity", () => {
        const csv = `flag\nTrue\nFalse\nTRUE\nFALSE`;
        const rows = parseCSV(csv);
        expect(rows[0].flag).toBe(true);
        expect(rows[1].flag).toBe(false);
        expect(rows[2].flag).toBe(true);
        expect(rows[3].flag).toBe(false);
    });

    it("handles leading/trailing spaces in headers", () => {
        const csv = ` name , age , city \nAlice,30,NYC`;
        const rows = parseCSV(csv, { age: "integer" });
        expect(rows[0]).toEqual({ name: "Alice", age: 30, city: "NYC" });
    });

    it("string typeRef prevents number coercion for numeric-looking values", () => {
        const csv = `code\n42\n007`;
        const rows = parseCSV(csv, { code: "string" });
        expect(rows[0].code).toBe("42");
        expect(rows[1].code).toBe("007");
    });

    it("boolean typeRef coerces to boolean", () => {
        const csv = `active\ntrue\nfalse`;
        const rows = parseCSV(csv, { active: "boolean" });
        expect(rows[0].active).toBe(true);
        expect(rows[1].active).toBe(false);
    });
});

// ── aggregateBatchResults ───────────────────────────────────────────

describe("aggregateBatchResults", () => {
    it("counts successes and errors", () => {
        const rows: BatchRow[] = [
            {
                index: 0,
                inputData: {},
                result: "ok",
                trace: [
                    {
                        decisionId: "d1",
                        decisionName: "D1",
                        type: "decisionTable",
                        inputValues: {},
                        matchedRules: [],
                        result: "ok",
                    },
                ],
            },
            {
                index: 1,
                inputData: {},
                result: null,
                trace: [],
                error: "boom",
            },
        ];
        const agg = aggregateBatchResults(rows);
        expect(agg.totalRows).toBe(2);
        expect(agg.successRows).toBe(1);
        expect(agg.errorRows).toBe(1);
    });

    it("aggregates per-decision evaluation counts", () => {
        const rows: BatchRow[] = [
            {
                index: 0,
                inputData: {},
                result: "ok",
                trace: [
                    {
                        decisionId: "d1",
                        decisionName: "D1",
                        type: "decisionTable",
                        inputValues: {},
                        matchedRules: [],
                        result: "ok",
                    },
                    {
                        decisionId: "d2",
                        decisionName: "D2",
                        type: "literalExpression",
                        inputValues: {},
                        matchedRules: [],
                        result: 42,
                    },
                ],
            },
            {
                index: 1,
                inputData: {},
                result: "ok",
                trace: [
                    {
                        decisionId: "d1",
                        decisionName: "D1",
                        type: "decisionTable",
                        inputValues: {},
                        matchedRules: [],
                        result: "ok",
                    },
                ],
            },
        ];
        const agg = aggregateBatchResults(rows);
        expect(agg.decisions).toHaveLength(2);
        const d1 = agg.decisions.find((d) => d.decisionId === "d1");
        expect(d1?.evaluatedCount).toBe(2);
        const d2 = agg.decisions.find((d) => d.decisionId === "d2");
        expect(d2?.evaluatedCount).toBe(1);
    });

    it("handles empty batch", () => {
        const agg = aggregateBatchResults([]);
        expect(agg.totalRows).toBe(0);
        expect(agg.successRows).toBe(0);
        expect(agg.errorRows).toBe(0);
        expect(agg.decisions).toEqual([]);
    });
});

// ── parseCSV — quoted fields (RFC 4180) ─────────────────────────────

describe("parseCSV — quoted fields", () => {
    it("handles quoted field containing a comma", () => {
        const csv = `name,city\nAlice,"Berlin, Germany"`;
        const rows = parseCSV(csv);
        expect(rows[0]).toEqual({ name: "Alice", city: "Berlin, Germany" });
    });

    it("handles quoted field containing double-quotes (escaped)", () => {
        const csv = `name,quote\nAlice,"say ""hello"""`;
        const rows = parseCSV(csv);
        expect(rows[0]).toEqual({ name: "Alice", quote: 'say "hello"' });
    });

    it("handles fully quoted header and values", () => {
        const csv = `"name","value"\n"Alice",42`;
        const rows = parseCSV(csv, { value: "integer" });
        expect(rows[0]).toEqual({ name: "Alice", value: 42 });
    });

    it("handles mix of quoted and unquoted fields in same row", () => {
        const csv = `a,b,c\n1,"two,2",3`;
        const rows = parseCSV(csv, { a: "integer", c: "integer" });
        expect(rows[0]).toEqual({ a: 1, b: "two,2", c: 3 });
    });

    it("round-trips values exported by exportBatchAsCSV", () => {
        // exportBatchAsCSV quotes values with commas; parseCSV should recover them
        const csv = `#,name,Result,Error\n1,"Smith, John",ok,`;
        const rows = parseCSV(csv);
        expect(rows[0]["name"]).toBe("Smith, John");
    });
});

// ── getColumnTypes ──────────────────────────────────────────────────

describe("getColumnTypes", () => {
    it("returns typeRef map for decision table inputs", () => {
        const decisions = new Map<string, DmnDecision>();
        decisions.set("d1", {
            id: "d1",
            name: "D1",
            logic: {
                type: "decisionTable",
                hitPolicy: "UNIQUE",
                inputs: [
                    {
                        id: "i1",
                        label: "Name",
                        expression: "name",
                        typeRef: "string",
                    },
                    {
                        id: "i2",
                        label: "Age",
                        expression: "age",
                        typeRef: "integer",
                    },
                ],
                outputs: [{ id: "o1", name: "result", label: "Result" }],
                rules: [],
            },
            informationRequirements: [],
        });
        const model: DmnModel = {
            id: "def",
            name: "Test",
            namespace: "http://test",
            decisions,
        };
        const types = getColumnTypes(model, "d1");
        expect(types).toEqual({ name: "string", age: "integer" });
    });

    it("returns empty object for non-decision-table", () => {
        const decisions = new Map<string, DmnDecision>();
        decisions.set("d1", {
            id: "d1",
            name: "D1",
            logic: { type: "literalExpression", expression: "x + 1" },
            informationRequirements: [],
        });
        const model: DmnModel = {
            id: "def",
            name: "Test",
            namespace: "http://test",
            decisions,
        };
        expect(getColumnTypes(model, "d1")).toEqual({});
    });

    it("returns empty object when decision not found", () => {
        const model: DmnModel = {
            id: "def",
            name: "Test",
            namespace: "http://test",
            decisions: new Map(),
        };
        expect(getColumnTypes(model, "missing")).toEqual({});
    });

    it("uses expression as key when available, label as fallback", () => {
        const decisions = new Map<string, DmnDecision>();
        decisions.set("d1", {
            id: "d1",
            name: "D1",
            logic: {
                type: "decisionTable",
                hitPolicy: "UNIQUE",
                inputs: [
                    {
                        id: "i1",
                        label: "Name",
                        expression: "",
                        typeRef: "string",
                    },
                    {
                        id: "i2",
                        label: "Score",
                        expression: "score",
                        typeRef: "double",
                    },
                ],
                outputs: [],
                rules: [],
            },
            informationRequirements: [],
        });
        const model: DmnModel = {
            id: "def",
            name: "Test",
            namespace: "http://test",
            decisions,
        };
        const types = getColumnTypes(model, "d1");
        // expression="" falls back to label "Name"
        expect(types["Name"]).toBe("string");
        expect(types["score"]).toBe("double");
    });
});
