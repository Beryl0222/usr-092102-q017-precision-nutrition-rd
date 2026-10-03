/**
 * 受试者知情同意与撤回。
 *
 * 规则：撤回按同意范围生效——自撤回生效时刻起，被撤回用途的新使用一律停止；
 * 撤回前已完成的合法使用不追溯否定。
 */

/**
 * 判断某时刻对某受试者数据的某项用途是否被允许。
 *
 * @param consent 同意记录：{ subject_id, allowed_uses: [...] }
 * @param withdrawals 撤回记录列表：{ subject_id, scope: "all" | [...], effective_at }
 * @param use 用途标识（如 "efficacy_analysis"）
 * @param at 拟使用时刻（ISO 时间）
 */
export function isUseAllowed(consent, withdrawals, use, at) {
  if (!consent.allowed_uses.includes(use)) return false;
  const t = Date.parse(at);
  return !withdrawals.some((w) => {
    if (w.subject_id !== consent.subject_id) return false;
    if (Date.parse(w.effective_at) > t) return false;
    return w.scope === "all" || w.scope.includes(use);
  });
}

/**
 * 过滤一份分析计划中的受试者清单，返回 { allowed, blocked }。
 * plan = { use, at, subject_ids }；consents/withdrawals 为全量记录。
 */
export function filterPlanSubjects(plan, consents, withdrawals) {
  const bySubject = new Map(consents.map((c) => [c.subject_id, c]));
  const allowed = [];
  const blocked = [];
  for (const id of plan.subject_ids) {
    const consent = bySubject.get(id);
    const ok = consent && isUseAllowed(consent, withdrawals, plan.use, plan.at);
    (ok ? allowed : blocked).push(id);
  }
  return { allowed, blocked };
}
