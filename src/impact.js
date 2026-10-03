/**
 * 变更影响分析：配方或原料供应商变化时，计算受影响的安全与功效证据。
 *
 * 证据通过 formula_version_id 与 ingredient_batches 关联到配方和原料批次。
 * 任一变更命中证据的关联链，该证据即标记为“需再验证”，
 * 其支撑的主张也随之进入待复核清单。
 */

/**
 * @param change 变更描述：{ formula_id, from_version_id, to_version_id,
 *   changed_ingredients: [{ ingredient_id, from_supplier, to_supplier, from_batch, to_batch }] }
 * @param evidences 全部证据记录
 * @param claims 全部主张记录（用于联动出待复核主张）
 */
export function computeImpact(change, evidences, claims = []) {
  const changedKeys = new Set();
  for (const c of change.changed_ingredients ?? []) {
    changedKeys.add(`${c.ingredient_id}@${c.from_supplier}`);
    changedKeys.add(`${c.ingredient_id}@${c.from_batch}`);
  }

  const affected = evidences.filter((e) => {
    if (e.formula_version_id === change.from_version_id) return true;
    return (e.ingredient_batches ?? []).some((b) => changedKeys.has(`${b.ingredient_id}@${b.supplier}`) || changedKeys.has(`${b.ingredient_id}@${b.batch_id}`));
  });

  const affectedIds = new Set(affected.map((e) => e.evidence_id));
  const affectedClaims = claims.filter((c) => (c.supported_by ?? []).some((id) => affectedIds.has(id)));

  return {
    formula_id: change.formula_id,
    from_version_id: change.from_version_id,
    to_version_id: change.to_version_id,
    affected_evidence: affected.map((e) => ({
      evidence_id: e.evidence_id,
      level: e.level,
      kind: (e.safety_events ?? []).length > 0 ? "safety+efficacy" : "efficacy",
      status: "needs_revalidation",
    })),
    affected_claims: affectedClaims.map((c) => c.claim_id),
    requires_revalidation: affected.length > 0,
  };
}

/** 生成 IMPACT_ASSESSED 事件负载。 */
export function toImpactAssessedEvent(impact, { event_id, aggregate_id, version, occurred_at }) {
  return {
    event_id,
    event_type: "IMPACT_ASSESSED",
    aggregate_type: "formula_version",
    aggregate_id,
    occurred_at,
    version,
    summary: `配方 ${impact.formula_id} 变更影响 ${impact.affected_evidence.length} 条证据、${impact.affected_claims.length} 项主张`,
    impact,
  };
}
