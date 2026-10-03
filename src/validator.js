import { createHash } from "node:crypto";

const requiredEnvelope = [
  "event_id",
  "event_type",
  "aggregate_type",
  "aggregate_id",
  "occurred_at",
  "version",
  "summary",
];

// 事件类型 → 所属聚合；与 contracts/domain.schema.json 的 if/then 保持一致，
// tests/contract.test.js 会校验两者不漂移。
export const eventAggregateMap = {
  STANDARD_PROPOSED: "standard_revision",
  STANDARD_DRAFT_REVISED: "standard_revision",
  STANDARD_TRIAL_ISSUED: "standard_revision",
  STANDARD_PUBLISHED: "standard_revision",
  STANDARD_SUPERSEDED: "standard_revision",
  CLAUSE_PROPOSED: "standard_clause",
  CLAUSE_OBJECTED: "standard_clause",
  CLAUSE_REVISED: "standard_clause",
  INGREDIENT_SOURCE_REGISTERED: "ingredient_supplier",
  INGREDIENT_SOURCE_CHANGED: "ingredient_supplier",
  BATCH_TEST_RECORDED: "ingredient_batch",
  BATCH_STABILITY_RECORDED: "ingredient_batch",
  POPULATION_ASSUMPTION_SET: "population_assumption",
  FORMULA_DESIGNED: "formula_version",
  FORMULA_FROZEN: "formula_version",
  TRIAL_PROTOCOL_REGISTERED: "trial_protocol",
  SUBJECT_ENROLLED: "subject",
  SUBJECT_EXCLUDED: "subject",
  SUBJECT_CONSENT_WITHDRAWN: "subject",
  EVIDENCE_ACCEPTED: "study_evidence",
  SAFETY_EVENT_REPORTED: "safety_event",
  SAFETY_EVENT_ADJUDICATED: "safety_event",
  SCALE_UP_VERIFIED: "scale_up_batch",
  CLAIM_DRAFTED: "product_claim",
  CLAIM_REVIEWED: "product_claim",
  CLAIM_SUSPENDED: "product_claim",
  COI_DECLARED: "coi_declaration",
  RECUSAL_ENFORCED: "coi_declaration",
  IMPACT_ASSESSED: "impact_assessment",
  MIGRATION_ASSESSED: "migration_assessment",
  EVIDENCE_VIEWED: "audit_log",
};

// 每类事件 payload 必填字段
const requiredPayload = {
  STANDARD_PROPOSED: ["standard_code", "revision_no", "lifecycle_stage", "proposing_org"],
  STANDARD_DRAFT_REVISED: ["revision_no", "change_note"],
  STANDARD_TRIAL_ISSUED: ["lifecycle_stage", "trial_period_end"],
  STANDARD_PUBLISHED: ["lifecycle_stage", "effective_date"],
  STANDARD_SUPERSEDED: ["superseded_by", "effective_date"],
  CLAUSE_PROPOSED: ["standard_revision_id", "clause_no", "text", "proposer_org"],
  CLAUSE_OBJECTED: ["standard_revision_id", "reason", "objector_org"],
  CLAUSE_REVISED: ["standard_revision_id", "text", "change_reason"],
  INGREDIENT_SOURCE_REGISTERED: ["ingredient_name", "supplier_name", "source_spec"],
  INGREDIENT_SOURCE_CHANGED: ["old_source", "new_source", "change_reason"],
  BATCH_TEST_RECORDED: ["batch_no", "supplier_id", "test_report_no", "results"],
  BATCH_STABILITY_RECORDED: ["batch_no", "condition", "duration_days", "conforms"],
  POPULATION_ASSUMPTION_SET: ["population_label", "inclusion", "exclusion"],
  FORMULA_DESIGNED: ["formula_code", "version_no", "components"],
  FORMULA_FROZEN: ["frozen_for_purpose"],
  TRIAL_PROTOCOL_REGISTERED: [
    "formula_version_id",
    "population_assumption_id",
    "design",
    "dose_per_serving",
    "dose_unit",
    "observation_period_days",
    "endpoints",
  ],
  SUBJECT_ENROLLED: ["trial_protocol_id", "pseudonymous_id", "consent_scope", "enrolled_at"],
  SUBJECT_EXCLUDED: ["trial_protocol_id", "rule_applied"],
  SUBJECT_CONSENT_WITHDRAWN: ["withdrawn_scope", "withdrawn_at", "retain_until"],
  EVIDENCE_ACCEPTED: ["evidence_tier", "title", "supports_claim_type"],
  SAFETY_EVENT_REPORTED: ["severity", "related_formula_version_id", "reported_at"],
  SAFETY_EVENT_ADJUDICATED: ["causality_assessment", "adjudication"],
  SCALE_UP_VERIFIED: ["formula_version_id", "batch_size", "batch_size_unit", "verified_bounds"],
  CLAIM_DRAFTED: [
    "claim_text",
    "claim_type",
    "target_population",
    "claimed_dose",
    "claimed_dose_unit",
    "claimed_period_days",
  ],
  CLAIM_REVIEWED: ["decision", "findings"],
  CLAIM_SUSPENDED: ["reason"],
  COI_DECLARED: ["org", "interest_type", "related_entity", "declared_at"],
  RECUSAL_ENFORCED: ["org", "scope", "replacement_reviewer_org"],
  IMPACT_ASSESSED: ["change_event_id", "change_kind", "affected_evidence", "affected_claims", "affected_safety"],
  MIGRATION_ASSESSED: ["old_standard_revision_id", "new_standard_revision_id", "items"],
  EVIDENCE_VIEWED: ["viewer_org", "purpose", "viewed_at", "de_identified"],
};

