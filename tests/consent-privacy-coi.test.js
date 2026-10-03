import assert from "node:assert/strict";
import test from "node:test";

import { filterPlanSubjects, isUseAllowed } from "../src/consent.js";
import { assertDeidentified, regulatorView } from "../src/privacy.js";
import { checkVoteEligibility, requiredRecusals, validateVotes } from "../src/coi.js";

const consent = { subject_id: "S-1", allowed_uses: ["efficacy_analysis", "safety_analysis"] };

test("撤回按同意范围停止新用途，撤回前的使用不追溯", () => {
  const withdrawals = [{ subject_id: "S-1", scope: ["efficacy_analysis"], effective_at: "2026-06-01T00:00:00+08:00" }];
  // 撤回后新用途被停止
  assert.equal(isUseAllowed(consent, withdrawals, "efficacy_analysis", "2026-07-01T00:00:00+08:00"), false);
  // 未撤回的用途仍可进行
  assert.equal(isUseAllowed(consent, withdrawals, "safety_analysis", "2026-07-01T00:00:00+08:00"), true);
  // 撤回生效前的使用保持合法
  assert.equal(isUseAllowed(consent, withdrawals, "efficacy_analysis", "2026-05-01T00:00:00+08:00"), true);
});

test("全部撤回与计划过滤", () => {
  const withdrawals = [{ subject_id: "S-2", scope: "all", effective_at: "2026-06-01T00:00:00+08:00" }];
  const consents = [consent, { subject_id: "S-2", allowed_uses: ["efficacy_analysis"] }];
  const plan = { use: "efficacy_analysis", at: "2026-07-01T00:00:00+08:00", subject_ids: ["S-1", "S-2", "S-3"] };
  const { allowed, blocked } = filterPlanSubjects(plan, consents, withdrawals);
  assert.deepEqual(allowed, ["S-1"]);
  assert.deepEqual(blocked.sort(), ["S-2", "S-3"]);
});

test("监管视图为去标识化证据，低人数指标被抑制", () => {
  const evidence = {
    evidence_id: "EV-1",
    level: "human",
    subject_refs: ["S-1", "S-2"],
    indicators: [
      { name: "血红蛋白", value: 5.2 },
      { name: "罕见亚组指标", value: 1.1 },
    ],
  };
  const view = regulatorView(evidence, { 血红蛋白: 30, 罕见亚组指标: 2 });
  assert.equal(view.deidentified, true);
  assert.ok(!("subject_refs" in view));
  assert.deepEqual(view.indicators[0], { name: "血红蛋白", value: 5.2, n: 30 });
  assert.equal(view.indicators[1].suppressed, true);
  assert.equal(assertDeidentified(view), true);
  assert.throws(() => assertDeidentified(evidence), /可识别字段/);
});

test("利益关系披露与回避", () => {
  const disclosures = [{ member_id: "M-1", organization: "某原料企业", related_clause_ids: ["C-糖"] }];
  const recusals = [{ member_id: "M-1", clause_id: "C-糖" }];

  assert.equal(checkVoteEligibility("M-2", "C-糖", disclosures, recusals).eligible, true);
  const recused = checkVoteEligibility("M-1", "C-糖", disclosures, recusals);
  assert.equal(recused.eligible, false);
  assert.equal(recused.violation, false);

  // 披露后未回避即表决 → 违规
  const bad = checkVoteEligibility("M-1", "C-糖", disclosures, []);
  assert.equal(bad.violation, true);
  const result = validateVotes([{ member_id: "M-1", clause_id: "C-糖" }], disclosures, []);
  assert.equal(result.valid, false);
  assert.equal(result.violations.length, 1);

  assert.deepEqual(requiredRecusals("C-糖", disclosures), ["M-1"]);
});
