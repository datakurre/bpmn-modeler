/**
 * Tests for the DMN XML parser (parse.ts).
 *
 * Uses real DMN 1.3 XML strings to verify that dmn-moddle extraction
 * produces the expected internal model structures.
 */
import { describe, it, expect } from "vitest";
import { parseDmnXml } from "./parse";
import type { DmnDecisionTable, DmnLiteralExpression } from "./parse";

// ── Fixtures ────────────────────────────────────────────────────────

const DECISION_TABLE_DMN = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="https://www.omg.org/spec/DMN/20191111/MODEL/"
             xmlns:dmndi="https://www.omg.org/spec/DMN/20191111/DMNDI/"
             xmlns:dc="http://www.omg.org/spec/DMN/20180521/DC/"
             id="Definitions_1"
             name="TestModel"
             namespace="http://camunda.org/schema/1.0/dmn">
  <decision id="greeting" name="Greeting">
    <decisionTable id="dt_1" hitPolicy="FIRST">
      <input id="input_1" label="Name">
        <inputExpression id="ie_1" typeRef="string">
          <text>name</text>
        </inputExpression>
      </input>
      <output id="output_1" name="result" typeRef="string" />
      <rule id="rule_1">
        <inputEntry id="ie_entry_1"><text>"Alice"</text></inputEntry>
        <outputEntry id="oe_1"><text>"Hello Alice"</text></outputEntry>
      </rule>
      <rule id="rule_2">
        <inputEntry id="ie_entry_2"><text>-</text></inputEntry>
        <outputEntry id="oe_2"><text>"Hello stranger"</text></outputEntry>
      </rule>
    </decisionTable>
  </decision>
</definitions>`;

const MULTI_OUTPUT_DMN = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="https://www.omg.org/spec/DMN/20191111/MODEL/"
             id="Definitions_2" name="MultiOutput"
             namespace="http://camunda.org/schema/1.0/dmn">
  <decision id="address" name="Address">
    <decisionTable id="dt_2" hitPolicy="UNIQUE">
      <input id="input_2" label="Code">
        <inputExpression id="ie_2" typeRef="string">
          <text>code</text>
        </inputExpression>
      </input>
      <output id="out_city" name="city" typeRef="string" />
      <output id="out_country" name="country" typeRef="string" />
      <rule id="rule_3">
        <inputEntry id="ie_entry_3"><text>"DE"</text></inputEntry>
        <outputEntry id="oe_3"><text>"Berlin"</text></outputEntry>
        <outputEntry id="oe_4"><text>"Germany"</text></outputEntry>
      </rule>
    </decisionTable>
  </decision>
</definitions>`;

const LITERAL_EXPR_DMN = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="https://www.omg.org/spec/DMN/20191111/MODEL/"
             id="Definitions_3" name="LiteralExpr"
             namespace="http://camunda.org/schema/1.0/dmn">
  <decision id="calc" name="Calculation">
    <variable id="var_1" name="result" typeRef="integer" />
    <literalExpression id="le_1">
      <text>x + y</text>
    </literalExpression>
  </decision>
</definitions>`;

const DRG_DMN = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="https://www.omg.org/spec/DMN/20191111/MODEL/"
             id="Definitions_4" name="DRG"
             namespace="http://camunda.org/schema/1.0/dmn">
  <decision id="base" name="Base Score">
    <decisionTable id="dt_base" hitPolicy="FIRST">
      <input id="inp_base" label="Level">
        <inputExpression id="ie_base" typeRef="string">
          <text>level</text>
        </inputExpression>
      </input>
      <output id="out_base" name="score" typeRef="integer" />
      <rule id="rule_base_1">
        <inputEntry id="ie_base_1"><text>"high"</text></inputEntry>
        <outputEntry id="oe_base_1"><text>100</text></outputEntry>
      </rule>
    </decisionTable>
  </decision>
  <decision id="final" name="Final Score">
    <informationRequirement id="req_1">
      <requiredDecision href="#base" />
    </informationRequirement>
    <variable id="var_final" name="finalScore" typeRef="integer" />
    <literalExpression id="le_final">
      <text>score * 2</text>
    </literalExpression>
  </decision>
</definitions>`;

const COLLECT_DMN = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="https://www.omg.org/spec/DMN/20191111/MODEL/"
             id="Definitions_5" name="Collect"
             namespace="http://camunda.org/schema/1.0/dmn">
  <decision id="fees" name="Fees">
    <decisionTable id="dt_fees" hitPolicy="COLLECT" aggregation="SUM">
      <input id="inp_fees" label="Type">
        <inputExpression id="ie_fees">
          <text>type</text>
        </inputExpression>
      </input>
      <output id="out_fee" name="fee" typeRef="integer" />
      <rule id="rule_fee_1">
        <inputEntry id="ie_fee_1"><text>-</text></inputEntry>
        <outputEntry id="oe_fee_1"><text>10</text></outputEntry>
      </rule>
    </decisionTable>
  </decision>
