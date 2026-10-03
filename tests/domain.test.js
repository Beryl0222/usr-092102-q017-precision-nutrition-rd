import assert from "node:assert/strict";
import test from "node:test";

import { EvidenceChainService, EventValidationError } from "../src/service.js";
import { EventStore } from "../src/store.js";

/** 构造最小可用证据链：人群、供应商、配方、方案、人体证据、放大边界。 */
function baseChain({
  claimType = "structure_function",
  tier = "human_pivotal",
  supports = ["structure_function", "risk_reduction"],
  dose = 2,
  period = 84,
  nPositive = 1,
} = {}) {
  const svc = new EvidenceChainService();
  const rec = (e) => svc.record(e);
  rec({
    event_id: "pop",
    event_type: "POPULATION_ASSUMPTION_SET",
    aggregate_type: "population_assumption",
    aggregate_id: "pop-1",
    occurred_at: "2026-09-01T09:00:00+08:00",
    version: 1,
    summary: "人群",
    payload: { population_label: "40-65岁IFG人群", inclusion: ["IFG"], exclusion: ["糖尿病用药"] },
  });
  rec({
    event_id: "sup",
    event_type: "INGREDIENT_SOURCE_REGISTERED",
    aggregate_type: "ingredient_supplier",
    aggregate_id: "sup-1",
    occurred_at: "2026-09-02T09:00:00+08:00",
    version: 1,
    summary: "原料",
    payload: { ingredient_name: "提取物", supplier_name: "甲基地", source_spec: {} },
  });
  rec({
    event_id: "fml",
    event_type: "FORMULA_DESIGNED",
    aggregate_type: "formula_version",
    aggregate_id: "fml-1",
    occurred_at: "2026-09-03T09:00:00+08:00",
    version: 1,
    summary: "配方",
    payload: {
      formula_code: "F",
      version_no: "1.0.0",
      components: [{ ingredient_supplier_id: "sup-1", dose_per_serving: 2, unit: "g" }],
      population_assumption_id: "pop-1",
    },
  });
  rec({
    event_id: "ev",
    event_type: "EVIDENCE_ACCEPTED",
    aggregate_type: "study_evidence",
    aggregate_id: "ev-1",
    occurred_at: "2026-09-10T09:00:00+08:00",
    version: 1,
    summary: "证据",
    payload: {
      evidence_tier: tier,
      title: "研究",
      supports_claim_type: supports,
      formula_version_id: "fml-1",
      ingredient_supplier_ids: ["sup-1"],
      population_assumption_id: "pop-1",
      dose_per_serving: dose,
      dose_unit: "g",
      observation_period_days: period,
      n_analyzed: 30,
      endpoint_results: Array.from({ length: Math.max(nPositive, 1) }, (_, i) => ({
        endpoint: `终点${i}`,
        statistically_significant: i < nPositive,
        clinically_meaningful: i < nPositive,
      })),
    },
  });
  rec({
    event_id: "scale",
    event_type: "SCALE_UP_VERIFIED",
    aggregate_type: "scale_up_batch",
    aggregate_id: "scale-1",
    occurred_at: "2026-09-11T09:00:00+08:00",
    version: 1,
    summary: "放大",
    payload: {
      formula_version_id: "fml-1",
      batch_size: 800,
      batch_size_unit: "kg",
      verified_bounds: { min_batch_size: 500, max_batch_size: 1200 },
      quality_results_conform: true,
    },
  });
  rec({
    event_id: "claim",
    event_type: "CLAIM_DRAFTED",
    aggregate_type: "product_claim",
    aggregate_id: "claim-1",
    occurred_at: "2026-09-12T09:00:00+08:00",
    version: 1,
    summary: "主张",
    payload: {
      claim_text: "有助于维持血糖平稳",
      claim_type: claimType,
      target_population: "40-65岁IFG人群",
      claimed_dose: 2,
      claimed_dose_unit: "g",
      claimed_period_days: 84,
      formula_version_id: "fml-1",
      population_assumption_id: "pop-1",
      commercial_batch_size: 800,
      commercial_batch_size_unit: "kg",
      evidence_ids: ["ev-1"],
    },
  });
  return svc;
}

