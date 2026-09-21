/**
 * Tests for bpmn-js-differ quirks and the resolveAttrBeforeAfter helper.
 *
 * bpmn-js-differ uses inconsistent oldValue/newValue naming depending on
 * the type of change (modification, addition, deletion).  These tests act as
 * regression guards so any library upgrade that silently changes the behaviour
 * will be caught immediately.
 */
import { describe, it, expect } from "vitest";
import { diff } from "bpmn-js-differ";
import { BpmnModdle } from "bpmn-moddle";
import camundaModdle from "camunda-bpmn-moddle/resources/camunda.json";
import {
    resolveAttrBeforeAfter,
    augmentExtensionElementChanges,
    applyOldAttrsToBO,
} from "./diffUtils";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const moddle = new (BpmnModdle as any)({ camunda: camundaModdle });

async function parse(xml: string): Promise<any> {
    const { rootElement } = await moddle.fromXML(xml);
    return rootElement;
}

function process(versionTag?: string, name = "MyProcess"): string {
    const vtAttr = versionTag ? ` camunda:versionTag="${versionTag}"` : "";
    return `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"
             xmlns:camunda="http://camunda.org/schema/1.0/bpmn"
             id="D" targetNamespace="x">
  <process id="P1" name="${name}"${vtAttr} />
</definitions>`;
}

// ---------------------------------------------------------------------------
// bpmn-js-differ raw behaviour (regression tests documenting library quirks)
// ---------------------------------------------------------------------------

describe("bpmn-js-differ raw attr naming", () => {
    it("modification: oldValue=After(new), newValue=Before(old) — INVERTED", async () => {
        const oldDefs = await parse(process("v1.0.0"));
        const newDefs = await parse(process("v2.0.0"));

        const changes = diff(oldDefs, newDefs);
        const attr = changes._changed["P1"].attrs["versionTag"];

        // The differ stores inverted: oldValue gets the new/After value
        expect(attr.oldValue).toBe("v2.0.0");
        expect(attr.newValue).toBe("v1.0.0");
    });

    it("addition: oldValue=undefined, newValue=the added value (After)", async () => {
        const oldDefs = await parse(process(undefined)); // no versionTag
        const newDefs = await parse(process("v1.0.0")); // added

        const changes = diff(oldDefs, newDefs);
        const attr = changes._changed["P1"].attrs["versionTag"];

        expect(attr.oldValue).toBeUndefined();
        expect(attr.newValue).toBe("v1.0.0");
    });

    it("deletion: oldValue=0 (sentinel), newValue=the removed value (Before)", async () => {
        const oldDefs = await parse(process("v1.0.0")); // has tag
        const newDefs = await parse(process(undefined)); // removed

        const changes = diff(oldDefs, newDefs);
        const attr = changes._changed["P1"].attrs["versionTag"];

        expect(attr.oldValue).toBe(0); // jsondiffpatch delete sentinel
        expect(attr.newValue).toBe("v1.0.0");
    });

    it("plain string modification is also inverted", async () => {
        const oldDefs = await parse(process(undefined, "OldName"));
        const newDefs = await parse(process(undefined, "NewName"));

        const changes = diff(oldDefs, newDefs);
        const attr = changes._changed["P1"].attrs["name"];

        expect(attr.oldValue).toBe("NewName"); // inverted — After in oldValue
        expect(attr.newValue).toBe("OldName"); // inverted — Before in newValue
    });
});

// ---------------------------------------------------------------------------
// resolveAttrBeforeAfter — the canonical mapping used in the HUD renderRow
// ---------------------------------------------------------------------------

describe("resolveAttrBeforeAfter", () => {
    it("modification: before=newValue, after=oldValue", () => {
        const { before, after } = resolveAttrBeforeAfter({
            oldValue: "v2.0.0",
            newValue: "v1.0.0",
        });
        expect(before).toBe("v1.0.0");
        expect(after).toBe("v2.0.0");
    });

    it("addition (oldValue=undefined): before=undefined, after=newValue", () => {
        const { before, after } = resolveAttrBeforeAfter({
            oldValue: undefined,
            newValue: "v1.0.0",
        });
        expect(before).toBeUndefined();
        expect(after).toBe("v1.0.0");
    });

    it("deletion (oldValue=0 sentinel): before=newValue, after=undefined", () => {
        const { before, after } = resolveAttrBeforeAfter({
            oldValue: 0,
            newValue: "v1.0.0",
        });
        expect(before).toBe("v1.0.0");
        expect(after).toBeUndefined();
    });

    it("round-trips correctly with live diff output — modification", async () => {
        const oldDefs = await parse(process("v1.0.0"));
        const newDefs = await parse(process("v2.0.0"));

        const attr = diff(oldDefs, newDefs)._changed["P1"].attrs["versionTag"];
        const { before, after } = resolveAttrBeforeAfter(attr);

        expect(before).toBe("v1.0.0");
        expect(after).toBe("v2.0.0");
    });

    it("round-trips correctly with live diff output — addition", async () => {
        const oldDefs = await parse(process(undefined));
        const newDefs = await parse(process("v1.0.0"));

        const attr = diff(oldDefs, newDefs)._changed["P1"].attrs["versionTag"];
        const { before, after } = resolveAttrBeforeAfter(attr);

        expect(before).toBeUndefined();
        expect(after).toBe("v1.0.0");
    });

    it("round-trips correctly with live diff output — deletion", async () => {
        const oldDefs = await parse(process("v1.0.0"));
        const newDefs = await parse(process(undefined));

        const attr = diff(oldDefs, newDefs)._changed["P1"].attrs["versionTag"];
        const { before, after } = resolveAttrBeforeAfter(attr);

        expect(before).toBe("v1.0.0");
        expect(after).toBeUndefined();
    });
});

// =============================================================================
// PART 2 — Comprehensive Camunda 7 attribute regression tests
//
// These tests use A/B BPMN XML pairs ("A" = old/before diagram, "B" = new/after
// diagram) to verify that resolveAttrBeforeAfter() correctly normalises
// bpmn-js-differ's quirky naming for every Camunda 7 attribute type.
//
// For each attribute modification:
//   A (old/before): has old value  →  diff: attr.newValue = old value  (INVERTED)
//   B (new/after):  has new value  →  diff: attr.oldValue = new value  (INVERTED)
//   resolveAttrBeforeAfter: { before = A value, after = B value }       ✓
//
// Any accidental inversion of the before/after logic causes MANY of these tests
// to fail, making the regression immediately visible.
// =============================================================================

