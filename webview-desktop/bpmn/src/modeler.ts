import Modeler from "camunda-bpmn-js/lib/base/Modeler";
import BpmnModeler from "camunda-bpmn-js/lib/camunda-platform/Modeler";
import { ImportXMLError, ImportXMLResult, SaveXMLResult } from "bpmn-js/lib/BaseViewer";
import TokenSimulationModule from "bpmn-js-token-simulation";
import ElementTemplateChooserModule from "@bpmn-io/element-template-chooser";
/* @ts-expect-error - RobotModule does not have type definitions */
import RobotModule from "camunda-modeler-robot-plugin/dist/module";
import { CreateAppendElementTemplatesModule } from "bpmn-js-create-append-anything";
/* @ts-expect-error - TransactionBoundariesModule does not have type definitions */
import TransactionBoundariesModule from "camunda-transaction-boundaries/lib";
/* @ts-expect-error - bpmnlintModule does not have type definitions */
import bpmnlintModule from "bpmn-js-bpmnlint";
import "bpmn-js-bpmnlint/dist/assets/css/bpmn-js-bpmnlint.css";
/* @ts-expect-error - ElementTemplateIconRendererModule does not have type definitions */
import ElementTemplateIconRendererModule from "@bpmn-io/element-template-icon-renderer";