test("证据等级、人群、剂量、观察期与放大边界全部匹配时主张通过", () => {
  const svc = baseChain();
  const { decision, findings } = svc.reviewClaim("claim-1", { reviewedAt: "2026-09-13T09:00:00+08:00" });
  assert.equal(decision, "approved");
  assert.deepEqual(findings, []);
});

test("传统食养资料与实验室证据不能支持人体功效主张", () => {
  const svc = baseChain({ tier: "traditional", supports: ["traditional_nourishment"] });
  const { decision, findings } = svc.reviewClaim("claim-1", { reviewedAt: "2026-09-13T09:00:00+08:00" });
  assert.notEqual(decision, "approved");
  assert.ok(findings.some((f) => f.code === "EVIDENCE_TIER_INSUFFICIENT"));
});

test("体外实验声称降低疾病风险直接在入库校验阶段被拒", () => {
  const svc = new EvidenceChainService();
  assert.throws(
    () =>
      svc.record({
        event_id: "bad-ev",
        event_type: "EVIDENCE_ACCEPTED",
        aggregate_type: "study_evidence",
        aggregate_id: "bad",
        occurred_at: "2026-09-10T09:00:00+08:00",
        version: 1,
        summary: "x",
        payload: { evidence_tier: "in_vitro_lab", title: "体外", supports_claim_type: ["risk_reduction"] },
      }),
    /人体功效主张/,
  );
});

test("“适合所有人”在任何证据下都被拒绝", () => {
  const svc = baseChain({ claimType: "universal_health" });
  const { decision, findings } = svc.reviewClaim("claim-1", { reviewedAt: "2026-09-13T09:00:00+08:00" });
  assert.equal(decision, "rejected");
  assert.ok(findings.some((f) => f.code === "UNIVERSAL_CLAIM_FORBIDDEN"));

  // 即使 claim_type 普通，target_population=all 同样被硬拒
  svc.record({
    event_id: "claim-all",
    event_type: "CLAIM_DRAFTED",
    aggregate_type: "product_claim",
    aggregate_id: "claim-all",
    occurred_at: "2026-09-12T09:00:00+08:00",
    version: 1,
    summary: "普适宣称",
    payload: {
      claim_text: "所有人适用",
      claim_type: "structure_function",
      target_population: "all",
      claimed_dose: 2,
      claimed_dose_unit: "g",
      claimed_period_days: 84,
      formula_version_id: "fml-1",
      population_assumption_id: "pop-1",
      evidence_ids: ["ev-1"],
    },
  });
  const res2 = svc.reviewClaim("claim-all", { reviewedAt: "2026-09-13T09:00:00+08:00" });
  assert.equal(res2.decision, "rejected");
  assert.ok(res2.findings.some((f) => f.code === "UNIVERSAL_CLAIM_FORBIDDEN"));
});

test("剂量与观察期超出研究边界时被指出", () => {
  const svc = baseChain({ dose: 1, period: 56 });
  const { findings } = svc.reviewClaim("claim-1", { reviewedAt: "2026-09-13T09:00:00+08:00" });
  assert.ok(findings.some((f) => f.code === "DOSE_MISMATCH"), JSON.stringify(findings));
  assert.ok(findings.some((f) => f.code === "PERIOD_EXCEEDS_EVIDENCE"));
});

test("商业批量超出放大验证边界被硬拒；低于下限同样越界", () => {
  const svc = baseChain();
  svc.record({
    event_id: "claim-big",
    event_type: "CLAIM_DRAFTED",
    aggregate_type: "product_claim",
    aggregate_id: "claim-big",
    occurred_at: "2026-09-12T09:05:00+08:00",
    version: 1,
    summary: "超大批量主张",
    payload: {
      claim_text: "量产宣称",
      claim_type: "structure_function",
      target_population: "40-65岁IFG人群",
      claimed_dose: 2,
      claimed_dose_unit: "g",
      claimed_period_days: 84,
      formula_version_id: "fml-1",
      population_assumption_id: "pop-1",
      commercial_batch_size: 2000,
      commercial_batch_size_unit: "kg",
      evidence_ids: ["ev-1"],
    },
  });
  const findings = svc.reviewClaim("claim-big", { reviewedAt: "2026-09-13T09:00:00+08:00" }).findings;
  assert.equal(findings.some((f) => f.code === "SCALE_UP_OUT_OF_BOUNDS"), true, JSON.stringify(findings));

  assert.equal(svc.scaleUpBoundary("fml-1", 100, "kg").verifiable, true); // 100kg 低于下限→可验证但越界
  assert.equal(svc.scaleUpBoundary("fml-1", 100, "kg").within, false);
  assert.equal(svc.scaleUpBoundary("fml-1", 800, "kg").within, true);
});