// ---------------------------------------------------------------------------
// XML helpers
// ---------------------------------------------------------------------------

/** Wrap element XML in a complete BPMN definitions document. */
function bpmnDoc(elementXml: string): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"
             xmlns:camunda="http://camunda.org/schema/1.0/bpmn"
             id="D" targetNamespace="x">
  <process id="Proc" isExecutable="false">
    ${elementXml}
  </process>
</definitions>`;
}

/**
 * Wrap element XML in a document where the <process> itself carries the given
 * extra attributes (used for testing process-level Camunda attrs).
 */
function processDoc(processAttrs: string): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"
             xmlns:camunda="http://camunda.org/schema/1.0/bpmn"
             id="D" targetNamespace="x">
  <process id="Proc" isExecutable="false" ${processAttrs}>
    <serviceTask id="dummy" />
  </process>
</definitions>`;
}

// ---------------------------------------------------------------------------
// Assertion helpers
// ---------------------------------------------------------------------------

/**
 * Parse two BPMN XML strings, diff them, look up the attribute entry, and assert:
 *   1. Raw inverted naming  (attr.oldValue = expectedAfter, attr.newValue = expectedBefore)
 *   2. resolveAttrBeforeAfter gives correct semantic before/after
 */
async function assertModification(
    oldXml: string,
    newXml: string,
    elementId: string,
    propName: string,
    expectedBefore: any,
    expectedAfter: any,
): Promise<void> {
    const oldDefs = await parse(oldXml);
    const newDefs = await parse(newXml);
    const changes = diff(oldDefs, newDefs);
    const attr = changes._changed?.[elementId]?.attrs?.[propName];
    expect(attr, `Expected "${propName}" in _changed["${elementId}"].attrs`).toBeDefined();
    // Document raw inverted naming
    expect(attr.oldValue, "raw: oldValue should hold the After/new value (INVERTED)").toStrictEqual(
        expectedAfter,
    );
    expect(
        attr.newValue,
        "raw: newValue should hold the Before/old value (INVERTED)",
    ).toStrictEqual(expectedBefore);
    // Canonical resolution must give correct semantic before/after
    const { before, after } = resolveAttrBeforeAfter(attr);
    expect(before, "resolveAttrBeforeAfter: before should equal the A/old value").toStrictEqual(
        expectedBefore,
    );
    expect(after, "resolveAttrBeforeAfter: after should equal the B/new value").toStrictEqual(
        expectedAfter,
    );
}

/** Assert addition (property absent in A, present in B). */
async function assertAddition(
    oldXml: string,
    newXml: string,
    elementId: string,
    propName: string,
    addedValue: any,
): Promise<void> {
    const oldDefs = await parse(oldXml);
    const newDefs = await parse(newXml);
    const changes = diff(oldDefs, newDefs);
    const attr = changes._changed?.[elementId]?.attrs?.[propName];
    expect(attr, `Expected "${propName}" in _changed["${elementId}"].attrs`).toBeDefined();
    expect(attr.oldValue).toBeUndefined();
    expect(attr.newValue).toStrictEqual(addedValue);
    const { before, after } = resolveAttrBeforeAfter(attr);
    expect(before).toBeUndefined();
    expect(after).toStrictEqual(addedValue);
}

/** Assert deletion (property present in A, absent in B). */
async function assertDeletion(
    oldXml: string,
    newXml: string,
    elementId: string,
    propName: string,
    removedValue: any,
): Promise<void> {
    const oldDefs = await parse(oldXml);
    const newDefs = await parse(newXml);
    const changes = diff(oldDefs, newDefs);
    const attr = changes._changed?.[elementId]?.attrs?.[propName];
    expect(attr, `Expected "${propName}" in _changed["${elementId}"].attrs`).toBeDefined();
    expect(attr.oldValue).toBe(0); // jsondiffpatch deletion sentinel
    expect(attr.newValue).toStrictEqual(removedValue);
    const { before, after } = resolveAttrBeforeAfter(attr);
    expect(before).toStrictEqual(removedValue);
    expect(after).toBeUndefined();
}

// ---------------------------------------------------------------------------
// Service task attributes
// ---------------------------------------------------------------------------

