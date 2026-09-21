/**
 * Linked Resources — workspace file indexer.
 *
 * Scans the workspace for BPMN, DMN and Camunda Form files and builds an
 * index that maps identifiers to file paths. BPMN diagrams can then be
 * enriched with overlays that link to related files.
 *
 * Identifiers tracked:
 *  - **processId** — `<bpmn:process id="…">` and `<bpmn:participant processRef="…">` from `.bpmn` files
 *  - **decisionId** — `<decision id="…">` from `.dmn` files
 *  - **formKey** — `"id": "…"` from `.form` JSON files (Camunda 7 forms)
 *
 * Element references extracted from BPMN files (via bpmn-moddle):
 *  - `CallActivity` → `calledElement` attribute  (→ processId)
 *  - `BusinessRuleTask` → `camunda:decisionRef` attribute  (→ decisionId)
 *  - `UserTask` → `camunda:formKey` attribute  (→ formKey)
 *  - `UserTask` → `camunda:formRef` attribute  (→ formKey)
 *
 * Message-based links:
 *  - Sending elements (SendTask, EndEvent, IntermediateThrowEvent) → receiving files
 *  - Receiving elements (StartEvent, IntermediateCatchEvent, BoundaryEvent) ← back-links
 */

import { BpmnModdle } from "bpmn-moddle";
import camundaDescriptorRaw from "camunda-bpmn-moddle/resources/camunda.json";

// ---------------------------------------------------------------------------
// Moddle setup
// ---------------------------------------------------------------------------

// Patch the camunda descriptor to include `camunda:messageName` on SendTask
// (used by Camunda 7 but absent from the published camunda-bpmn-moddle schema).
const camundaDescriptor = {
    ...(camundaDescriptorRaw as any),
    types: (camundaDescriptorRaw as any).types.map((t: any) =>
        t.name === "ServiceTaskLike"
            ? {
                  ...t,
                  properties: [
                      ...t.properties,
                      { name: "messageName", isAttr: true, type: "String" },
                  ],
              }
            : t,
    ),
};

const moddle = new BpmnModdle({ camunda: camundaDescriptor });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single indexed resource (file ↔ id mapping). */
export interface IndexedResource {
    /** The identifier (process id, decision id, or form id). */
    readonly id: string;
    /** Workspace-relative path, e.g. `"processes/sub.bpmn"`. */
    readonly relativePath: string;
    /** The kind of resource. */
    readonly type: "process" | "decision" | "form";
}

/** Complete index of all resources found in the workspace. */
export interface ResourceIndex {
    readonly processes: IndexedResource[];
    readonly decisions: IndexedResource[];
    readonly forms: IndexedResource[];
}

/** A reference from a BPMN element to an external resource. */
export interface ElementReference {
    /** The BPMN element id (e.g. `"Task_1"`). */
    readonly elementId: string;
    /** The referenced identifier. */
    readonly refId: string;
    /** What kind of reference this is. */
    readonly refType: "process" | "decision" | "form";
}

/** Resolved link — a reference that has been matched to an indexed file. */
export interface ResolvedLink {
    readonly elementId: string;
    readonly refId: string;
    /**
     * `"caller"` is a back-link: another file calls into this process.
     * `"message"` is a forward-link: this element sends a message to another process.
     */
    readonly refType: "process" | "decision" | "form" | "caller" | "message";
    readonly targetPath: string;
}

/** The message payload sent to the webview. */
export interface LinkedResourcesMessage {
    readonly type: "linkedResources";
    readonly links: ResolvedLink[];
}

/** A single message-carrying element with its resolved message name. */
export interface MessageElement {
    /** The BPMN element id (e.g. `"SendTask_1"`). */
    readonly elementId: string;
    /** The resolved message name (e.g. `"OrderCreated"`). */
    readonly messageName: string;
}

// ---------------------------------------------------------------------------
// Internal moddle helpers
// ---------------------------------------------------------------------------

/** Parse BPMN XML with bpmn-moddle; returns null on parse failure. */
async function parseBpmn(xml: string): Promise<any | null> {
    try {
        const { rootElement } = await moddle.fromXML(xml);
        return rootElement;
    } catch {
        return null;
    }
}

/**
 * Walk all flowElements recursively (handles SubProcess / EventSubProcess
 * containment without needing to enumerate specific container types).
 */
function* allFlowElements(container: any): Generator<any> {
    for (const el of container.flowElements ?? []) {
        yield el;
        if (el.flowElements) yield* allFlowElements(el);
    }
}