test("原料来源等效性未验证：人体证据失效、已批准主张自动暂停", () => {
  const svc = baseChain();
  svc.reviewClaim("claim-1", { reviewedAt: "2026-09-13T09:00:00+08:00" });
  assert.equal(svc.state.claims.get("claim-1").reviews.at(-1).decision, "approved");

  svc.changeIngredientSource({
    event_id: "chg",
    event_type: "INGREDIENT_SOURCE_CHANGED",
    aggregate_type: "ingredient_supplier",
    aggregate_id: "sup-1",
    occurred_at: "2026-10-01T09:00:00+08:00",
    version: 1,
    summary: "换厂未验证",
    payload: { old_source: "甲基地", new_source: "乙基地", change_reason: "断供", equivalence_claim: "unverified" },
  });

  assert.equal(svc.state.evidence.get("ev-1").status, "invalidated");
  assert.ok(svc.state.claims.get("claim-1").suspended);
  const { decision } = svc.reviewClaim("claim-1", { reviewedAt: "2026-10-02T09:00:00+08:00" });
  assert.notEqual(decision, "approved");
  const impact = [...svc.state.impacts.values()].find((i) => i.change_event_id === "chg");
  assert.equal(impact.affected_evidence[0].impact, "invalidated");
  assert.equal(impact.revalidation_required, true);
});

test("规格完全一致的来源变更仅监测，不失效证据", () => {
  const svc = baseChain();
  svc.changeIngredientSource({
    event_id: "chg2",
    event_type: "INGREDIENT_SOURCE_CHANGED",
    aggregate_type: "ingredient_supplier",
    aggregate_id: "sup-1",
    occurred_at: "2026-10-01T09:00:00+08:00",
    version: 1,
    summary: "同规格换厂",
    payload: { old_source: "甲基地", new_source: "甲基地二厂", change_reason: "扩产", equivalence_claim: "identical_spec" },
  });
  assert.equal(svc.state.evidence.get("ev-1").status, "active");
  assert.equal(svc.state.claims.get("claim-1").suspended, null);
});

test("未决严重安全事件阻断功效主张；裁决后可放行", () => {
  const svc = baseChain();
  svc.record({
    event_id: "se",
    event_type: "SAFETY_EVENT_REPORTED",
    aggregate_type: "safety_event",
    aggregate_id: "se-1",
    occurred_at: "2026-09-12T12:00:00+08:00",
    version: 1,
    summary: "严重事件",
    payload: { severity: "serious", related_formula_version_id: "fml-1", reported_at: "2026-09-12T12:00:00+08:00" },
  });
  let findings = svc.reviewClaim("claim-1", { reviewedAt: "2026-09-13T09:00:00+08:00" }).findings;
  assert.ok(findings.some((f) => f.code === "UNRESOLVED_SAFETY"));

  svc.record({
    event_id: "se-adj",
    event_type: "SAFETY_EVENT_ADJUDICATED",
    aggregate_type: "safety_event",
    aggregate_id: "se-1",
    occurred_at: "2026-09-14T09:00:00+08:00",
    version: 1,
    summary: "裁决排除",
    payload: { causality_assessment: "unrelated", adjudication: "dismissed", adjudicator_org: "安全组" },
  });
  findings = svc.reviewClaim("claim-1", { reviewedAt: "2026-09-15T09:00:00+08:00" }).findings;
  assert.deepEqual(findings, []);
});