describe("service task Camunda attributes — modifications", () => {
    const T = "T1";

    it("class: A=com.OldDelegate → B=com.NewDelegate", () =>
        assertModification(
            bpmnDoc(`<serviceTask id="${T}" camunda:class="com.OldDelegate" />`),
            bpmnDoc(`<serviceTask id="${T}" camunda:class="com.NewDelegate" />`),
            T,
            "class",
            "com.OldDelegate",
            "com.NewDelegate",
        ));

    it("class: addition (none → class)", () =>
        assertAddition(
            bpmnDoc(`<serviceTask id="${T}" />`),
            bpmnDoc(`<serviceTask id="${T}" camunda:class="com.NewDelegate" />`),
            T,
            "class",
            "com.NewDelegate",
        ));

    it("class: deletion (class → none)", () =>
        assertDeletion(
            bpmnDoc(`<serviceTask id="${T}" camunda:class="com.OldDelegate" />`),
            bpmnDoc(`<serviceTask id="${T}" />`),
            T,
            "class",
            "com.OldDelegate",
        ));

    it("expression: A=\${exprA} → B=\${exprB}", () =>
        assertModification(
            bpmnDoc(`<serviceTask id="${T}" camunda:expression="\${exprA}" />`),
            bpmnDoc(`<serviceTask id="${T}" camunda:expression="\${exprB}" />`),
            T,
            "expression",
            "${exprA}",
            "${exprB}",
        ));

    it("expression: addition", () =>
        assertAddition(
            bpmnDoc(`<serviceTask id="${T}" />`),
            bpmnDoc(`<serviceTask id="${T}" camunda:expression="\${newExpr}" />`),
            T,
            "expression",
            "${newExpr}",
        ));

    it("delegateExpression: modification", () =>
        assertModification(
            bpmnDoc(`<serviceTask id="${T}" camunda:delegateExpression="\${delegateA}" />`),
            bpmnDoc(`<serviceTask id="${T}" camunda:delegateExpression="\${delegateB}" />`),
            T,
            "delegateExpression",
            "${delegateA}",
            "${delegateB}",
        ));

    it("resultVariable: modification", () =>
        assertModification(
            bpmnDoc(`<serviceTask id="${T}" camunda:resultVariable="varA" />`),
            bpmnDoc(`<serviceTask id="${T}" camunda:resultVariable="varB" />`),
            T,
            "resultVariable",
            "varA",
            "varB",
        ));

    it("resultVariable: addition", () =>
        assertAddition(
            bpmnDoc(`<serviceTask id="${T}" />`),
            bpmnDoc(`<serviceTask id="${T}" camunda:resultVariable="result" />`),
            T,
            "resultVariable",
            "result",
        ));

    it("type (external): modification old-type → new-type", () =>
        assertModification(
            bpmnDoc(`<serviceTask id="${T}" camunda:type="external" />`),
            bpmnDoc(`<serviceTask id="${T}" camunda:type="rpa" />`),
            T,
            "type",
            "external",
            "rpa",
        ));

    it("topic: modification old-topic → new-topic", () =>
        assertModification(
            bpmnDoc(`<serviceTask id="${T}" camunda:type="external" camunda:topic="old-topic" />`),
            bpmnDoc(`<serviceTask id="${T}" camunda:type="external" camunda:topic="new-topic" />`),
            T,
            "topic",
            "old-topic",
            "new-topic",
        ));

    it("topic: addition", () =>
        assertAddition(
            bpmnDoc(`<serviceTask id="${T}" camunda:type="external" />`),
            bpmnDoc(`<serviceTask id="${T}" camunda:type="external" camunda:topic="my-topic" />`),
            T,
            "topic",
            "my-topic",
        ));

    it("name: modification", () =>
        assertModification(
            bpmnDoc(`<serviceTask id="${T}" name="Old Name" />`),
            bpmnDoc(`<serviceTask id="${T}" name="New Name" />`),
            T,
            "name",
            "Old Name",
            "New Name",
        ));

    it("asyncBefore: false → true (modification, default=false)", () =>
        assertModification(
            bpmnDoc(`<serviceTask id="${T}" />`), // asyncBefore defaults to false
            bpmnDoc(`<serviceTask id="${T}" camunda:asyncBefore="true" />`),
            T,
            "asyncBefore",
            false,
            true,
        ));

    it("asyncBefore: true → false (modification)", () =>
        assertModification(
            bpmnDoc(`<serviceTask id="${T}" camunda:asyncBefore="true" />`),
            bpmnDoc(`<serviceTask id="${T}" />`), // back to default false
            T,
            "asyncBefore",
            true,
            false,
        ));

    it("asyncAfter: false → true (modification, default=false)", () =>
        assertModification(
            bpmnDoc(`<serviceTask id="${T}" />`),
            bpmnDoc(`<serviceTask id="${T}" camunda:asyncAfter="true" />`),
            T,
            "asyncAfter",
            false,
            true,
        ));

    it("exclusive: true → false (modification, default=true)", () =>
        assertModification(
            bpmnDoc(`<serviceTask id="${T}" />`), // exclusive defaults to true
            bpmnDoc(`<serviceTask id="${T}" camunda:exclusive="false" />`),
            T,
            "exclusive",
            true,
            false,
        ));

    it("modelerTemplate: modification", () =>
        assertModification(
            bpmnDoc(`<serviceTask id="${T}" camunda:modelerTemplate="template-a" />`),
            bpmnDoc(`<serviceTask id="${T}" camunda:modelerTemplate="template-b" />`),
            T,
            "modelerTemplate",
            "template-a",
            "template-b",
        ));

    it("modelerTemplateVersion (Integer type): modification", () =>
        assertModification(
            bpmnDoc(
                `<serviceTask id="${T}" camunda:modelerTemplate="t" camunda:modelerTemplateVersion="1" />`,
            ),
            bpmnDoc(
                `<serviceTask id="${T}" camunda:modelerTemplate="t" camunda:modelerTemplateVersion="2" />`,
            ),
            T,
            "modelerTemplateVersion",
            1,
            2,
        ));
});

// ---------------------------------------------------------------------------
// User task attributes
// ---------------------------------------------------------------------------

describe("user task Camunda attributes — modifications", () => {
    const T = "T1";

    it("assignee: modification", () =>
        assertModification(
            bpmnDoc(`<userTask id="${T}" camunda:assignee="user.old" />`),
            bpmnDoc(`<userTask id="${T}" camunda:assignee="user.new" />`),
            T,
            "assignee",
            "user.old",
            "user.new",
        ));

    it("assignee: addition", () =>
        assertAddition(
            bpmnDoc(`<userTask id="${T}" />`),
            bpmnDoc(`<userTask id="${T}" camunda:assignee="user.new" />`),
            T,
            "assignee",
            "user.new",
        ));

    it("assignee: deletion", () =>
        assertDeletion(
            bpmnDoc(`<userTask id="${T}" camunda:assignee="user.old" />`),
            bpmnDoc(`<userTask id="${T}" />`),
            T,
            "assignee",
            "user.old",
        ));

    it("candidateUsers: modification", () =>
        assertModification(
            bpmnDoc(`<userTask id="${T}" camunda:candidateUsers="alice,bob" />`),
            bpmnDoc(`<userTask id="${T}" camunda:candidateUsers="alice,carol" />`),
            T,
            "candidateUsers",
            "alice,bob",
            "alice,carol",
        ));

    it("candidateGroups: modification", () =>
        assertModification(
            bpmnDoc(`<userTask id="${T}" camunda:candidateGroups="group-a" />`),
            bpmnDoc(`<userTask id="${T}" camunda:candidateGroups="group-b" />`),
            T,
            "candidateGroups",
            "group-a",
            "group-b",
        ));

    it("dueDate: modification", () =>
        assertModification(
            bpmnDoc(`<userTask id="${T}" camunda:dueDate="2024-01-01" />`),
            bpmnDoc(`<userTask id="${T}" camunda:dueDate="2025-12-31" />`),
            T,
            "dueDate",
            "2024-01-01",
            "2025-12-31",
        ));

    it("followUpDate: modification", () =>
        assertModification(
            bpmnDoc(`<userTask id="${T}" camunda:followUpDate="\${oldDate}" />`),
            bpmnDoc(`<userTask id="${T}" camunda:followUpDate="\${newDate}" />`),
            T,
            "followUpDate",
            "${oldDate}",
            "${newDate}",
        ));

    it("priority: modification", () =>
        assertModification(
            bpmnDoc(`<userTask id="${T}" camunda:priority="50" />`),
            bpmnDoc(`<userTask id="${T}" camunda:priority="80" />`),
            T,
            "priority",
            "50",
            "80",
        ));

    it("formKey: modification", () =>
        assertModification(
            bpmnDoc(`<userTask id="${T}" camunda:formKey="embedded:old-form" />`),
            bpmnDoc(`<userTask id="${T}" camunda:formKey="embedded:new-form" />`),
            T,
            "formKey",
            "embedded:old-form",
            "embedded:new-form",
        ));

    it("formRef: modification", () =>
        assertModification(
            bpmnDoc(`<userTask id="${T}" camunda:formRef="form-v1" />`),
            bpmnDoc(`<userTask id="${T}" camunda:formRef="form-v2" />`),
            T,
            "formRef",
            "form-v1",
            "form-v2",
        ));

    it("formRefBinding: modification", () =>
        assertModification(
            bpmnDoc(`<userTask id="${T}" camunda:formRef="f" camunda:formRefBinding="latest" />`),
            bpmnDoc(`<userTask id="${T}" camunda:formRef="f" camunda:formRefBinding="version" />`),
            T,
            "formRefBinding",
            "latest",
            "version",
        ));

    it("formRefVersion: modification", () =>
        assertModification(
            bpmnDoc(
                `<userTask id="${T}" camunda:formRef="f" camunda:formRefBinding="version" camunda:formRefVersion="1" />`,
            ),
            bpmnDoc(
                `<userTask id="${T}" camunda:formRef="f" camunda:formRefBinding="version" camunda:formRefVersion="2" />`,
            ),
            T,
            "formRefVersion",
            "1",
            "2",
        ));

    it("name: modification", () =>
        assertModification(
            bpmnDoc(`<userTask id="${T}" name="Review Request" />`),
            bpmnDoc(`<userTask id="${T}" name="Approve Request" />`),
            T,
            "name",
            "Review Request",
            "Approve Request",
        ));

    it("asyncBefore: false → true on user task", () =>
        assertModification(
            bpmnDoc(`<userTask id="${T}" />`),
            bpmnDoc(`<userTask id="${T}" camunda:asyncBefore="true" />`),
            T,
            "asyncBefore",
            false,
            true,
        ));
});