/** Element types that send a message. */
const MESSAGE_SENDER_TYPES = new Set([
    "bpmn:SendTask",
    "bpmn:IntermediateThrowEvent",
    "bpmn:EndEvent",
]);

/** Element types that receive a message. */
const MESSAGE_RECEIVER_TYPES = new Set([
    "bpmn:StartEvent",
    "bpmn:IntermediateCatchEvent",
    "bpmn:BoundaryEvent",
]);

// ---------------------------------------------------------------------------
// BPMN extraction functions (moddle-based, async)
// ---------------------------------------------------------------------------

/**
 * Extract process ids from a BPMN file.
 * Covers `<bpmn:process id="…">` and `<bpmn:participant processRef="…">`.
 */
export async function extractProcessIds(bpmnXml: string): Promise<string[]> {
    const root = await parseBpmn(bpmnXml);
    if (!root) return [];
    const ids = new Set<string>();
    for (const el of root.rootElements ?? []) {
        if (el.$type === "bpmn:Process") ids.add(el.id);
        if (el.$type === "bpmn:Collaboration") {
            for (const p of el.participants ?? []) {
                if (p.processRef?.id) ids.add(p.processRef.id);
            }
        }
    }
    return [...ids];
}

/**
 * Extract the ids of all `<bpmn:startEvent>` elements in a BPMN file.
 * Used to anchor back-link badges in subprocess diagrams.
 */
export async function extractStartEventIds(bpmnXml: string): Promise<string[]> {
    const root = await parseBpmn(bpmnXml);
    if (!root) return [];
    const ids: string[] = [];
    for (const el of root.rootElements ?? []) {
        if (el.$type !== "bpmn:Process") continue;
        for (const fe of allFlowElements(el)) {
            if (fe.$type === "bpmn:StartEvent") ids.push(fe.id);
        }
    }
    return ids;
}

/**
 * Extract all element references from a BPMN file:
 *  - `CallActivity.calledElement` → process
 *  - `BusinessRuleTask.camunda:decisionRef` → decision
 *  - `UserTask.camunda:formKey` / `camunda:formRef` → form
 */
export async function extractElementReferences(bpmnXml: string): Promise<ElementReference[]> {
    const root = await parseBpmn(bpmnXml);
    if (!root) return [];

    const refs: ElementReference[] = [];
    const seen = new Set<string>();
    const add = (elementId: string, refId: string, refType: ElementReference["refType"]) => {
        const key = `${elementId}::${refId}::${refType}`;
        if (!seen.has(key)) {
            seen.add(key);
            refs.push({ elementId, refId, refType });
        }
    };

    for (const el of root.rootElements ?? []) {
        if (el.$type !== "bpmn:Process") continue;
        for (const fe of allFlowElements(el)) {
            if (fe.$type === "bpmn:CallActivity" && fe.calledElement) {
                add(fe.id, fe.calledElement, "process");
            }
            if (fe.$type === "bpmn:BusinessRuleTask" && fe.decisionRef) {
                add(fe.id, fe.decisionRef, "decision");
            }
            if (fe.$type === "bpmn:UserTask") {
                if (fe.formKey) add(fe.id, fe.formKey, "form");
                if (fe.formRef) add(fe.id, fe.formRef, "form");
            }
        }
    }
    return refs;
}

/**
 * Extract message-sending elements from a BPMN file.
 *
 * Covers:
 *  - `SendTask`, `IntermediateThrowEvent`, `EndEvent` with a child
 *    `MessageEventDefinition` whose `messageRef` resolves to a named message
 *  - `SendTask` with `camunda:messageName` (Camunda 7 shorthand)
 */
export async function extractMessageSenders(bpmnXml: string): Promise<MessageElement[]> {
    const root = await parseBpmn(bpmnXml);
    if (!root) return [];

    const results: MessageElement[] = [];
    const seen = new Set<string>();
    const add = (elementId: string, messageName: string) => {
        const key = `${elementId}::${messageName}`;
        if (!seen.has(key)) {
            seen.add(key);
            results.push({ elementId, messageName });
        }
    };

    for (const el of root.rootElements ?? []) {
        if (el.$type !== "bpmn:Process") continue;
        for (const fe of allFlowElements(el)) {
            if (!MESSAGE_SENDER_TYPES.has(fe.$type)) continue;
            const msgDef = (fe.eventDefinitions ?? []).find(
                (d: any) => d.$type === "bpmn:MessageEventDefinition",
            );
            if (msgDef?.messageRef?.name) add(fe.id, msgDef.messageRef.name);
            if (fe.messageRef?.name) add(fe.id, fe.messageRef.name);
            if (fe.messageName) add(fe.id, fe.messageName);
        }
    }
    return results;
}

