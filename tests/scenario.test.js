import assert from "node:assert/strict";
import test from "node:test";

import { buildScenario } from "../src/scenario.js";

const { service, migration } = buildScenario();
const state = service.state;

test("场景事件链完整无篡改", () => {
  assert.equal(service.verify().ok, true);
});

test("市场部阶段结果越界宣称全部未通过，限定人群主张通过", () => {
  const decisionOf = (id) => state.claims.get(id).reviews.at(-1).decision;
  assert.equal(decisionOf("claim-a-ifg"), "approved");
  assert.equal(decisionOf("claim-b-universal"), "rejected");
  assert.equal(decisionOf("claim-c-trad-risk"), "needs_evidence");
  assert.equal(decisionOf("claim-d-overreach"), "needs_evidence");
  assert.equal(decisionOf("claim-a2-ifg"), "approved");

  const overreach = state.claims.get("claim-d-overreach").reviews.at(-1).findings;
  assert.ok(overreach.some((f) => f.code === "DOSE_MISMATCH"));
  assert.ok(overreach.some((f) => f.code === "PERIOD_EXCEEDS_EVIDENCE"));
});

test("越界宣称只能引用对应等级证据：传统食养与实验室不能支持风险降低", () => {
  const findings = state.claims.get("claim-c-trad-risk").reviews.at(-1).findings;
  assert.ok(findings.filter((f) => f.code === "EVIDENCE_TIER_INSUFFICIENT").length >= 2);
});

test("供应商未验证切换后：旧人体证据失效、已批准主张暂停；桥接后新主张恢复", () => {
  assert.equal(state.evidence.get("ev-rct1").status, "invalidated");
  assert.ok(state.claims.get("claim-a-ifg").suspended);
  assert.equal(state.evidence.get("ev-bridge").status, "active");
  assert.equal(state.claims.get("claim-a2-ifg").suspended, null);
});

test("迁移评估：旧规格当时合法并给过渡期；证据失效者禁止新生产；草案期冻结不算合规", () => {
  const byId = Object.fromEntries(migration.items.map((i) => [i.formula_version_id, i]));
  assert.equal(byId["formula-F-v0.9"].compliant_at_time, true);
  assert.equal(byId["formula-F-v0.9"].status, "grandfathered_with_deadline");
  assert.match(byId["formula-F-v0.9"].deadline, /^2028-07-/);

  assert.equal(byId["formula-F-v1"].compliant_at_time, true);
  assert.equal(byId["formula-F-v1"].status, "non_compliant_new_production");

  assert.equal(byId["formula-F-v2"].compliant_at_time, false);
  assert.equal(byId["formula-F-v2"].status, "non_compliant_new_production");

  // 发布后按正式版本重新冻结 → 当前合规，但迁移快照内容未被改写
  const info = service.complianceOf("formula-F-v2");
  assert.equal(info.current_status, "compliant_under_current");
  assert.equal(info.migration_snapshot_status, "non_compliant_new_production");
});

test("受试者排除与撤回统计与证据 n_analyzed 一致", () => {
  const cov = service.consentOf("protocol-RCT-01");
  assert.equal(cov.enrolled, 4);
  assert.equal(cov.excluded, 1);
  assert.equal(cov.withdrew_any, 1);
  assert.equal(cov.by_purpose.trial_analysis.usable, 3);
  assert.equal(state.evidence.get("ev-rct1").n_analyzed, 3);
  assert.equal(cov.by_purpose.future_secondary_research.usable, 1);
});

test("利益披露与回避可追溯，编制流程可按 correlation_id 复现", () => {
  const recusals = state.recusals.filter((r) => r.org.includes("华研"));
  assert.equal(recusals.length, 1);
  assert.ok(recusals[0].scope.includes("clause-005"));
  assert.equal(recusals[0].replacement_reviewer_org, "省营养学会");

  const timeline = service.timelineOf("rev-draft");
  assert.deepEqual(
    timeline.stages.map((s) => s.stage),
    ["draft", "revised", "trial", "superseded"],
  );
  const rationale = service.rationaleOf("clause-005");
  assert.equal(rationale.open_objections, 0);
  assert.deepEqual(
    rationale.timeline.map((t) => t.kind),
    ["proposal", "objection", "revision"],
  );
});

test("监管视图只含去标识化汇总", () => {
  const view = service.regulatorInspection({ viewerOrg: "复核局", viewedAt: "2027-07-21T10:00:00+08:00" });
  assert.equal(view.subject_level_records_released, 0);
  const json = JSON.stringify(view);
  assert.ok(!json.includes("PN-RCT01"));
  const protocol = view.protocols.find((p) => p.protocol_id === "protocol-RCT-01");
  assert.equal(protocol.enrolled, 4);
  assert.equal(protocol.excluded, 1);
});