// ---------------------------------------------------------------------------
// Call activity attributes
// ---------------------------------------------------------------------------

describe("call activity Camunda attributes — modifications", () => {
    const T = "T1";

    it("calledElementBinding: modification latest → version", () =>
        assertModification(
            bpmnDoc(
                `<callActivity id="${T}" calledElement="SubProc" camunda:calledElementBinding="latest" />`,
            ),
            bpmnDoc(
                `<callActivity id="${T}" calledElement="SubProc" camunda:calledElementBinding="version" />`,
            ),
            T,
            "calledElementBinding",
            "latest",
            "version",
        ));

    it("calledElementVersion: modification", () =>
        assertModification(
            bpmnDoc(
                `<callActivity id="${T}" calledElement="SubProc" camunda:calledElementBinding="version" camunda:calledElementVersion="1" />`,
            ),
            bpmnDoc(
                `<callActivity id="${T}" calledElement="SubProc" camunda:calledElementBinding="version" camunda:calledElementVersion="2" />`,
            ),
            T,
            "calledElementVersion",
            "1",
            "2",
        ));

    it("calledElementVersion: addition (latest → version + version number)", () =>
        assertAddition(
            bpmnDoc(
                `<callActivity id="${T}" calledElement="SubProc" camunda:calledElementBinding="latest" />`,
            ),
            bpmnDoc(
                `<callActivity id="${T}" calledElement="SubProc" camunda:calledElementBinding="version" camunda:calledElementVersion="3" />`,
            ),
            T,
            "calledElementVersion",
            "3",
        ));

    it("calledElementVersionTag: modification", () =>
        assertModification(
            bpmnDoc(
                `<callActivity id="${T}" calledElement="SubProc" camunda:calledElementVersionTag="v1.0" />`,
            ),
            bpmnDoc(
                `<callActivity id="${T}" calledElement="SubProc" camunda:calledElementVersionTag="v2.0" />`,
            ),
            T,
            "calledElementVersionTag",
            "v1.0",
            "v2.0",
        ));

    it("calledElementTenantId: modification", () =>
        assertModification(
            bpmnDoc(
                `<callActivity id="${T}" calledElement="SubProc" camunda:calledElementTenantId="tenant-a" />`,
            ),
            bpmnDoc(
                `<callActivity id="${T}" calledElement="SubProc" camunda:calledElementTenantId="tenant-b" />`,
            ),
            T,
            "calledElementTenantId",
            "tenant-a",
            "tenant-b",
        ));

    it("variableMappingClass: modification", () =>
        assertModification(
            bpmnDoc(
                `<callActivity id="${T}" calledElement="SubProc" camunda:variableMappingClass="com.Old" />`,
            ),
            bpmnDoc(
                `<callActivity id="${T}" calledElement="SubProc" camunda:variableMappingClass="com.New" />`,
            ),
            T,
            "variableMappingClass",
            "com.Old",
            "com.New",
        ));

    it("variableMappingDelegateExpression: modification", () =>
        assertModification(
            bpmnDoc(
                `<callActivity id="${T}" calledElement="SubProc" camunda:variableMappingDelegateExpression="\${oldMapper}" />`,
            ),
            bpmnDoc(
                `<callActivity id="${T}" calledElement="SubProc" camunda:variableMappingDelegateExpression="\${newMapper}" />`,
            ),
            T,
            "variableMappingDelegateExpression",
            "${oldMapper}",
            "${newMapper}",
        ));
});

// ---------------------------------------------------------------------------
// Business rule task attributes
// ---------------------------------------------------------------------------

