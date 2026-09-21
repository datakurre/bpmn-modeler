declare module "bpmn-js-properties-panel" {
    export const useService: any;
}

declare module "@bpmn-io/properties-panel" {
    export const isSelectEntryEdited: any;
    export const SelectEntry: any;
}

declare module "@bpmn-io/properties-panel/preact" {
    export function h(type: any, props?: any, ...children: any[]): any;
    export function render(vnode: any, parent: Element): void;
}

declare module "@bpmn-io/properties-panel/preact/hooks" {
    export function useState<T>(initial: T | (() => T)): [T, (v: T | ((prev: T) => T)) => void];
    export function useEffect(effect: () => void | (() => void), deps?: any[]): void;
    export function useCallback<T extends Function>(cb: T, deps: any[]): T;
    export function useMemo<T>(factory: () => T, deps: any[]): T;
}

declare module "camunda-bpmn-js-behaviors/lib/util/ElementUtil" {
    export const createElement: any;
}

declare module "@bpmn-io/element-template-chooser" {
    const mod: any;
    export default mod;
}

declare module "bpmn-js-token-simulation" {
    const mod: any;
    export default mod;
}

declare module "bpmn-js-create-append-anything" {
    export const CreateAppendElementTemplatesModule: any;
}

declare module "camunda-modeler-robot-plugin/dist/module" {
    const mod: any;
    export default mod;
}

declare module "bpmn-js-differ" {
    export function diff(oldDefinitions: any, newDefinitions: any): any;
}

declare module "bpmn-moddle" {
    export class BpmnModdle {
        fromXML(xml: string): Promise<{ rootElement: any }>;
    }
}

declare module "diagram-js-minimap" {
    const mod: any;
    export default mod;
}