import { ExtendElementTemplates } from "./element-templates";
import { LinkedResourceOverlaysModule, LinkedResourceOverlays } from "./linked-resources";
import { ScriptEditorModule, ScriptTextareaDecorator } from "./script-editor";
import { EmbeddedCommentsModule, EmbeddedCommentsModdleExtension } from "./embedded-comments";
import camundaWithIconModdle from "./element-templates/camundaWithIconModdle";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BpmnModelerSetting {
    readonly alignToOrigin: boolean;
    readonly darkTheme: boolean;
    readonly transactionBoundaries: boolean;
    readonly linting: boolean;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const DEFAULT_SETTINGS: BpmnModelerSetting = {
    alignToOrigin: false,
    darkTheme: false,
    transactionBoundaries: false,
    linting: true,
};

let modeler: Modeler | undefined;
let settings: BpmnModelerSetting = DEFAULT_SETTINGS;
let bpmnlintConfig: any = null;

const modelerOptions = {
    container: "#js-canvas",
    propertiesPanel: {
        parent: "#js-properties-panel",
    },
    alignToOrigin: {
        alignOnSave: false,
        offset: 150,
        tolerance: 50,
    },
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function createModeler(options: { minimal?: boolean; comments?: boolean } = {}): Modeler {
    const additionalModules = [
        ElementTemplateChooserModule,
        ElementTemplateIconRendererModule,
        ExtendElementTemplates,
        CreateAppendElementTemplatesModule,
    ];

    if (!options.minimal) {
        additionalModules.push(
            TokenSimulationModule,
            RobotModule,
            LinkedResourceOverlaysModule,
            ScriptEditorModule,
            TransactionBoundariesModule,
        );

        if (options.comments !== false) {
            additionalModules.push(EmbeddedCommentsModule);
        }
    }

    // Add bpmnlint if linting is enabled and config exists
    if (settings.linting && bpmnlintConfig) {
        additionalModules.push(bpmnlintModule);
    }

    const modelerConfig: any = {
        ...modelerOptions,
        additionalModules,
        moddleExtensions: {
            ...(options.comments === false ? {} : { doc: EmbeddedCommentsModdleExtension }),
            camunda: camundaWithIconModdle,
        },
        elementTemplateIconRenderer: {
            iconProperty: "camunda:modelerTemplateIcon",
        },
    };

    // Add linting configuration if available
    if (bpmnlintConfig) {
        modelerConfig.linting = {
            bpmnlint: bpmnlintConfig,
            active: settings.linting,
        };
    }

    modeler = new BpmnModeler(modelerConfig);

    // Set initial transaction boundaries visibility
    if (modeler && settings.transactionBoundaries) {
        try {
            const transactionBoundaries = modeler.get<any>("transactionBoundaries");
            if (transactionBoundaries) {
                transactionBoundaries.show();
            }
        } catch (e) {
            // Transaction boundaries service might not be available yet
        }
    }

    return modeler;
}

export function onCommandStackChanged(cb: () => void) {
    getModeler().get<any>("eventBus").on("commandStack.changed", cb);
}

export function undoDiagram(): void {
    getModeler().get<any>("commandStack").undo();
}

export function redoDiagram(): void {
    getModeler().get<any>("commandStack").redo();
}

/** Expose the current modeler instance for viewport state access. */
export function getModelerInstance(): Modeler | undefined {
    return modeler;
}

/**
 * bpmn-js-embedded-comments mutates the moddle directly without going through
 * the command stack, so changes to comments must be synced separately.
 */
export function onCommentsUpdated(cb: () => void) {
    getModeler().get<any>("eventBus").on("comments.updated", cb);
}

export async function newDiagram(): Promise<ImportXMLResult> {
    return getModeler().createDiagram();
}

export async function loadDiagram(bpmn: string): Promise<ImportXMLResult> {
    try {
        return await getModeler().importXML(bpmn);
    } catch (error: unknown) {
        if ((error as ImportXMLError).warnings) {
            const { message, warnings } = error as ImportXMLError;
            throw Error(`${message} ${warnings}`);
        }
        throw error;
    }
}

export async function exportDiagram(): Promise<string> {
    const result: SaveXMLResult = await getModeler().saveXML({ format: true });
    if (result.xml) return result.xml;
    if (result.error) throw result.error;
    throw Error("Failed to save diagram");
}

export async function getDiagramSvg(): Promise<string> {
    const result = await getModeler().saveSVG();
    return result.svg;
}

export function setElementTemplates(templates: any[] | undefined) {
    if (!templates) return;
    getModeler().get<any>("elementTemplatesLoader").setTemplates(templates);
}

export function getLinkedResourceOverlays(): LinkedResourceOverlays {
    return getModeler().get<any>("linkedResourceOverlays");
}

export function getScriptTextareaDecorator(): ScriptTextareaDecorator {
    return getModeler().get<any>("scriptTextareaDecorator");
}

export function setSettings(newSettings: Partial<BpmnModelerSetting> | undefined) {
    if (!newSettings || !modeler) return;

    const oldSettings = settings;
    settings = { ...settings, ...newSettings };

    setTheme();

    // Handle transaction boundaries toggle
    if (oldSettings.transactionBoundaries !== settings.transactionBoundaries) {
        toggleTransactionBoundaries(settings.transactionBoundaries);
    }

    // Handle linting toggle
    if (oldSettings.linting !== settings.linting) {
        toggleLinting(settings.linting);
    }
}

export function setBpmnlintConfig(config: any) {
    bpmnlintConfig = config;
    if (modeler && config) {
        const linting = modeler.get<any>("linting");
        if (linting) {
            linting.setLinterConfig(config);
            if (settings.linting) {
                linting.toggle(true);
            }
        }
    }
}

export function toggleTransactionBoundaries(show?: boolean) {
    if (!modeler) return;
    try {
        const transactionBoundaries = modeler.get<any>("transactionBoundaries");
        if (transactionBoundaries) {
            const shouldShow = show !== undefined ? show : !settings.transactionBoundaries;
            if (shouldShow) {
                transactionBoundaries.show();
            } else {
                transactionBoundaries.hide();
            }
            settings = { ...settings, transactionBoundaries: shouldShow };
        }
    } catch (e) {
        console.warn("Transaction boundaries not available:", e);
    }
}

export function toggleLinting(enabled?: boolean) {
    if (!modeler) return;
    try {
        const linting = modeler.get<any>("linting");
        if (linting) {
            const shouldEnable = enabled !== undefined ? enabled : !settings.linting;
            linting.toggle(shouldEnable);
            settings = { ...settings, linting: shouldEnable };
        }
    } catch (e) {
        console.warn("Linting not available:", e);
    }
}

export function alignElementsToOrigin() {
    if (settings.alignToOrigin) {
        getModeler().get<any>("alignToOrigin").align();
    }
}

export function fitDiagramToViewport() {
    const canvas = getModeler().get<any>("canvas");
    canvas.resized();
    canvas.zoom("fit-viewport");
}

// ---------------------------------------------------------------------------
// Private
// ---------------------------------------------------------------------------

function setTheme() {
    const link = document.querySelector<HTMLLinkElement>("#theme-link");
    if (!link) return;

    const css = link.href.split("/").pop();
    if (settings.darkTheme && css === "lightTheme.css") {
        link.href = link.href.replace(/lightTheme\.css$/, "darkTheme.css");
    } else if (!settings.darkTheme && css === "darkTheme.css") {
        link.href = link.href.replace(/darkTheme\.css$/, "lightTheme.css");
    }
}

function getModeler(): Modeler {
    if (!modeler) throw new Error("Modeler is not initialized!");
    return modeler;
}