describe("business rule task Camunda attributes — modifications", () => {
    const T = "T1";

    it("decisionRef: modification", () =>
        assertModification(
            bpmnDoc(`<businessRuleTask id="${T}" camunda:decisionRef="decision-v1" />`),
            bpmnDoc(`<businessRuleTask id="${T}" camunda:decisionRef="decision-v2" />`),
            T,
            "decisionRef",
            "decision-v1",
            "decision-v2",
        ));

    it("decisionRef: addition", () =>
        assertAddition(
            bpmnDoc(`<businessRuleTask id="${T}" />`),
            bpmnDoc(`<businessRuleTask id="${T}" camunda:decisionRef="my-decision" />`),
            T,
            "decisionRef",
            "my-decision",
        ));

    it("decisionRefBinding: modification latest → version", () =>
        assertModification(
            bpmnDoc(
                `<businessRuleTask id="${T}" camunda:decisionRef="d" camunda:decisionRefBinding="latest" />`,
            ),
            bpmnDoc(
                `<businessRuleTask id="${T}" camunda:decisionRef="d" camunda:decisionRefBinding="version" />`,
            ),
            T,
            "decisionRefBinding",
            "latest",
            "version",
        ));

    it("decisionRefVersion: modification", () =>
        assertModification(
            bpmnDoc(
                `<businessRuleTask id="${T}" camunda:decisionRef="d" camunda:decisionRefBinding="version" camunda:decisionRefVersion="1" />`,
            ),
            bpmnDoc(
                `<businessRuleTask id="${T}" camunda:decisionRef="d" camunda:decisionRefBinding="version" camunda:decisionRefVersion="2" />`,
            ),
            T,
            "decisionRefVersion",
            "1",
            "2",
        ));

    it("mapDecisionResult: modification resultList → singleEntry", () =>
        assertModification(
            bpmnDoc(
                `<businessRuleTask id="${T}" camunda:decisionRef="d" camunda:mapDecisionResult="resultList" />`,
            ),
            bpmnDoc(
                `<businessRuleTask id="${T}" camunda:decisionRef="d" camunda:mapDecisionResult="singleEntry" />`,
            ),
            T,
            "mapDecisionResult",
            "resultList",
            "singleEntry",
        ));

    it("decisionRefTenantId: modification", () =>
        assertModification(
            bpmnDoc(
                `<businessRuleTask id="${T}" camunda:decisionRef="d" camunda:decisionRefTenantId="tenant-1" />`,
            ),
            bpmnDoc(
                `<businessRuleTask id="${T}" camunda:decisionRef="d" camunda:decisionRefTenantId="tenant-2" />`,
            ),
            T,
            "decisionRefTenantId",
            "tenant-1",
            "tenant-2",
        ));
});

// ---------------------------------------------------------------------------
// Script task attributes
// ---------------------------------------------------------------------------

describe("script task Camunda attributes — modifications", () => {
    const T = "T1";

    it("resultVariable: modification", () =>
        assertModification(
            bpmnDoc(
                `<scriptTask id="${T}" scriptFormat="groovy" camunda:resultVariable="oldVar" />`,
            ),
            bpmnDoc(
                `<scriptTask id="${T}" scriptFormat="groovy" camunda:resultVariable="newVar" />`,
            ),
            T,
            "resultVariable",
            "oldVar",
            "newVar",
        ));

    it("resultVariable: addition", () =>
        assertAddition(
            bpmnDoc(`<scriptTask id="${T}" scriptFormat="groovy" />`),
            bpmnDoc(
                `<scriptTask id="${T}" scriptFormat="groovy" camunda:resultVariable="result" />`,
            ),
            T,
            "resultVariable",
            "result",
        ));

    it("resource: modification", () =>
        assertModification(
            bpmnDoc(
                `<scriptTask id="${T}" scriptFormat="groovy" camunda:resource="scripts/old.groovy" />`,
            ),
            bpmnDoc(
                `<scriptTask id="${T}" scriptFormat="groovy" camunda:resource="scripts/new.groovy" />`,
            ),
            T,
            "resource",
            "scripts/old.groovy",
            "scripts/new.groovy",
        ));
});

// ---------------------------------------------------------------------------
// Process-level Camunda attributes
// ---------------------------------------------------------------------------

describe("process Camunda attributes — modifications", () => {
    const P = "Proc";

    it("historyTimeToLive: modification 30 → 60", () =>
        assertModification(
            processDoc('camunda:historyTimeToLive="30"'),
            processDoc('camunda:historyTimeToLive="60"'),
            P,
            "historyTimeToLive",
            "30",
            "60",
        ));

    it("historyTimeToLive: addition", () =>
        assertAddition(
            processDoc(""),
            processDoc('camunda:historyTimeToLive="P30D"'),
            P,
            "historyTimeToLive",
            "P30D",
        ));

    it("historyTimeToLive: deletion", () =>
        assertDeletion(
            processDoc('camunda:historyTimeToLive="P30D"'),
            processDoc(""),
            P,
            "historyTimeToLive",
            "P30D",
        ));

    it("candidateStarterGroups: modification", () =>
        assertModification(
            processDoc('camunda:candidateStarterGroups="group-a"'),
            processDoc('camunda:candidateStarterGroups="group-b"'),
            P,
            "candidateStarterGroups",
            "group-a",
            "group-b",
        ));

    it("candidateStarterUsers: modification", () =>
        assertModification(
            processDoc('camunda:candidateStarterUsers="alice"'),
            processDoc('camunda:candidateStarterUsers="bob"'),
            P,
            "candidateStarterUsers",
            "alice",
            "bob",
        ));

    it("isStartableInTasklist: true → false (modification, default=true)", () =>
        assertModification(
            processDoc(""), // defaults to true
            processDoc('camunda:isStartableInTasklist="false"'),
            P,
            "isStartableInTasklist",
            true,
            false,
        ));

    it("isExecutable: false → true (standard BPMN attr on process)", () =>
        assertModification(
            `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"
             xmlns:camunda="http://camunda.org/schema/1.0/bpmn"
             id="D" targetNamespace="x">
  <process id="${P}" isExecutable="false"><serviceTask id="dummy" /></process>
</definitions>`,
            `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"
             xmlns:camunda="http://camunda.org/schema/1.0/bpmn"
             id="D" targetNamespace="x">
  <process id="${P}" isExecutable="true"><serviceTask id="dummy" /></process>
</definitions>`,
            P,
            "isExecutable",
            false,
            true,
        ));
});

// ---------------------------------------------------------------------------
// applyOldAttrsToBO — business object restoration
// ---------------------------------------------------------------------------

