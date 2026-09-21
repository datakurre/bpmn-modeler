import DmnModeler, { DiagramWarning } from "dmn-js/lib/Modeler";
import {
    DmnPropertiesPanelModule,
    DmnPropertiesProviderModule,
} from "dmn-js-properties-panel";

let modeler: DmnModeler | undefined;

export function createModeler(): DmnModeler {
    modeler = new DmnModeler({
        drd: {
            propertiesPanel: {
                parent: "#js-properties-panel",
            },
            additionalModules: [
                DmnPropertiesPanelModule,
                DmnPropertiesProviderModule,
            ],
        },
        common: {
            expressionLanguages: {
                options: [
                    { value: "feel", label: "FEEL" },
                    { value: "juel", label: "JUEL" },
                    { value: "javascript", label: "JavaScript" },
                    { value: "groovy", label: "Groovy" },
                    { value: "python", label: "Python" },
                    { value: "jruby", label: "JRuby" },
                ],
                defaults: {
                    editor: "feel",
                },
            },
            dataTypes: [
                "string",
                "boolean",
                "integer",
                "long",
                "double",
                "date",
            ],
        },
        container: "#js-canvas",
        keyboard: {
            bindTo: document,
        },
    });

    return modeler;
}

/**
 * Load a DMN diagram from XML.
 * @throws Error if modeler is not initialized or import fails
 */
export async function loadDiagram(dmn: string): Promise<DiagramWarning> {
    try {
        const m = getModeler();
        return await m.importXML(dmn);
    } catch (error) {
        if ((error as DiagramWarning).warnings) {
            const diagramWarning = error as DiagramWarning;
            let errorMsg = "";
            diagramWarning.warnings.forEach((warning) => {
                errorMsg += `${warning.message}\n${warning.error.message}\n${warning.error.stack}\n`;
            });
            throw new Error(errorMsg);
        }
        throw error;
    }
}

/**
 * Export the current DMN diagram as XML.
 * @throws Error if modeler is not initialized or export fails
 */
export async function exportDiagram(): Promise<string> {
    const m = getModeler();
    const result = await m.saveXML({ format: true });
    if (result.xml) {
        return result.xml;
    }
    throw new Error("Failed to save changes made to the diagram!");
}

/**
 * Subscribe to command stack changes across all DMN views.
 * Tracks registered viewers to avoid accumulating duplicate listeners
 * when the user switches views multiple times.
 */
export function onCommandStackChanged(cb: () => void): void {
    const m = getModeler();
    const registeredViewers = new WeakSet();
    m.on("views.changed", () => {
        const activeEditor = m.getActiveViewer();
        if (!registeredViewers.has(activeEditor)) {
            registeredViewers.add(activeEditor);
            activeEditor.get("eventBus").on("commandStack.changed", cb);
        }
    });
}

function getModeler(): DmnModeler {
    if (!modeler) {
        throw new Error("DMN modeler is not initialized!");
    }
    return modeler;
}

/**
 * Get the current DmnModeler instance, or null if not initialized.
 */
export function getModelerInstance(): DmnModeler | undefined {
    return modeler;
}

/**
 * Highlight matched rules in the current decision table view.
 * @param ruleIds - Array of rule IDs to highlight
 */
export function highlightMatchedRules(ruleIds: string[]): void {
    if (!modeler) return;

    const container = document.querySelector("#js-canvas");
    if (!container) return;

    // Query all cells with data-row-id matching the rule IDs
    for (const ruleId of ruleIds) {
        const cells = container.querySelectorAll(`[data-row-id="${ruleId}"]`);
        cells.forEach((cell) => {
            if (cell instanceof HTMLElement) {
                cell.classList.add("matched-rule");
            }
        });
    }
}

/**
 * Highlight conflicting rules (e.g. UNIQUE hit policy violation) in the
 * current decision table view using the conflict/orange style.
 * @param ruleIds - Array of rule IDs to highlight as conflicting
 */
export function highlightConflictingRules(ruleIds: string[]): void {
    if (!modeler) return;

    const container = document.querySelector("#js-canvas");
    if (!container) return;

    for (const ruleId of ruleIds) {
        const cells = container.querySelectorAll(`[data-row-id="${ruleId}"]`);
        cells.forEach((cell) => {
            if (cell instanceof HTMLElement) {
                cell.classList.add("conflicting-rule");
            }
        });
    }
}

/**
 * Clear all rule highlights from the decision table.
 */
export function clearMatchedRuleHighlights(): void {
    const container = document.querySelector("#js-canvas");
    if (!container) return;

    container
        .querySelectorAll(".matched-rule, .conflicting-rule")
        .forEach((cell) => {
            if (cell instanceof HTMLElement) {
                cell.classList.remove("matched-rule", "conflicting-rule");
            }
        });
}

/**
 * Navigate to a specific decision table view.
 * @param decisionId - The ID of the decision to navigate to
 * @returns true if navigation was successful
 */
export async function navigateToDecisionTable(
    decisionId: string
): Promise<boolean> {
    if (!modeler) return false;

    try {
        const views = modeler.getViews?.() ?? [];
        const tableView = views.find(
            (v: any) =>
                v.type === "decisionTable" && v.element?.id === decisionId
        );

        if (!tableView) {
            return false;
        }

        await modeler.open(tableView);

        // Wait for DOM update
        await new Promise((resolve) => setTimeout(resolve, 50));

        return true;
    } catch {
        return false;
    }
}