test("利益关系披露但未回避时审查被拒；执行回避后可正常审查", () => {
  const svc = baseChain();
  svc.record({
    event_id: "coi",
    event_type: "COI_DECLARED",
    aggregate_type: "coi_declaration",
    aggregate_id: "coi-1",
    occurred_at: "2026-09-05T09:00:00+08:00",
    version: 1,
    summary: "披露资助",
    payload: { org: "甲企业", interest_type: "funding", related_entity: "fml-1", declared_at: "2026-09-05T09:00:00+08:00" },
  });
  let res = svc.reviewClaim("claim-1", { reviewerOrg: "甲企业", reviewedAt: "2026-09-13T09:00:00+08:00" });
  assert.equal(res.decision, "rejected");
  assert.ok(res.findings.some((f) => f.code === "REVIEWER_CONFLICT_NOT_RECUSAL"));

  svc.record({
    event_id: "rec",
    event_type: "RECUSAL_ENFORCED",
    aggregate_type: "coi_declaration",
    aggregate_id: "coi-1",
    occurred_at: "2026-09-06T09:00:00+08:00",
    version: 1,
    summary: "回避",
    payload: { org: "甲企业", scope: "claim-1", replacement_reviewer_org: "学会" },
  });
  res = svc.reviewClaim("claim-1", { reviewerOrg: "甲企业", reviewedAt: "2026-09-13T10:00:00+08:00" });
  assert.equal(res.decision, "approved");
});

test("受试者撤回只停止同意范围的新用途；被排除者不进入分析", () => {
  const svc = new EvidenceChainService();
  const enroll = (id, pseudo, scope) =>
    svc.record({
      event_id: `en-${id}`,
      event_type: "SUBJECT_ENROLLED",
      aggregate_type: "subject",
      aggregate_id: id,
      occurred_at: "2026-09-01T09:00:00+08:00",
      version: 1,
      summary: pseudo,
      payload: { trial_protocol_id: "pr", pseudonymous_id: pseudo, consent_scope: scope, enrolled_at: "2026-09-01T09:00:00+08:00" },
    });
  enroll("s1", "S001", ["trial_analysis", "future_secondary_research", "regulatory_inspection"]);
  enroll("s2", "S002", ["trial_analysis", "regulatory_inspection"]);
  svc.record({
    event_id: "wd",
    event_type: "SUBJECT_CONSENT_WITHDRAWN",
    aggregate_type: "subject",
    aggregate_id: "s1",
    occurred_at: "2026-09-10T09:00:00+08:00",
    version: 1,
    summary: "撤回二次研究",
    payload: { withdrawn_scope: ["future_secondary_research"], withdrawn_at: "2026-09-10T09:00:00+08:00", retain_until: "2031-12-31T23:59:59+08:00" },
  });
  svc.record({
    event_id: "ex",
    event_type: "SUBJECT_EXCLUDED",
    aggregate_type: "subject",
    aggregate_id: "s2",
    occurred_at: "2026-09-11T09:00:00+08:00",
    version: 1,
    summary: "按方案规则排除",
    payload: { trial_protocol_id: "pr", rule_applied: "依从性<80%", pre_registered_rule: true },
  });

  const cov = svc.consentOf("pr");
  assert.equal(cov.enrolled, 2);
  assert.equal(cov.excluded, 1);
  assert.equal(cov.by_purpose.future_secondary_research.usable, 0); // s1撤回、s2未授权
  assert.equal(cov.by_purpose.trial_analysis.usable, 1); // s1仍同意、s2被排除
  assert.equal(cov.by_purpose.regulatory_inspection.usable, 1);
});

test("监管视图不含任何受试者明细，且查看动作落审计", () => {
  const svc = baseChain();
  const view = svc.regulatorInspection({ viewerOrg: "监管局", viewedAt: "2026-09-20T09:00:00+08:00" });
  assert.equal(view.de_identified, true);
  assert.equal(view.subject_level_records_released, 0);
  assert.ok(!JSON.stringify(view).includes("pseudonymous"));
  assert.ok(!JSON.stringify(view).includes("S00"));
  const audit = svc.state.audit.at(-1);
  assert.equal(audit.viewer_org, "监管局");
  assert.equal(audit.de_identified, true);
});