describe("applyOldAttrsToBO — business object restoration", () => {
    it("modification: sets bo[key] = attr.newValue (the Before value due to inversion)", () => {
        const bo: Record<string, any> = { class: "com.NewDelegate" };
        const attrs = { class: { oldValue: "com.NewDelegate", newValue: "com.OldDelegate" } };
        applyOldAttrsToBO(bo, attrs);
        expect(bo["class"]).toBe("com.OldDelegate");
    });

    it("addition: deletes bo[key] so the property no longer exists in BO", () => {
        const bo: Record<string, any> = { class: "com.NewDelegate" };
        const attrs = { class: { oldValue: undefined, newValue: "com.NewDelegate" } };
        applyOldAttrsToBO(bo, attrs);
        expect("class" in bo).toBe(false);
    });

    it("deletion with sentinel 0: restores bo[key] to the removed value", () => {
        const bo: Record<string, any> = {}; // property absent in new diagram
        const attrs = { class: { oldValue: 0, newValue: "com.OldDelegate" } };
        applyOldAttrsToBO(bo, attrs);
        expect(bo["class"]).toBe("com.OldDelegate");
    });

    it("boolean false modification (not confused with sentinel 0): correctly restores old value", () => {
        // asyncBefore goes true (A/before) → false (B/after).
        // Inverted diff result: { oldValue: false (B/after), newValue: true (A/before) }
        // The viewer imports B, so the BO holds the B/after value: asyncBefore = false.
        const bo: Record<string, any> = { asyncBefore: false }; // BO holds B/new value
        const attrs = { asyncBefore: { oldValue: false, newValue: true } };
        applyOldAttrsToBO(bo, attrs);
        // Must restore BO to A/before value (true).
        // If false were mistakenly treated as the deletion sentinel (=== 0 loosely), the
        // property would be deleted and this expect would fail with undefined.
        expect(bo["asyncBefore"]).toBe(true); // restored to A/before
        expect("asyncBefore" in bo).toBe(true); // property must NOT have been deleted
    });

    it("multiple mixed attrs: modification, addition, and deletion handled simultaneously", () => {
        const bo: Record<string, any> = {
            name: "New Task", // modified (old was "Old Task")
            class: "com.New", // modified (old was "com.Old")
            resultVariable: "res", // added (didn't exist in old diagram)
        };
        const attrs = {
            name: { oldValue: "New Task", newValue: "Old Task" }, // inverted
            class: { oldValue: "com.New", newValue: "com.Old" }, // inverted
            resultVariable: { oldValue: undefined, newValue: "res" }, // addition → delete
        };
        applyOldAttrsToBO(bo, attrs);
        expect(bo["name"]).toBe("Old Task");
        expect(bo["class"]).toBe("com.Old");
        expect("resultVariable" in bo).toBe(false);
    });

    it("does not mutate unrelated properties", () => {
        const bo: Record<string, any> = { name: "Task", id: "T1", $type: "bpmn:ServiceTask" };
        const attrs = { name: { oldValue: "Task", newValue: "Old Task" } };
        applyOldAttrsToBO(bo, attrs);
        expect(bo["id"]).toBe("T1");
        expect(bo["$type"]).toBe("bpmn:ServiceTask");
        expect(bo["name"]).toBe("Old Task");
    });

    it("round-trips with live diff output — restores old name on BO", async () => {
        const oldDefs = await parse(bpmnDoc(`<serviceTask id="T1" name="Old Name" />`));
        const newDefs = await parse(bpmnDoc(`<serviceTask id="T1" name="New Name" />`));
        const changes = diff(oldDefs, newDefs);
        const attrs = changes._changed["T1"].attrs;

        // BO currently has the new value (from the new diagram)
        const bo: Record<string, any> = { name: "New Name" };
        applyOldAttrsToBO(bo, attrs);
        // After restoring, BO should hold the old/before name
        expect(bo["name"]).toBe("Old Name");
    });
});

// ---------------------------------------------------------------------------
// augmentExtensionElementChanges — natural naming (NOT inverted)
// ---------------------------------------------------------------------------

