import { layoutProcess } from "bpmn-auto-layout";

/**
 * Tauri-only adapter for the vendored auto-layout package. Keeping this
 * integration outside modeler.ts prevents the VS Code webview bundle from
 * loading the desktop-only layout implementation.
 */
export function layoutDesktopDiagram(xml: string): Promise<string> {
    return layoutProcess(xml);
}
