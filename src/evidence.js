/**
 * 证据层级与主张支持判定。
 *
 * 领域规则：
 * 1. 证据分三级：traditional（传统食养资料）、lab（实验室结果）、human（人体证据）。
 *    三级之间不得互相替代——人体宣称只能由人体证据支持，依此类推。
 * 2. 研究结论只能支持其人群、剂量和观察期之内的主张：
 *    主张的目标人群须被证据人群覆盖，主张剂量须落在证据剂量区间内，
 *    主张的见效周期须落在证据观察期内。
 */

export const EVIDENCE_LEVELS = ["traditional", "lab", "human"];

/** 各主张类型所需的证据层级。层级不可互相替代，缺一级就是缺一级。 */
export const REQUIRED_LEVELS = {
  traditional_use_claim: ["traditional"],
  composition_claim: ["lab"],
  health_claim: ["human"],
};

/** 人群包含判定：inner（主张人群）是否被 outer（证据人群）覆盖。 */
export function populationContains(outer, inner) {
  if (inner.age_min < outer.age_min || inner.age_max > outer.age_max) return false;
  const outerTags = new Set(outer.tags ?? []);
  return (inner.tags ?? []).every((tag) => outerTags.has(tag));
}

/** 数值区间包含判定。 */
export function rangeContains(outer, inner) {
  return inner.min >= outer.min && inner.max <= outer.max;
}

/**
 * 判断一条证据是否支持某项主张（不考虑层级要求，只看结论边界）。
 * 返回 { supported, reasons }，reasons 列出每一项不满足的边界。
 */
export function evidenceSupportsClaim(evidence, claim) {
  const reasons = [];
  if (!populationContains(evidence.population, claim.population)) {
    reasons.push("主张人群超出证据人群范围");
  }
  const claimDose = { min: claim.dose.amount, max: claim.dose.amount };
  if (claim.dose.unit !== evidence.dose.unit || !rangeContains(evidence.dose, claimDose)) {
    reasons.push("主张剂量超出证据剂量区间");
  }
  const claimDuration = { min: claim.duration_days, max: claim.duration_days };
  const observation = { min: evidence.observation.min_days, max: evidence.observation.max_days };
  if (!rangeContains(observation, claimDuration)) {
    reasons.push("主张见效周期超出证据观察期");
  }
  return { supported: reasons.length === 0, reasons };
}

/**
 * 主张证据缺口分析：对每一必需层级，找出是否存在“层级匹配且边界支持”的证据。
 * 返回 { satisfied, missing_levels, detail }，detail 按层级说明支持或拒绝的理由。
 */
export function analyzeClaimGap(claim, evidences) {
  const required = REQUIRED_LEVELS[claim.claim_type];
  if (!required) throw new Error(`未知主张类型：${claim.claim_type}`);

  const detail = {};
  const missing = [];
  for (const level of required) {
    const candidates = evidences.filter((e) => e.level === level);
    const verdicts = candidates.map((e) => ({ evidence_id: e.evidence_id, ...evidenceSupportsClaim(e, claim) }));
    const ok = verdicts.some((v) => v.supported);
    if (!ok) missing.push(level);
    detail[level] = {
      satisfied: ok,
      verdicts,
      note: candidates.length === 0 ? "该层级无任何证据" : undefined,
    };
  }
  return { satisfied: missing.length === 0, missing_levels: missing, detail };
}