</definitions>`;

// ── Tests ────────────────────────────────────────────────────────────

describe("parseDmnXml", () => {
    // ── Model metadata ────────────────────────────────────────────

    describe("model metadata", () => {
        it("parses model id and name", async () => {
            const model = await parseDmnXml(DECISION_TABLE_DMN);
            expect(model.id).toBe("Definitions_1");
            expect(model.name).toBe("TestModel");
        });

        it("parses namespace", async () => {
            const model = await parseDmnXml(DECISION_TABLE_DMN);
            expect(model.namespace).toBe("http://camunda.org/schema/1.0/dmn");
        });

        it("creates decision map", async () => {
            const model = await parseDmnXml(DECISION_TABLE_DMN);
            expect(model.decisions.size).toBe(1);
            expect(model.decisions.has("greeting")).toBe(true);
        });
    });

    // ── Decision table ─────────────────────────────────────────────

    describe("decision table", () => {
        it("parses decision id and name", async () => {
            const model = await parseDmnXml(DECISION_TABLE_DMN);
            const decision = model.decisions.get("greeting")!;
            expect(decision.id).toBe("greeting");
            expect(decision.name).toBe("Greeting");
        });

        it("identifies logic type as decisionTable", async () => {
            const model = await parseDmnXml(DECISION_TABLE_DMN);
            const decision = model.decisions.get("greeting")!;
            expect(decision.logic?.type).toBe("decisionTable");
        });

        it("parses hit policy", async () => {
            const model = await parseDmnXml(DECISION_TABLE_DMN);
            const dt = model.decisions.get("greeting")!
                .logic as DmnDecisionTable;
            expect(dt.hitPolicy).toBe("FIRST");
        });

        it("defaults to UNIQUE when hitPolicy is absent", async () => {
            const model = await parseDmnXml(MULTI_OUTPUT_DMN);
            const dt = model.decisions.get("address")!
                .logic as DmnDecisionTable;
            expect(dt.hitPolicy).toBe("UNIQUE");
        });

        it("parses input expression and typeRef", async () => {
            const model = await parseDmnXml(DECISION_TABLE_DMN);
            const dt = model.decisions.get("greeting")!
                .logic as DmnDecisionTable;
            expect(dt.inputs).toHaveLength(1);
            expect(dt.inputs[0].label).toBe("Name");
            expect(dt.inputs[0].expression).toBe("name");
            expect(dt.inputs[0].typeRef).toBe("string");
        });

        it("parses single output column", async () => {
            const model = await parseDmnXml(DECISION_TABLE_DMN);
            const dt = model.decisions.get("greeting")!
                .logic as DmnDecisionTable;
            expect(dt.outputs).toHaveLength(1);
            expect(dt.outputs[0].name).toBe("result");
            expect(dt.outputs[0].typeRef).toBe("string");
        });

        it("parses multiple output columns", async () => {
            const model = await parseDmnXml(MULTI_OUTPUT_DMN);
            const dt = model.decisions.get("address")!
                .logic as DmnDecisionTable;
            expect(dt.outputs).toHaveLength(2);
            expect(dt.outputs[0].name).toBe("city");
            expect(dt.outputs[1].name).toBe("country");
        });

        it("parses rule input and output entries", async () => {
            const model = await parseDmnXml(DECISION_TABLE_DMN);
            const dt = model.decisions.get("greeting")!
                .logic as DmnDecisionTable;
            expect(dt.rules).toHaveLength(2);
            expect(dt.rules[0].id).toBe("rule_1");
            expect(dt.rules[0].inputEntries).toEqual(['"Alice"']);
            expect(dt.rules[0].outputEntries).toEqual(['"Hello Alice"']);
        });

        it("parses wildcard input entry", async () => {
            const model = await parseDmnXml(DECISION_TABLE_DMN);
            const dt = model.decisions.get("greeting")!
                .logic as DmnDecisionTable;
            expect(dt.rules[1].inputEntries).toEqual(["-"]);
        });

        it("parses COLLECT hit policy with aggregation", async () => {
            const model = await parseDmnXml(COLLECT_DMN);
            const dt = model.decisions.get("fees")!.logic as DmnDecisionTable;
            expect(dt.hitPolicy).toBe("COLLECT");
            expect(dt.aggregation).toBe("SUM");
        });
    });

    // ── Literal expression ─────────────────────────────────────────

    describe("literal expression", () => {
        it("identifies logic type as literalExpression", async () => {
            const model = await parseDmnXml(LITERAL_EXPR_DMN);
            expect(model.decisions.get("calc")!.logic?.type).toBe(
                "literalExpression"
            );
        });

        it("parses expression text", async () => {
            const model = await parseDmnXml(LITERAL_EXPR_DMN);
            const le = model.decisions.get("calc")!
                .logic as DmnLiteralExpression;
            expect(le.expression).toBe("x + y");
        });

        it("reads typeRef from decision-level variable", async () => {
            const model = await parseDmnXml(LITERAL_EXPR_DMN);
            const le = model.decisions.get("calc")!
                .logic as DmnLiteralExpression;
            expect(le.typeRef).toBe("integer");
        });

        it("reads variable name from decision-level variable", async () => {
            const model = await parseDmnXml(LITERAL_EXPR_DMN);
            const le = model.decisions.get("calc")!
                .logic as DmnLiteralExpression;
            expect(le.variable).toBe("result");
        });
    });

    // ── Information requirements (DRG) ────────────────────────────

    describe("information requirements", () => {
        it("parses single information requirement", async () => {
            const model = await parseDmnXml(DRG_DMN);
            expect(model.decisions.size).toBe(2);
            const finalDecision = model.decisions.get("final")!;
            expect(finalDecision.informationRequirements).toEqual(["base"]);
        });

        it("standalone decision has empty requirements", async () => {
            const model = await parseDmnXml(DRG_DMN);
            const baseDecision = model.decisions.get("base")!;
            expect(baseDecision.informationRequirements).toHaveLength(0);
        });
    });

    // ── Edge cases ─────────────────────────────────────────────────

    describe("edge cases", () => {
        it("handles decision with no logic gracefully", async () => {
            const xml = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="https://www.omg.org/spec/DMN/20191111/MODEL/"
             id="Def1" name="Empty" namespace="http://test">
  <decision id="empty" name="Empty Decision" />
</definitions>`;
            const model = await parseDmnXml(xml);
            const decision = model.decisions.get("empty")!;
            expect(decision.logic).toBeNull();
        });

        it("handles empty definitions element", async () => {
            const xml = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="https://www.omg.org/spec/DMN/20191111/MODEL/"
             id="Def2" name="NoDecisions" namespace="http://test">
</definitions>`;
            const model = await parseDmnXml(xml);
            expect(model.decisions.size).toBe(0);
        });

        it("falls back to id when decision name is absent", async () => {
            const xml = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="https://www.omg.org/spec/DMN/20191111/MODEL/"
             id="Def3" name="NoName" namespace="http://test">
  <decision id="d1">
    <decisionTable id="dt1" />
  </decision>
</definitions>`;
            const model = await parseDmnXml(xml);
            const decision = model.decisions.get("d1")!;
            expect(decision.name).toBe("d1");
        });

        it("parses expressionLanguage from input expression", async () => {
            const xml = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="https://www.omg.org/spec/DMN/20191111/MODEL/"
             id="Def4" name="ExprLang" namespace="http://test">
  <decision id="d1" name="D1">
    <decisionTable id="dt1" hitPolicy="FIRST">
      <input id="i1" label="X">
        <inputExpression id="ie1" typeRef="integer" expressionLanguage="juel">
          <text>x</text>
        </inputExpression>
      </input>
      <output id="o1" name="result" typeRef="string" />
      <rule id="r1">
        <inputEntry id="ie1_1"><text>-</text></inputEntry>
        <outputEntry id="oe1_1"><text>"ok"</text></outputEntry>
      </rule>
    </decisionTable>
  </decision>
</definitions>`;
            const model = await parseDmnXml(xml);
            const dt = model.decisions.get("d1")!
                .logic as import("./parse").DmnDecisionTable;
            expect(dt.inputs[0].expressionLanguage).toBe("juel");
        });

        it("parses expressionLanguage from literal expression", async () => {
            const xml = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="https://www.omg.org/spec/DMN/20191111/MODEL/"
             id="Def5" name="LELang" namespace="http://test">
  <decision id="le1" name="LE1">
    <variable id="var1" name="result" typeRef="integer" />
    <literalExpression id="lex1" expressionLanguage="groovy">
      <text>x + 1</text>
    </literalExpression>
  </decision>
</definitions>`;
            const model = await parseDmnXml(xml);
            const le = model.decisions.get("le1")!
                .logic as import("./parse").DmnLiteralExpression;
            expect(le.expressionLanguage).toBe("groovy");
        });
    });
});
