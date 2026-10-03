const required = ["event_id", "event_type", "aggregate_type", "aggregate_id", "occurred_at", "version", "summary"];

export const EVENT_TYPES = [
  "STANDARD_PROPOSED",
  "OBJECTION_RAISED",
  "OBJECTION_RESOLVED",
  "TRIAL_STARTED",
  "STANDARD_PUBLISHED",
  "MIGRATION_ASSESSED",
  "INGREDIENT_BATCH_REGISTERED",
  "FORMULA_FROZEN",
  "SUPPLIER_CHANGED",
  "IMPACT_ASSESSED",
  "PROTOCOL_REGISTERED",
  "SAMPLE_EXCLUDED",
  "EVIDENCE_ACCEPTED",
  "SAFETY_EVENT_RECORDED",
  "SCALE_UP_EVALUATED",
  "CLAIM_REVIEWED",
  "CONSENT_RECORDED",
  "SUBJECT_WITHDRAWN",
  "COI_DISCLOSED",
  "RECUSAL_EXECUTED",
];

export const AGGREGATE_TYPES = [
  "standard_revision",
  "formula_version",
  "ingredient_batch",
  "study_protocol",
  "study_evidence",
  "scale_up",
  "product_claim",
  "consent",
  "coi_disclosure",
];

export function validateEvent(record) {
  const errors = required.filter((name) => !(name in record)).map((name) => `缺少字段：${name}`);
  if ("version" in record && (!Number.isInteger(record.version) || record.version < 1)) errors.push("version 必须是正整数");
  if ("event_type" in record && !EVENT_TYPES.includes(record.event_type)) errors.push(`未知事件类型：${record.event_type}`);
  if ("aggregate_type" in record && !AGGREGATE_TYPES.includes(record.aggregate_type)) errors.push(`未知聚合类型：${record.aggregate_type}`);
  if ("occurred_at" in record && Number.isNaN(Date.parse(record.occurred_at))) errors.push("occurred_at 必须是可解析的时间");
  return errors;
}
