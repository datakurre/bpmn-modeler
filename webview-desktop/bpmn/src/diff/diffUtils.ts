/**
 * Pure utilities for interpreting bpmn-js-differ attr entries.
 *
 * bpmn-js-differ uses inconsistent oldValue/newValue naming across change types:
 *
 *   Modify (both values exist): oldValue = After (new), newValue = Before (old)  — INVERTED
 *   Add    (property created):  oldValue = undefined,   newValue = the added value (After)
 *   Delete (property removed):  oldValue = 0 (sentinel), newValue = the deleted value (Before)
 */

/**
 * Resolve the semantic Before/After display values from a bpmn-js-differ attr entry.
 * Returns { before, after } in natural display order regardless of change type.
 */
export function resolveAttrBeforeAfter(attr: { oldValue: any; newValue: any }): {
    before: any;
    after: any;
} {
    if (attr.oldValue === undefined) {
        // Addition: property didn't exist before
        return { before: undefined, after: attr.newValue };
    } else if (attr.oldValue === 0 && attr.newValue !== undefined) {
        // Deletion: oldValue=0 is jsondiffpatch's delete sentinel
        return { before: attr.newValue, after: undefined };
    } else {
        // Modification: inverted naming — oldValue=After, newValue=Before
        return { before: attr.newValue, after: attr.oldValue };
    }
}

// ─── Business object restoration ─────────────────────────────────────────────

/**
 * Apply old (Before) attribute values to a business object in place.
 *
 * Used by showOldAttrs to temporarily revert an element's display to its old/Before state.
 * Handles all three bpmn-js-differ change types:
 *
 *   Modification: attr.newValue = Before value (due to inversion) → set on BO
 *   Deletion:     attr.newValue = the removed Before value → set on BO
 *   Addition:     attr.oldValue = undefined → property didn't exist in old; delete from BO
 */
export function applyOldAttrsToBO(
    bo: Record<string, any>,
    attrs: Record<string, { oldValue: any; newValue: any }>,
): void {
    for (const [key, attr] of Object.entries(attrs)) {
        if (attr.oldValue === undefined) {
            // Addition: old state = property didn't exist
            delete bo[key];
        } else {
            // Modification or Deletion: old value is in attr.newValue
            bo[key] = attr.newValue;
        }
    }
}

// ─── Extension element augmentation ──────────────────────────────────────────

/**
 * Build a flat index of all BPMN elements (by id) from a definitions object.
 * Skips DI elements and avoids $parent circular refs.
 */
function buildElementIndex(definitions: any): Map<string, any> {
    const index = new Map<string, any>();
    const visited = new Set<any>();
    function traverse(obj: any): void {
        if (!obj || typeof obj !== "object" || visited.has(obj)) return;
        visited.add(obj);
        const t: string = obj.$type ?? "";
        if (
            obj.id &&
            typeof obj.id === "string" &&
            !t.startsWith("bpmndi:") &&
            !t.startsWith("dc:") &&
            !t.startsWith("di:")
        ) {
            index.set(obj.id, obj);
        }
        for (const key of Object.keys(obj)) {
            if (key === "$parent") continue;
            const val = obj[key];
            if (Array.isArray(val)) val.forEach(traverse);
            else if (val && typeof val === "object") traverse(val);
        }
    }
    traverse(definitions);
    return index;
}

/**
 * JSON replacer that strips circular BPMN moddle references.
 */
function bpmnSafeReplacer(key: string, val: any): any {
    if (key === "$parent" || key === "di" || key === "$descriptor" || key === "$model")
        return undefined;
    return val;
}

/**
 * Augment the diff result with extensionElements changes that bpmn-js-differ silently misses.
 *
 * Walks all elements in newDefinitions, compares extensionElements with the corresponding old
 * element, and writes synthetic attr entries keyed as "extensionElements[values]".
 *
 * Uses NATURAL naming — intentionally different from bpmn-js-differ's inverted convention:
 *   oldValue = value in old diagram (Before)
 *   newValue = value in new diagram (After)
 *
 * IMPORTANT: renderRow in diffOverlays.ts must NOT apply resolveAttrBeforeAfter to these entries,
 * because they already use natural (non-inverted) naming.
 */
export function augmentExtensionElementChanges(
    changes: {
        _changed: Record<
            string,
            { model: any; attrs: Record<string, { oldValue: any; newValue: any }> }
        >;
    },
    oldDefinitions: any,
    newDefinitions: any,
): void {
    const oldIndex = buildElementIndex(oldDefinitions);
    const visited = new Set<any>();
    function walk(obj: any): void {
        if (!obj || typeof obj !== "object" || visited.has(obj)) return;
        visited.add(obj);
        if (obj.id && typeof obj.id === "string") {
            const oldEl = oldIndex.get(obj.id);
            if (oldEl !== undefined) {
                try {
                    const oldJson = JSON.stringify(
                        oldEl.extensionElements ?? null,
                        bpmnSafeReplacer,
                    );
                    const newJson = JSON.stringify(obj.extensionElements ?? null, bpmnSafeReplacer);
                    if (oldJson !== newJson) {
                        const existing = changes._changed[obj.id];
                        const attrEntry = {
                            // Natural naming (NOT bpmn-js-differ's inverted convention):
                            // oldValue = old/Compare-against diagram (Before), newValue = new/Compare-version (After)
                            "extensionElements[values]": {
                                oldValue: oldEl.extensionElements?.values ?? [],
                                newValue: obj.extensionElements?.values ?? [],
                            },
                        };
                        if (existing) {
                            // Keep existing.attrs["extensionElements"] so showOldAttrs can restore
                            // bo.extensionElements correctly; the HUD filters it out at display time.
                            Object.assign(existing.attrs, attrEntry);
                        } else {
                            changes._changed[obj.id] = { model: obj, attrs: attrEntry };
                        }
                    }
                } catch {
                    // Skip if serialization fails (e.g. unexpected structure)
                }
            }
        }
        for (const key of Object.keys(obj)) {
            if (key === "$parent") continue;
            const val = obj[key];
            if (Array.isArray(val)) val.forEach(walk);
            else if (val && typeof val === "object") walk(val);
        }
    }
    walk(newDefinitions);
}