// 禁止进入证据链的受试者个人身份字段（监管查看只看去标识化证据）
const forbiddenSubjectFields = ["name", "real_name", "id_card", "passport_no", "phone", "mobile", "email", "address"];

const isoDateTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const isoDate = /^\d{4}-\d{2}-\d{2}$/;

/** 校验单条领域事件；返回错误信息数组，空数组表示通过。 */
export function validateEvent(record) {
  const errors = requiredEnvelope
    .filter((name) => !(name in record))
    .map((name) => `缺少字段：${name}`);
  if (errors.length > 0) return errors;

  if (!Number.isInteger(record.version) || record.version < 1) {
    errors.push("version 必须是正整数");
  }
  if (typeof record.occurred_at !== "string" || !isoDateTime.test(record.occurred_at)) {
    errors.push("occurred_at 必须是带时区的 ISO-8601 日期时间");
  }
  if (typeof record.event_id !== "string" || record.event_id.length === 0) errors.push("event_id 不能为空");
  if (typeof record.aggregate_id !== "string" || record.aggregate_id.length === 0) errors.push("aggregate_id 不能为空");
  if (typeof record.summary !== "string" || record.summary.length === 0) errors.push("summary 不能为空");

  const expectedAggregate = eventAggregateMap[record.event_type];
  if (!expectedAggregate) {
    errors.push(`未知事件类型：${record.event_type}`);
    return errors;
  }
  if (record.aggregate_type !== expectedAggregate) {
    errors.push(`事件 ${record.event_type} 的 aggregate_type 必须是 ${expectedAggregate}`);
  }

  const payload = record.payload;
  if (payload === undefined || payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    errors.push(`${record.event_type} 必须携带对象类型 payload`);
    return errors;
  }
  for (const field of requiredPayload[record.event_type] ?? []) {
    if (!(field in payload)) errors.push(`payload 缺少字段：${field}`);
  }

  // 语义约束（与 schema 的 const/enum 对应）
  const p = payload;
  switch (record.event_type) {
    case "STANDARD_PROPOSED":
      if (p.lifecycle_stage !== "draft") errors.push("STANDARD_PROPOSED 的 lifecycle_stage 必须为 draft");
      break;
    case "STANDARD_TRIAL_ISSUED":
      if (p.lifecycle_stage !== "trial") errors.push("STANDARD_TRIAL_ISSUED 的 lifecycle_stage 必须为 trial");
      if (p.trial_period_end && !isoDate.test(p.trial_period_end)) errors.push("trial_period_end 必须是日期");
      break;
    case "STANDARD_PUBLISHED":
      if (p.lifecycle_stage !== "published") errors.push("STANDARD_PUBLISHED 的 lifecycle_stage 必须为 published");
      if (p.effective_date && !isoDate.test(p.effective_date)) errors.push("effective_date 必须是日期");
      break;
    case "POPULATION_ASSUMPTION_SET":
      if ("universal_claim_allowed" in p && p.universal_claim_allowed !== false) {
        errors.push("任何人群假设都不得推出“适合所有人”，universal_claim_allowed 只能为 false");
      }
      break;
    case "SUBJECT_ENROLLED":
      if (!Array.isArray(p.consent_scope) || p.consent_scope.length === 0) {
        errors.push("受试者必须登记同意范围 consent_scope");
      }
      for (const key of Object.keys(p)) {
        if (forbiddenSubjectFields.includes(key)) errors.push(`受试者记录不得包含个人身份字段：${key}`);
      }
      if (p.pseudonymous_id && /身份证|护照|手机号/.test(String(p.pseudonymous_id))) {
        errors.push("pseudonymous_id 必须是研究编码，不能是真实身份信息");
      }
      break;
    case "SUBJECT_EXCLUDED":
      if ("pre_registered_rule" in p && p.pre_registered_rule !== true) {
        errors.push("样本排除只能依据试验方案中预先登记的规则");
      }
      break;
    case "SUBJECT_CONSENT_WITHDRAWN":
      if (!Array.isArray(p.withdrawn_scope) || p.withdrawn_scope.length === 0) {
        errors.push("撤回同意必须指明撤回的用途范围");
      }
      break;
    case "EVIDENCE_ACCEPTED":
      if (!Array.isArray(p.supports_claim_type) || p.supports_claim_type.length === 0) {
        errors.push("证据必须声明其可支持的主张类型");
      }
      if (p.evidence_tier === "traditional" && p.supports_claim_type?.includes("risk_reduction")) {
        errors.push("传统食养资料不得支持疾病风险降低类主张");
      }
      if (["in_vitro_lab", "animal"].includes(p.evidence_tier) &&
          p.supports_claim_type?.some((t) => ["risk_reduction", "structure_function"].includes(t))) {
        errors.push("实验室/动物证据不得直接支持人体功效主张");
      }
      break;
    case "INGREDIENT_SOURCE_CHANGED":
      if (p.equivalence_claim && !["identical_spec", "equivalent_tested", "unverified"].includes(p.equivalence_claim)) {
        errors.push("equivalence_claim 取值非法");
      }
      break;
    case "BATCH_STABILITY_RECORDED":
      if ("sample_scale" in p && !["lab_sample", "pilot", "production_scale"].includes(p.sample_scale)) {
        errors.push("sample_scale 取值非法");
      }
      break;
    case "SCALE_UP_VERIFIED":
      if (p.verified_bounds) {
        const { min_batch_size, max_batch_size } = p.verified_bounds;
        if (typeof min_batch_size !== "number" || typeof max_batch_size !== "number") {
          errors.push("verified_bounds 必须给出数值化批量上下限");
        } else if (min_batch_size > max_batch_size) {
          errors.push("verified_bounds 的下限不能大于上限");
        } else if (p.batch_size < min_batch_size || p.batch_size > max_batch_size) {
          errors.push("本次放大批量必须落在已验证边界内");
        }
      }
      break;
    case "CLAIM_REVIEWED":
      if (!["approved", "rejected", "needs_evidence"].includes(p.decision)) {
        errors.push("claim 审查决定非法");
      }
      break;
    default:
      break;
  }

  return errors;
}

/** 计算单条事件的链式哈希（用于防篡改校验）。 */
export function hashEvent(record, prevHash) {
  const body = JSON.stringify({
    event_id: record.event_id,
    event_type: record.event_type,
    aggregate_type: record.aggregate_type,
    aggregate_id: record.aggregate_id,
    occurred_at: record.occurred_at,
    version: record.version,
    summary: record.summary,
    payload: record.payload ?? null,
    causation_id: record.causation_id ?? null,
    correlation_id: record.correlation_id ?? null,
    prev: prevHash ?? "GENESIS",
  });
  return createHash("sha256").update(body).digest("hex");
}