test("条款理由链复现提案、异议、修订的完整顺序", () => {
  const svc = new EvidenceChainService();
  const base = {
    aggregate_type: "standard_clause",
    aggregate_id: "c1",
  };
  svc.record({ ...base, event_id: "p", event_type: "CLAUSE_PROPOSED", occurred_at: "2026-09-01T09:00:00+08:00", version: 1, summary: "提案",
    payload: { standard_revision_id: "r1", clause_no: "1", text: "原文", proposer_org: "院所" } });
  svc.record({ ...base, event_id: "o", event_type: "CLAUSE_OBJECTED", occurred_at: "2026-09-02T09:00:00+08:00", version: 1, summary: "异议",
    payload: { standard_revision_id: "r1", reason: "过严", objector_org: "企业", resolution: "pending" } });
  svc.record({ ...base, event_id: "rv", event_type: "CLAUSE_REVISED", occurred_at: "2026-09-03T09:00:00+08:00", version: 1, summary: "修订",
    payload: { standard_revision_id: "r1", text: "新文", change_reason: "折中", responds_to_objection_ids: ["o"] } });

  const rationale = svc.rationaleOf("c1");
  assert.deepEqual(rationale.timeline.map((t) => t.kind), ["proposal", "objection", "revision"]);
  assert.equal(rationale.open_objections, 0);
  assert.equal(rationale.timeline[2].text, "新文");
});

test("标准迁移：当时合法的版本不被追溯篡改，区分祖父过渡与不得新生产", () => {
  const svc = new EvidenceChainService();
  const propose = (id, no, at, basedOn) =>
    svc.record({
      event_id: `prop-${id}`,
      event_type: "STANDARD_PROPOSED",
      aggregate_type: "standard_revision",
      aggregate_id: id,
      occurred_at: at,
      version: 1,
      summary: no,
      payload: { standard_code: "T/X", revision_no: no, lifecycle_stage: "draft", proposing_org: "学会", ...(basedOn ? { based_on_revision: basedOn } : {}) },
    });
  const formula = (id, at, rev) => {
    svc.record({
      event_id: `d-${id}`,
      event_type: "FORMULA_DESIGNED",
      aggregate_type: "formula_version",
      aggregate_id: id,
      occurred_at: at,
      version: 1,
      summary: id,
      payload: { formula_code: "F", version_no: id, components: [] },
    });
    svc.record({
      event_id: `fz-${id}`,
      event_type: "FORMULA_FROZEN",
      aggregate_type: "formula_version",
      aggregate_id: id,
      occurred_at: at,
      version: 1,
      summary: "冻结",
      payload: { frozen_for_purpose: "market_supply", standard_revision_id: rev },
    });
  };

  propose("r1", "1.0.0", "2026-01-01T09:00:00+08:00");
  // r1 发布（需要作为单独事件追加，version 连续）
  svc.record({
    event_id: "pub-r1",
    event_type: "STANDARD_PUBLISHED",
    aggregate_type: "standard_revision",
    aggregate_id: "r1",
    occurred_at: "2026-02-01T09:00:00+08:00",
    version: 1,
    summary: "r1发布",
    payload: { lifecycle_stage: "published", effective_date: "2026-02-01" },
  });
  formula("fA", "2026-03-01T09:00:00+08:00", "r1");

  // fB 同样依据 r1 合法冻结，但随后证据失效
  formula("fB", "2026-03-02T09:00:00+08:00", "r1");

  propose("r2", "2.0.0", "2027-01-01T09:00:00+08:00", "r1");
  const { migration } = svc.publishStandard(
    {
      event_id: "pub-r2",
      event_type: "STANDARD_PUBLISHED",
      aggregate_type: "standard_revision",
      aggregate_id: "r2",
      occurred_at: "2027-02-01T09:00:00+08:00",
      version: 1,
      summary: "r2发布",
      payload: { lifecycle_stage: "published", effective_date: "2027-02-01", supersedes: "r1" },
    },
    { oldRevisionId: "r1", transitionDays: 365 },
  );

  const a = migration.items.find((i) => i.formula_version_id === "fA");
  assert.equal(a.compliant_at_time, true);
  assert.equal(a.status, "grandfathered_with_deadline");
  assert.match(a.deadline, /^2028-02-01$/);

  // fB 证据失效路径
  svc.record({
    event_id: "evB",
    event_type: "EVIDENCE_ACCEPTED",
    aggregate_type: "study_evidence",
    aggregate_id: "evB",
    occurred_at: "2026-03-03T09:00:00+08:00",
    version: 1,
    summary: "fB证据",
    payload: { evidence_tier: "human_pivotal", title: "t", supports_claim_type: ["structure_function"], formula_version_id: "fB",
      ingredient_supplier_ids: [], population_assumption_id: null, dose_per_serving: 1, dose_unit: "g", observation_period_days: 30,
      endpoint_results: [{ endpoint: "x", statistically_significant: true, clinically_meaningful: true }] },
  });
  // 手工写入影响评估以标记失效（模拟供应商变更后果）
  svc.record({
    event_id: "impB",
    event_type: "IMPACT_ASSESSED",
    aggregate_type: "impact_assessment",
    aggregate_id: "impB",
    occurred_at: "2027-03-01T09:00:00+08:00",
    version: 1,
    summary: "失效",
    payload: {
      change_event_id: "chgB",
      change_kind: "ingredient_source",
      affected_evidence: [{ id: "evB", impact: "invalidated", reason: "x" }],
      affected_claims: [],
      affected_safety: [],
      revalidation_required: true,
    },
  });
  const info = svc.complianceOf("fB");
  assert.equal(info.evidence_summary.invalidated, 1);
  assert.equal(info.current_status, "non_compliant_new_production");

  // 历史事件原样保留
  const frozenEvent = svc.store.eventsFor("fA").find((e) => e.event_id === "fz-fA");
  assert.equal(frozenEvent.payload.standard_revision_id, "r1");
});