/**
 * Extract message-receiving elements from a BPMN file.
 *
 * Covers:
 *  - `StartEvent` (incl. inside event subprocesses), `IntermediateCatchEvent`,
 *    `BoundaryEvent` with a child `MessageEventDefinition`
 *  - `StartEvent` with `camunda:messageName`
 */
export async function extractMessageStartEvents(bpmnXml: string): Promise<MessageElement[]> {
    const root = await parseBpmn(bpmnXml);
    if (!root) return [];

    const results: MessageElement[] = [];
    const seen = new Set<string>();
    const add = (elementId: string, messageName: string) => {
        const key = `${elementId}::${messageName}`;
        if (!seen.has(key)) {
            seen.add(key);
            results.push({ elementId, messageName });
        }
    };

    for (const el of root.rootElements ?? []) {
        if (el.$type !== "bpmn:Process") continue;
        for (const fe of allFlowElements(el)) {
            if (!MESSAGE_RECEIVER_TYPES.has(fe.$type)) continue;
            const msgDef = (fe.eventDefinitions ?? []).find(
                (d: any) => d.$type === "bpmn:MessageEventDefinition",
            );
            if (msgDef?.messageRef?.name) add(fe.id, msgDef.messageRef.name);
            if (fe.messageRef?.name) add(fe.id, fe.messageRef.name);
            if (fe.messageName) add(fe.id, fe.messageName);
        }
    }
    return results;
}

// ---------------------------------------------------------------------------
// DMN / Form parsers (sync, regex)
// ---------------------------------------------------------------------------

/**
 * Extract `<decision id="…">` ids from DMN XML.
 */
export function extractDecisionIds(dmnXml: string): string[] {
    const ids: string[] = [];
    const re = /<(?:dmn:)?decision\s[^>]*id\s*=\s*"([^"]+)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(dmnXml)) !== null) {
        ids.push(m[1]);
    }
    return ids;
}

/**
 * Extract a form id from a Camunda `.form` JSON file.
 */
export function extractFormId(formJson: string): string | undefined {
    try {
        const parsed = JSON.parse(formJson);
        if (typeof parsed.id === "string" && parsed.id) return parsed.id;
        if (typeof parsed.key === "string" && parsed.key) return parsed.key;
    } catch {
        /* not valid JSON — skip */
    }
    return undefined;
}

// ---------------------------------------------------------------------------
// Resolve references against index
// ---------------------------------------------------------------------------

/**
 * Match element references to indexed resources, producing resolved links.
 */
export function resolveLinks(refs: ElementReference[], index: ResourceIndex): ResolvedLink[] {
    const processMap = new Map(index.processes.map((r) => [r.id, r.relativePath]));
    const decisionMap = new Map(index.decisions.map((r) => [r.id, r.relativePath]));
    const formMap = new Map(index.forms.map((r) => [r.id, r.relativePath]));

    const links: ResolvedLink[] = [];
    for (const ref of refs) {
        let target: string | undefined;
        switch (ref.refType) {
            case "process":
                target = processMap.get(ref.refId);
                break;
            case "decision":
                target = decisionMap.get(ref.refId);
                break;
            case "form":
                target = formMap.get(ref.refId);
                break;
        }
        if (target) {
            links.push({
                elementId: ref.elementId,
                refId: ref.refId,
                refType: ref.refType,
                targetPath: target,
            });
        }
    }
    return links;
}

// ---------------------------------------------------------------------------
// Caller back-links (call-activity)
// ---------------------------------------------------------------------------

/**
 * Caller index entry — one BPMN file that contains a callActivity referencing
 * a known process id.
 */
export interface CallerEntry {
    readonly callerPath: string;
    readonly calledProcessId: string;
}

/**
 * Build back-links (caller badges) for the current BPMN document.
 *
 * For each process id defined in `currentBpmnXml`, scans `allBpmnFiles` for
 * callActivities targeting that process id. Produces a ResolvedLink with
 * `refType: "caller"` placed on the process's first start event.
 */
