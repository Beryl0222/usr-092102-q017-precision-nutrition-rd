/**
 * 标准迁移评估：标准从旧版本更新到新版本时，逐项评估既有配方/产品的合规变化。
 *
 * 原则：只生成新的评估记录，绝不改写旧版本下的合规结论——
 * 当时合法的版本保持合法，历史记录不追溯篡改。
 */

/** 单条款判定：clause = { clause_id, parameter, comparator, limit } */
export function evaluateClause(clause, params) {
  const value = params[clause.parameter];
  if (value === undefined) return { clause_id: clause.clause_id, result: "unknown" };
  const ok =
    (clause.comparator === "<=" && value <= clause.limit) ||
    (clause.comparator === ">=" && value >= clause.limit) ||
    (clause.comparator === "==" && value === clause.limit);
  return { clause_id: clause.clause_id, result: ok ? "compliant" : "non_compliant", value };
}

/** 评估单个对象在一版标准下的整体合规性。 */
export function evaluateAgainst(standard, params) {
  const clauses = standard.clauses.map((c) => evaluateClause(c, params));
  return {
    standard_id: standard.standard_id,
    compliant: clauses.every((c) => c.result === "compliant"),
    clauses,
  };
}

/**
 * 迁移评估：对每个评估对象分别按旧版与新版标准判定，输出四态：
 * compliant_both / newly_non_compliant / newly_compliant / non_compliant_both。
 */
export function assessMigration(fromStandard, toStandard, subjects) {
  const items = subjects.map((s) => {
    const before = evaluateAgainst(fromStandard, s.params);
    const after = evaluateAgainst(toStandard, s.params);
    let transition;
    if (before.compliant && after.compliant) transition = "compliant_both";
    else if (before.compliant && !after.compliant) transition = "newly_non_compliant";
    else if (!before.compliant && after.compliant) transition = "newly_compliant";
    else transition = "non_compliant_both";
    return { subject_id: s.subject_id, transition, before, after };
  });
  return {
    from_standard_id: fromStandard.standard_id,
    to_standard_id: toStandard.standard_id,
    items,
    newly_non_compliant: items.filter((i) => i.transition === "newly_non_compliant").map((i) => i.subject_id),
  };
}

/** 生成 MIGRATION_ASSESSED 事件负载。 */
export function toMigrationAssessedEvent(assessment, { event_id, aggregate_id, version, occurred_at }) {
  return {
    event_id,
    event_type: "MIGRATION_ASSESSED",
    aggregate_type: "standard_revision",
    aggregate_id,
    occurred_at,
    version,
    summary: `标准 ${assessment.from_standard_id} → ${assessment.to_standard_id} 迁移评估：新增不合规 ${assessment.newly_non_compliant.length} 项`,
    assessment,
  };
}
