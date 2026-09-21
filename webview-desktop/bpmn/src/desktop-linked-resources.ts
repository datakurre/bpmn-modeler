import { invoke } from "@tauri-apps/api/core";

import {
    buildCallerLinks,
    buildMessageBackLinks,
    buildMessageLinks,
    extractElementReferences,
    extractProcessIds,
    resolveLinks,
    type IndexedResource,
    type ResolvedLink,
    type ResourceIndex,
} from "./linkedResources";

interface SiblingBpmnFile {
    relativePath: string;
    content: string;
}

/**
 * Reads every `.bpmn` file in the same directory as `path` (non-recursive —
 * linked-diagram lookup in the desktop app is intentionally scoped to the
 * folder of the file opened on the command line, unlike the VS Code
 * extension's workspace-wide scan).
 */
export async function loadSiblingBpmnFiles(path: string): Promise<Map<string, string>> {
    const files = await invoke<SiblingBpmnFile[]>("list_sibling_bpmn_files", { path });
    return new Map(files.map((file) => [file.relativePath, file.content]));
}

/**
 * Builds a process-only resource index from a directory's BPMN files.
 * Decisions/forms aren't indexed: the desktop app has no DMN/form editor to
 * open them in, so those link types are never resolved here.
 */
export async function buildDirectoryIndex(
    bpmnFileMap: Map<string, string>,
): Promise<ResourceIndex> {
    const processes: IndexedResource[] = [];
    for (const [relativePath, xml] of bpmnFileMap) {
        const ids = await extractProcessIds(xml);
        for (const id of ids) {
            processes.push({ id, relativePath, type: "process" });
        }
    }
    return { processes, decisions: [], forms: [] };
}

/**
 * Resolves all linked diagrams (forward CallActivity/message links, plus
 * caller/message back-links) for one diagram, mirroring `buildLinkedResources`
 * in `src/extension.ts`.
 */
export async function computeLinkedResources(
    xml: string,
    relativePath: string,
    index: ResourceIndex,
    bpmnFileMap: Map<string, string>,
): Promise<ResolvedLink[]> {
    const refs = await extractElementReferences(xml);
    const forwardLinks = resolveLinks(refs, index);
    const [backLinks, messageForwardLinks, messageBackLinks] = await Promise.all([
        buildCallerLinks(xml, relativePath, bpmnFileMap),
        buildMessageLinks(xml, relativePath, bpmnFileMap),
        buildMessageBackLinks(xml, relativePath, bpmnFileMap),
    ]);
    return [...forwardLinks, ...backLinks, ...messageForwardLinks, ...messageBackLinks];
}