describe("augmentExtensionElementChanges — extension element changes with natural naming", () => {
    it("bpmn-js-differ misses extension element changes without augmentation", async () => {
        const oldXml = bpmnDoc(`
            <serviceTask id="T1">
              <extensionElements>
                <camunda:inputOutput>
                  <camunda:inputParameter name="p">old</camunda:inputParameter>
                </camunda:inputOutput>
              </extensionElements>
            </serviceTask>`);
        const newXml = bpmnDoc(`
            <serviceTask id="T1">
              <extensionElements>
                <camunda:inputOutput>
                  <camunda:inputParameter name="p">new</camunda:inputParameter>
                </camunda:inputOutput>
              </extensionElements>
            </serviceTask>`);
        const oldDefs = await parse(oldXml);
        const newDefs = await parse(newXml);
        const rawChanges = diff(oldDefs, newDefs);

        // Without augmentation, the change is NOT detected by bpmn-js-differ
        const entry = rawChanges._changed?.["T1"];
        const hasExt =
            entry?.attrs?.["extensionElements[values]"] !== undefined ||
            entry?.attrs?.["extensionElements"] !== undefined;
        expect(hasExt).toBe(false);

        // After augmentation, the change IS detected
        augmentExtensionElementChanges(rawChanges, oldDefs, newDefs);
        expect(rawChanges._changed?.["T1"]?.attrs?.["extensionElements[values]"]).toBeDefined();
    });

    it("InputOutput change: oldValue=before state, newValue=after state (natural naming)", async () => {
        const oldXml = bpmnDoc(`
            <serviceTask id="T1">
              <extensionElements>
                <camunda:inputOutput>
                  <camunda:inputParameter name="var1">old_value</camunda:inputParameter>
                </camunda:inputOutput>
              </extensionElements>
            </serviceTask>`);
        const newXml = bpmnDoc(`
            <serviceTask id="T1">
              <extensionElements>
                <camunda:inputOutput>
                  <camunda:inputParameter name="var1">new_value</camunda:inputParameter>
                </camunda:inputOutput>
              </extensionElements>
            </serviceTask>`);
        const oldDefs = await parse(oldXml);
        const newDefs = await parse(newXml);
        const changes = diff(oldDefs, newDefs);
        augmentExtensionElementChanges(changes, oldDefs, newDefs);

        const extAttr = changes._changed["T1"].attrs["extensionElements[values]"];
        expect(extAttr).toBeDefined();

        // NATURAL naming: oldValue = BEFORE (old XML), newValue = AFTER (new XML)
        expect(extAttr.oldValue[0]?.inputParameters?.[0]?.value).toBe("old_value");
        expect(extAttr.newValue[0]?.inputParameters?.[0]?.value).toBe("new_value");
    });

    it("extension elements MUST NOT use resolveAttrBeforeAfter — applying it would invert them", async () => {
        const oldXml = bpmnDoc(`
            <serviceTask id="T1">
              <extensionElements>
                <camunda:inputOutput>
                  <camunda:inputParameter name="p">before_value</camunda:inputParameter>
                </camunda:inputOutput>
              </extensionElements>
            </serviceTask>`);
        const newXml = bpmnDoc(`
            <serviceTask id="T1">
              <extensionElements>
                <camunda:inputOutput>
                  <camunda:inputParameter name="p">after_value</camunda:inputParameter>
                </camunda:inputOutput>
              </extensionElements>
            </serviceTask>`);
        const oldDefs = await parse(oldXml);
        const newDefs = await parse(newXml);
        const changes = diff(oldDefs, newDefs);
        augmentExtensionElementChanges(changes, oldDefs, newDefs);

        const extAttr = changes._changed["T1"].attrs["extensionElements[values]"];

        // Correct: use oldValue directly as "before" (natural naming)
        expect(extAttr.oldValue[0]?.inputParameters?.[0]?.value).toBe("before_value");
        expect(extAttr.newValue[0]?.inputParameters?.[0]?.value).toBe("after_value");

        // Proof that resolveAttrBeforeAfter produces WRONG results for ext elements:
        // It sees a non-undefined, non-zero oldValue and applies the inversion:
        //   before = attr.newValue = after_value  ← WRONG
        //   after  = attr.oldValue = before_value ← WRONG
        const { before: wrongBefore, after: wrongAfter } = resolveAttrBeforeAfter(extAttr);
        expect(wrongBefore?.[0]?.inputParameters?.[0]?.value).toBe("after_value"); // confirms wrong
        expect(wrongAfter?.[0]?.inputParameters?.[0]?.value).toBe("before_value"); // confirms wrong
        // This is exactly why renderRow excludes "extensionElements[values]" from resolveAttrBeforeAfter
    });

    it("ExecutionListener change: detected with natural naming", async () => {
        const oldXml = bpmnDoc(`
            <serviceTask id="T1">
              <extensionElements>
                <camunda:executionListener event="start" class="com.OldListener" />
              </extensionElements>
            </serviceTask>`);
        const newXml = bpmnDoc(`
            <serviceTask id="T1">
              <extensionElements>
                <camunda:executionListener event="start" class="com.NewListener" />
              </extensionElements>
            </serviceTask>`);
        const oldDefs = await parse(oldXml);
        const newDefs = await parse(newXml);
        const changes = diff(oldDefs, newDefs);
        augmentExtensionElementChanges(changes, oldDefs, newDefs);

        const extAttr = changes._changed?.["T1"]?.attrs["extensionElements[values]"];
        expect(extAttr).toBeDefined();
        expect(extAttr.oldValue[0]?.class).toBe("com.OldListener"); // before
        expect(extAttr.newValue[0]?.class).toBe("com.NewListener"); // after
    });

    it("FailedJobRetryTimeCycle change: detected with natural naming", async () => {
        const oldXml = bpmnDoc(`
            <serviceTask id="T1">
              <extensionElements>
                <camunda:failedJobRetryTimeCycle>R3/PT10S</camunda:failedJobRetryTimeCycle>
              </extensionElements>
            </serviceTask>`);
        const newXml = bpmnDoc(`
            <serviceTask id="T1">
              <extensionElements>
                <camunda:failedJobRetryTimeCycle>R5/PT30S</camunda:failedJobRetryTimeCycle>
              </extensionElements>
            </serviceTask>`);
        const oldDefs = await parse(oldXml);
        const newDefs = await parse(newXml);
        const changes = diff(oldDefs, newDefs);
        augmentExtensionElementChanges(changes, oldDefs, newDefs);

        const extAttr = changes._changed?.["T1"]?.attrs["extensionElements[values]"];
        expect(extAttr).toBeDefined();
        expect(extAttr.oldValue[0]?.body).toBe("R3/PT10S"); // before
        expect(extAttr.newValue[0]?.body).toBe("R5/PT30S"); // after
    });

    it("extension elements addition (none → some): oldValue=[], newValue=[listener]", async () => {
        const oldXml = bpmnDoc(`<serviceTask id="T1" />`);
        const newXml = bpmnDoc(`
            <serviceTask id="T1">
              <extensionElements>
                <camunda:executionListener event="start" class="com.Listener" />
              </extensionElements>
            </serviceTask>`);
        const oldDefs = await parse(oldXml);
        const newDefs = await parse(newXml);
        const changes = diff(oldDefs, newDefs);
        augmentExtensionElementChanges(changes, oldDefs, newDefs);

        const extAttr = changes._changed?.["T1"]?.attrs["extensionElements[values]"];
        expect(extAttr).toBeDefined();
        expect(extAttr.oldValue).toHaveLength(0); // nothing before
        expect(extAttr.newValue).toHaveLength(1);
        expect(extAttr.newValue[0]?.class).toBe("com.Listener");
    });

    it("extension elements removal (some → none): oldValue=[listener], newValue=[]", async () => {
        const oldXml = bpmnDoc(`
            <serviceTask id="T1">
              <extensionElements>
                <camunda:executionListener event="end" class="com.Listener" />
              </extensionElements>
            </serviceTask>`);
        const newXml = bpmnDoc(`<serviceTask id="T1" />`);
        const oldDefs = await parse(oldXml);
        const newDefs = await parse(newXml);
        const changes = diff(oldDefs, newDefs);
        augmentExtensionElementChanges(changes, oldDefs, newDefs);

        const extAttr = changes._changed?.["T1"]?.attrs["extensionElements[values]"];
        expect(extAttr).toBeDefined();
        expect(extAttr.oldValue).toHaveLength(1);
        expect(extAttr.oldValue[0]?.class).toBe("com.Listener");
        expect(extAttr.newValue).toHaveLength(0); // nothing after
    });

    it("TaskListener on user task: detected with natural naming", async () => {
        const oldXml = bpmnDoc(`
            <userTask id="T1">
              <extensionElements>
                <camunda:taskListener event="create" class="com.OldHandler" />
              </extensionElements>
            </userTask>`);
        const newXml = bpmnDoc(`
            <userTask id="T1">
              <extensionElements>
                <camunda:taskListener event="create" class="com.NewHandler" />
              </extensionElements>
            </userTask>`);
        const oldDefs = await parse(oldXml);
        const newDefs = await parse(newXml);
        const changes = diff(oldDefs, newDefs);
        augmentExtensionElementChanges(changes, oldDefs, newDefs);

        const extAttr = changes._changed?.["T1"]?.attrs["extensionElements[values]"];
        expect(extAttr).toBeDefined();
        expect(extAttr.oldValue[0]?.class).toBe("com.OldHandler");
        expect(extAttr.newValue[0]?.class).toBe("com.NewHandler");
    });

    it("element with both regular attr change AND ext element change: both present in attrs", async () => {
        const oldXml = bpmnDoc(`
            <serviceTask id="T1" name="Old Name">
              <extensionElements>
                <camunda:executionListener event="start" class="com.OldListener" />
              </extensionElements>
            </serviceTask>`);
        const newXml = bpmnDoc(`
            <serviceTask id="T1" name="New Name">
              <extensionElements>
                <camunda:executionListener event="start" class="com.NewListener" />
              </extensionElements>
            </serviceTask>`);
        const oldDefs = await parse(oldXml);
        const newDefs = await parse(newXml);
        const changes = diff(oldDefs, newDefs);
        augmentExtensionElementChanges(changes, oldDefs, newDefs);

        const attrs = changes._changed["T1"].attrs;
        // Regular attr (inverted naming)
        const nameAttr = attrs["name"];
        expect(nameAttr).toBeDefined();
        const { before: nameBefore, after: nameAfter } = resolveAttrBeforeAfter(nameAttr);
        expect(nameBefore).toBe("Old Name");
        expect(nameAfter).toBe("New Name");

        // Extension attr (natural naming — NOT through resolveAttrBeforeAfter)
        const extAttr = attrs["extensionElements[values]"];
        expect(extAttr).toBeDefined();
        expect(extAttr.oldValue[0]?.class).toBe("com.OldListener"); // oldValue = before (natural)
        expect(extAttr.newValue[0]?.class).toBe("com.NewListener"); // newValue = after (natural)
    });
});