test("只追加存储：版本必须连续；链持久化后任何篡改/删除都被检出", () => {
  const svc = new EvidenceChainService();
  const coi = (eventId, aggId, at) =>
    svc.record({
      event_id: eventId,
      event_type: "COI_DECLARED",
      aggregate_type: "coi_declaration",
      aggregate_id: aggId,
      occurred_at: at,
      version: 1,
      summary: eventId,
      payload: { org: "o", interest_type: "other", related_entity: "e", declared_at: at },
    });
  coi("e1", "x", "2026-09-01T09:00:00+08:00");
  // 服务层自动分配连续版本；跳号在存储层被拒
  assert.throws(
    () =>
      svc.store.append({
        event_id: "e3",
        event_type: "COI_DECLARED",
        aggregate_type: "coi_declaration",
        aggregate_id: "x",
        occurred_at: "2026-09-02T09:00:00+08:00",
        version: 3, // 跳号
        summary: "b",
        payload: { org: "o", interest_type: "other", related_entity: "e", declared_at: "2026-09-02T09:00:00+08:00" },
      }),
    /版本冲突/,
  );
  coi("e2", "y", "2026-09-03T09:00:00+08:00");
  assert.throws(() => coi("e1", "z", "2026-09-04T09:00:00+08:00"), /重复/);

  // 正常持久化 → 可载入且通过完整性校验
  const chain = svc.store.dumpChain();
  const loaded = EventStore.loadChain(chain);
  assert.equal(loaded.ok, true);
  assert.equal(loaded.store.verifyIntegrity().ok, true);
  assert.equal(loaded.store.events().length, 2);

  // 篡改历史事件字段 → 载入被拒
  const tampered = structuredClone(chain);
  tampered.events[0].payload.org = "被改写的单位";
  const bad1 = EventStore.loadChain(tampered);
  assert.equal(bad1.ok, false);
  assert.equal(bad1.broken_at_seq, 1);

  // 删除链首事件并重排（等价于改写历史起点）→ 后续 prev 锚点全部失配
  const deleted = structuredClone(chain);
  deleted.events.shift();
  deleted.hashes.shift();
  assert.equal(EventStore.loadChain(deleted).ok, false);

  // 校验失败事件不会被静默写入：EventValidationError 携带逐条原因
  assert.throws(
    () =>
      svc.record({
        event_id: "bad",
        event_type: "CLAIM_REVIEWED",
        aggregate_type: "product_claim",
        aggregate_id: "claim-1",
        occurred_at: "2026-09-05T09:00:00+08:00",
        version: 1,
        summary: "缺 payload",
      }),
    EventValidationError,
  );
});
