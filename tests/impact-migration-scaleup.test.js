import assert from "node:assert/strict";
import test from "node:test";

import { computeImpact } from "../src/impact.js";
import { assessMigration, evaluateAgainst } from "../src/migration.js";
import { evaluateScaleUp } from "../src/scaleup.js";

const evidences = [
  { evidence_id: "EV-1", level: "human", formula_version_id: "FV-1", ingredient_batches: [{ ingredient_id: "ING-A", supplier: "SUP-甲", batch_id: "B-01" }], safety_events: [] },
  { evidence_id: "EV-2", level: "lab", formula_version_id: "FV-9", ingredient_batches: [{ ingredient_id: "ING-A", supplier: "SUP-甲", batch_id: "B-77" }], safety_events: [{ id: "SAE-1" }] },
  { evidence_id: "EV-3", level: "human", formula_version_id: "FV-2", ingredient_batches: [{ ingredient_id: "ING-C", supplier: "SUP-丙", batch_id: "B-03" }], safety_events: [] },
];

const claims = [
  { claim_id: "CL-1", supported_by: ["EV-1"] },
  { claim_id: "CL-2", supported_by: ["EV-3"] },
];

test("供应商变化命中关联证据并联动主张", () => {
  const change = {
    formula_id: "F-1",
    from_version_id: "FV-1",
    to_version_id: "FV-2",
    changed_ingredients: [{ ingredient_id: "ING-A", from_supplier: "SUP-甲", to_supplier: "SUP-乙", from_batch: "B-01", to_batch: "B-02" }],
  };
  const impact = computeImpact(change, evidences, claims);
  // EV-1 命中配方版本，EV-2 命中同一供应商；EV-3 不受影响
  assert.deepEqual(impact.affected_evidence.map((e) => e.evidence_id).sort(), ["EV-1", "EV-2"]);
  assert.equal(impact.requires_revalidation, true);
  assert.deepEqual(impact.affected_claims, ["CL-1"]);
  // 含安全事件的证据被标注
  assert.equal(impact.affected_evidence.find((e) => e.evidence_id === "EV-2").kind, "safety+efficacy");
});

const stdV1 = { standard_id: "STD-1.0", clauses: [{ clause_id: "C-糖", parameter: "sugar", comparator: "<=", limit: 10 }] };
const stdV2 = { standard_id: "STD-2.0", clauses: [{ clause_id: "C-糖", parameter: "sugar", comparator: "<=", limit: 5 }] };

test("标准更新生成迁移评估，历史判定不被改写", () => {
  const subjects = [
    { subject_id: "P-低糖", params: { sugar: 3 } },
    { subject_id: "P-临界", params: { sugar: 8 } },
  ];
  const a = assessMigration(stdV1, stdV2, subjects);
  assert.deepEqual(a.newly_non_compliant, ["P-临界"]);
  const item = a.items.find((i) => i.subject_id === "P-临界");
  assert.equal(item.transition, "newly_non_compliant");
  // 旧版本下的合规结论原样保留
  assert.equal(item.before.compliant, true);
  assert.equal(item.after.compliant, false);
});

test("单版本合规判定", () => {
  assert.equal(evaluateAgainst(stdV1, { sugar: 8 }).compliant, true);
  assert.equal(evaluateAgainst(stdV2, { sugar: 8 }).compliant, false);
});

test("放大边界评估", () => {
  const boundary = { batch_size: { min: 10, max: 100 }, params: { 温度: { min: 60, max: 80 } } };
  assert.deepEqual(evaluateScaleUp(boundary, { batch_size: 50, params: { 温度: 70 } }), { within_boundary: true, deviations: [], requires_revalidation: false });

  const out = evaluateScaleUp(boundary, { batch_size: 500, params: { 温度: 90 } });
  assert.equal(out.within_boundary, false);
  assert.equal(out.requires_revalidation, true);
  assert.equal(out.deviations.length, 2);
});