export async function buildCallerLinks(
    currentBpmnXml: string,
    currentRelativePath: string,
    allBpmnFiles: Map<string, string>,
): Promise<ResolvedLink[]> {
    const root = await parseBpmn(currentBpmnXml);
    if (!root) return [];

    const myProcessIds = new Set<string>();
    const startEventByProcess = new Map<string, string>();

    for (const el of root.rootElements ?? []) {
        if (el.$type === "bpmn:Process") {
            myProcessIds.add(el.id);
            for (const fe of allFlowElements(el)) {
                if (fe.$type === "bpmn:StartEvent" && !startEventByProcess.has(el.id)) {
                    startEventByProcess.set(el.id, fe.id);
                    break;
                }
            }
        }
        if (el.$type === "bpmn:Collaboration") {
            for (const p of el.participants ?? []) {
                if (p.processRef?.id) myProcessIds.add(p.processRef.id);
            }
        }
    }

    if (myProcessIds.size === 0) return [];

    const entries = [...allBpmnFiles].filter(([path]) => path !== currentRelativePath);
    const parsed = await Promise.all(
        entries.map(([path, xml]) => parseBpmn(xml).then((r) => ({ path, root: r }))),
    );

    const callerLinks: ResolvedLink[] = [];
    for (const { path, root: callerRoot } of parsed) {
        if (!callerRoot) continue;
        for (const el of callerRoot.rootElements ?? []) {
            if (el.$type !== "bpmn:Process") continue;
            for (const fe of allFlowElements(el)) {
                if (
                    fe.$type === "bpmn:CallActivity" &&
                    fe.calledElement &&
                    myProcessIds.has(fe.calledElement)
                ) {
                    const elementId = startEventByProcess.get(fe.calledElement);
                    if (elementId) {
                        callerLinks.push({
                            elementId,
                            refId: fe.calledElement,
                            refType: "caller",
                            targetPath: path,
                        });
                    }
                }
            }
        }
    }
    return callerLinks;
}

// ---------------------------------------------------------------------------
// Message-based links
// ---------------------------------------------------------------------------

/**
 * Build forward message links for the current BPMN document.
 *
 * For each sending element in the current file, finds BPMN files that contain
 * a receiving element with the same message name. Produces a forward link with
 * `refType: "message"`.
 */
export async function buildMessageLinks(
    currentBpmnXml: string,
    currentRelativePath: string,
    allBpmnFiles: Map<string, string>,
): Promise<ResolvedLink[]> {
    const senders = await extractMessageSenders(currentBpmnXml);
    if (senders.length === 0) return [];

    const sendersByName = new Map<string, string[]>();
    for (const s of senders) {
        const ids = sendersByName.get(s.messageName) ?? [];
        ids.push(s.elementId);
        sendersByName.set(s.messageName, ids);
    }

    const entries = [...allBpmnFiles].filter(([path]) => path !== currentRelativePath);
    const links: ResolvedLink[] = [];
    const seen = new Set<string>();

    await Promise.all(
        entries.map(async ([targetPath, targetXml]) => {
            const receivers = await extractMessageStartEvents(targetXml);
            for (const se of receivers) {
                const elementIds = sendersByName.get(se.messageName);
                if (elementIds) {
                    for (const elementId of elementIds) {
                        const key = `${elementId}::${targetPath}`;
                        if (!seen.has(key)) {
                            seen.add(key);
                            links.push({
                                elementId,
                                refId: se.messageName,
                                refType: "message",
                                targetPath,
                            });
                        }
                    }
                }
            }
        }),
    );
    return links;
}

/**
 * Build message back-links for the current BPMN document.
 *
 * For each receiving element in the current file, finds BPMN files that
 * contain sending elements with the same message name. Produces a back-link
 * with `refType: "caller"` so it appears identical to call-activity backlinks.
 */
export async function buildMessageBackLinks(
    currentBpmnXml: string,
    currentRelativePath: string,
    allBpmnFiles: Map<string, string>,
): Promise<ResolvedLink[]> {
    const receivers = await extractMessageStartEvents(currentBpmnXml);
    if (receivers.length === 0) return [];

    const startEventByName = new Map<string, string>();
    for (const se of receivers) {
        if (!startEventByName.has(se.messageName))
            startEventByName.set(se.messageName, se.elementId);
    }
    const receiverNames = new Set(receivers.map((s) => s.messageName));

    const entries = [...allBpmnFiles].filter(([path]) => path !== currentRelativePath);
    const links: ResolvedLink[] = [];

    await Promise.all(
        entries.map(async ([senderPath, senderXml]) => {
            const senders = await extractMessageSenders(senderXml);
            for (const sender of senders) {
                if (receiverNames.has(sender.messageName)) {
                    const elementId = startEventByName.get(sender.messageName)!;
                    links.push({
                        elementId,
                        refId: sender.messageName,
                        refType: "caller",
                        targetPath: senderPath,
                    });
                }
            }
        }),
    );
    return links;
}