// ---------------------------------------------------------------------------
// Edge cases and boundary conditions
// ---------------------------------------------------------------------------

describe("edge cases", () => {
    it("empty string to non-empty: treated as modification", () =>
        assertModification(
            bpmnDoc(`<serviceTask id="T1" camunda:resultVariable="" />`),
            bpmnDoc(`<serviceTask id="T1" camunda:resultVariable="result" />`),
            "T1",
            "resultVariable",
            "",
            "result",
        ));

    it("boolean false is NOT confused with deletion sentinel 0 in resolveAttrBeforeAfter", () => {
        // asyncBefore goes true → false.
        // Inverted: { oldValue: false (after/new), newValue: true (before/old) }
        // resolveAttrBeforeAfter must treat oldValue=false as a modification, NOT a deletion
        const attr = { oldValue: false, newValue: true };
        const { before, after } = resolveAttrBeforeAfter(attr);
        expect(before).toBe(true); // old/before was true
        expect(after).toBe(false); // new/after is false
        // Must NOT produce deletion result { before: true, after: undefined }
        expect(after).not.toBeUndefined();
    });

    it("deletion sentinel 0 correctly identified even when newValue is a string", () => {
        const attr = { oldValue: 0, newValue: "some-deleted-value" };
        const { before, after } = resolveAttrBeforeAfter(attr);
        expect(before).toBe("some-deleted-value");
        expect(after).toBeUndefined();
    });

    it("multiple attributes changed on same element: each resolves independently", async () => {
        const oldXml = bpmnDoc(
            `<serviceTask id="T1" name="Old Name" camunda:class="com.Old" camunda:asyncBefore="true" />`,
        );
        const newXml = bpmnDoc(
            `<serviceTask id="T1" name="New Name" camunda:class="com.New" />`,
            // asyncBefore removed, defaults back to false
        );
        const oldDefs = await parse(oldXml);
        const newDefs = await parse(newXml);
        const changes = diff(oldDefs, newDefs);
        const attrs = changes._changed?.["T1"]?.attrs;
        expect(attrs).toBeDefined();

        const { before: nameBefore, after: nameAfter } = resolveAttrBeforeAfter(attrs["name"]);
        expect(nameBefore).toBe("Old Name");
        expect(nameAfter).toBe("New Name");

        const { before: classBefore, after: classAfter } = resolveAttrBeforeAfter(attrs["class"]);
        expect(classBefore).toBe("com.Old");
        expect(classAfter).toBe("com.New");

        const { before: asyncBefore, after: asyncAfter } = resolveAttrBeforeAfter(
            attrs["asyncBefore"],
        );
        expect(asyncBefore).toBe(true); // was true in A
        expect(asyncAfter).toBe(false); // defaults to false in B
    });

    it("element with only layout change (moved): appears in _layoutChanged, not _changed", async () => {
        // Both diagrams have T1 with same attrs but DI coords differ
        const oldXml = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"
             xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
             xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
             xmlns:camunda="http://camunda.org/schema/1.0/bpmn"
             id="D" targetNamespace="x">
  <process id="Proc" isExecutable="false">
    <serviceTask id="T1" name="Task" />
  </process>
  <bpmndi:BPMNDiagram id="Diag"><bpmndi:BPMNPlane id="Plane" bpmnElement="Proc">
    <bpmndi:BPMNShape id="T1_di" bpmnElement="T1"><dc:Bounds x="100" y="100" width="100" height="80"/></bpmndi:BPMNShape>
  </bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
</definitions>`;
        const newXml = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"
             xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
             xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
             xmlns:camunda="http://camunda.org/schema/1.0/bpmn"
             id="D" targetNamespace="x">
  <process id="Proc" isExecutable="false">
    <serviceTask id="T1" name="Task" />
  </process>
  <bpmndi:BPMNDiagram id="Diag"><bpmndi:BPMNPlane id="Plane" bpmnElement="Proc">
    <bpmndi:BPMNShape id="T1_di" bpmnElement="T1"><dc:Bounds x="300" y="200" width="100" height="80"/></bpmndi:BPMNShape>
  </bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
</definitions>`;
        const oldDefs = await parse(oldXml);
        const newDefs = await parse(newXml);
        const changes = diff(oldDefs, newDefs);
        // T1 attributes haven't changed, only DI layout
        expect(changes._changed?.["T1"]).toBeUndefined();
        expect(changes._layoutChanged?.["T1"]).toBeDefined();
    });

    it("added element appears in _added, not _changed", async () => {
        const oldXml = bpmnDoc(`<serviceTask id="T1" name="Task" />`);
        const newXml = bpmnDoc(
            `<serviceTask id="T1" name="Task" /><userTask id="T2" name="New Task" />`,
        );
        const oldDefs = await parse(oldXml);
        const newDefs = await parse(newXml);
        const changes = diff(oldDefs, newDefs);
        expect(changes._added?.["T2"]).toBeDefined();
        expect(changes._changed?.["T2"]).toBeUndefined();
    });

    it("removed element appears in _removed, not _changed", async () => {
        const oldXml = bpmnDoc(
            `<serviceTask id="T1" name="Task" /><userTask id="T2" name="Old Task" />`,
        );
        const newXml = bpmnDoc(`<serviceTask id="T1" name="Task" />`);
        const oldDefs = await parse(oldXml);
        const newDefs = await parse(newXml);
        const changes = diff(oldDefs, newDefs);
        expect(changes._removed?.["T2"]).toBeDefined();
        expect(changes._changed?.["T2"]).toBeUndefined();
    });
});
