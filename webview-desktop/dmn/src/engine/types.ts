/**
 * Type coercion & validation for DMN values.
 *
 * Coerces evaluated FEEL results to DMN-declared types.
 */

/**
 * Coerce a value to the declared DMN type.
 *
 * @param value - The raw value from FEEL evaluation
 * @param typeRef - The DMN type reference (string, integer, boolean, double, long, date)
 * @returns The coerced value
 */
export function coerceValue(value: unknown, typeRef?: string): unknown {
    if (value === null || value === undefined || !typeRef) {
        return value;
    }

    const type = typeRef.toLowerCase();

    switch (type) {
        case "string":
            return String(value);

        case "integer":
        case "long": {
            const num = typeof value === "number" ? value : Number(value);
            if (isNaN(num)) return value;
            if (!Number.isInteger(num)) {
                throw new Error(
                    `Cannot coerce "${value}" to ${type}: not an integer value`
                );
            }
            return num;
        }

        case "double": {
            const num = typeof value === "number" ? value : Number(value);
            if (isNaN(num)) return value;
            return num;
        }

        case "boolean": {
            if (typeof value === "boolean") return value;
            if (typeof value === "string") {
                if (value.toLowerCase() === "true") return true;
                if (value.toLowerCase() === "false") return false;
            }
            return value;
        }

        case "date": {
            if (value instanceof Date) return value;
            if (typeof value === "string") {
                // Handle FEEL @"..." literal notation (e.g. @"2025-01-15")
                const feelLiteralMatch = value.match(/^@"(.+)"$/);
                const dateStr = feelLiteralMatch ? feelLiteralMatch[1] : value;

                // Only accept ISO 8601 date or datetime strings.
                // This prevents arbitrary strings like "Fri Jan 15 2025" from
                // being silently coerced into a Date.
                const isIso =
                    /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?)?$/.test(
                        dateStr
                    );
                if (isIso) {
                    const d = new Date(dateStr);
                    if (!isNaN(d.getTime())) return d;
                }
            }
            return value;
        }

        default:
            // typeRef is not in the known set — return value as-is but warn so
            // model configuration errors are not silently swallowed.
            console.warn(
                `[DMN type coercion] Unknown typeRef "${typeRef}" — value passed through unchanged.`
            );
            return value;
    }
}
