/**
 * Minimal ambient type declaration for the `dmn-moddle` package.
 * The package ships no TypeScript types; this declaration gives the compiler
 * enough information to allow `import { DmnModdle } from "dmn-moddle"` and
 * call its two public APIs without resorting to `skipLibCheck` workarounds.
 */
declare module "dmn-moddle" {
    /** The root element returned by `moddle.fromXML()`. */
    export interface DmnModdleRoot {
        $type: string;
        id: string;
        name?: string;
        namespace?: string;
        drgElement?: DmnModdleElement[];
        [key: string]: unknown;
    }

    /** A generic moddle element (decision, table, rule, input, output …). */
    export interface DmnModdleElement {
        $type: string;
        id: string;
        name?: string;
        [key: string]: unknown;
    }

    export interface FromXMLResult {
        rootElement: DmnModdleRoot;
        elementsById: Record<string, DmnModdleElement>;
        references: unknown[];
        warnings: unknown[];
    }

    export class DmnModdle {
        constructor(packages?: Record<string, unknown>);
        fromXML(xml: string): Promise<FromXMLResult>;
        toXML(element: DmnModdleRoot, options?: unknown): Promise<{ xml: string }>;
    }
}
