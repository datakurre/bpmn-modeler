import { describe, it, expect } from "vitest";
import { coerceValue } from "./types";

describe("coerceValue", () => {
    it("returns value unchanged when typeRef is undefined", () => {
        expect(coerceValue("hello")).toBe("hello");
        expect(coerceValue(42)).toBe(42);
        expect(coerceValue(null)).toBe(null);
    });

    it("returns null/undefined unchanged", () => {
        expect(coerceValue(null, "string")).toBe(null);
        expect(coerceValue(undefined, "integer")).toBe(undefined);
    });

    describe("string coercion", () => {
        it("converts numbers to strings", () => {
            expect(coerceValue(42, "string")).toBe("42");
        });

        it("converts booleans to strings", () => {
            expect(coerceValue(true, "string")).toBe("true");
        });

        it("keeps strings as strings", () => {
            expect(coerceValue("hello", "string")).toBe("hello");
        });
    });

    describe("integer coercion", () => {
        it("keeps integers unchanged", () => {
            expect(coerceValue(42, "integer")).toBe(42);
            expect(coerceValue(-3, "integer")).toBe(-3);
            expect(coerceValue(0, "integer")).toBe(0);
        });

        it("rejects non-integer numbers (reference: IntegerDataTypeTransformer)", () => {
            expect(() => coerceValue(3.7, "integer")).toThrow("not an integer");
            expect(() => coerceValue(-0.5, "integer")).toThrow();
            expect(() => coerceValue(3.7, "long")).toThrow("not an integer");
        });

        it("parses integer strings", () => {
            expect(coerceValue("42", "integer")).toBe(42);
        });

        it("rejects non-integer strings", () => {
            expect(() => coerceValue("3.7", "integer")).toThrow(
                "not an integer"
            );
        });

        it("returns NaN strings unchanged", () => {
            expect(coerceValue("abc", "integer")).toBe("abc");
        });

        it("handles negative numbers", () => {
            expect(coerceValue(-3, "integer")).toBe(-3);
        });
    });

    describe("long coercion", () => {
        it("keeps integers unchanged", () => {
            expect(coerceValue(100, "long")).toBe(100);
        });

        it("rejects non-integer numbers", () => {
            expect(() => coerceValue(3.7, "long")).toThrow("not an integer");
        });
    });

    describe("double coercion", () => {
        it("keeps decimals", () => {
            expect(coerceValue(3.14, "double")).toBe(3.14);
        });

        it("parses string numbers", () => {
            expect(coerceValue("3.14", "double")).toBe(3.14);
        });

        it("returns NaN strings unchanged", () => {
            expect(coerceValue("abc", "double")).toBe("abc");
        });
    });

    describe("boolean coercion", () => {
        it("keeps booleans", () => {
            expect(coerceValue(true, "boolean")).toBe(true);
            expect(coerceValue(false, "boolean")).toBe(false);
        });

        it("parses string booleans", () => {
            expect(coerceValue("true", "boolean")).toBe(true);
            expect(coerceValue("false", "boolean")).toBe(false);
            expect(coerceValue("TRUE", "boolean")).toBe(true);
        });

        it("returns non-boolean values unchanged", () => {
            expect(coerceValue(42, "boolean")).toBe(42);
        });
    });

    describe("date coercion", () => {
        it("parses ISO date strings", () => {
            const result = coerceValue("2025-01-15", "date");
            expect(result).toBeInstanceOf(Date);
        });

        it("parses ISO datetime strings", () => {
            const result = coerceValue("2025-01-15T10:30:00", "date");
            expect(result).toBeInstanceOf(Date);
        });

        it("parses ISO datetime strings with timezone", () => {
            const result = coerceValue("2025-01-15T10:30:00Z", "date");
            expect(result).toBeInstanceOf(Date);
            const result2 = coerceValue("2025-01-15T10:30:00+02:00", "date");
            expect(result2).toBeInstanceOf(Date);
        });

        it('parses FEEL @"..." literal notation', () => {
            const result = coerceValue('@"2025-01-15"', "date");
            expect(result).toBeInstanceOf(Date);
        });

        it("keeps Date objects", () => {
            const d = new Date("2025-01-15");
            expect(coerceValue(d, "date")).toBe(d);
        });

        it("returns non-ISO date strings unchanged", () => {
            // Arbitrary human-readable string is rejected
            expect(coerceValue("Jan 15, 2025", "date")).toBe("Jan 15, 2025");
        });

        it("returns invalid date strings unchanged", () => {
            expect(coerceValue("not-a-date", "date")).toBe("not-a-date");
        });
    });

    describe("unknown type", () => {
        it("returns value unchanged for unknown typeRef", () => {
            expect(coerceValue(42, "custom")).toBe(42);
        });
    });
});
