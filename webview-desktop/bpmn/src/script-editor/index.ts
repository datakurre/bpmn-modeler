/**
 * Script Editor module — bpmn-js module descriptor.
 *
 * Registers `scriptTextareaDecorator` which watches the properties panel
 * for script textareas and injects ↗ badge icons that open them in
 * VS Code temporary files with full language support.
 */

import { ScriptTextareaDecorator } from "./ScriptTextareaDecorator";

export { ScriptTextareaDecorator } from "./ScriptTextareaDecorator";

export const ScriptEditorModule = {
    __init__: ["scriptTextareaDecorator"],
    scriptTextareaDecorator: ["type", ScriptTextareaDecorator],
};
