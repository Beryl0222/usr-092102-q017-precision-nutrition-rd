/**
 * 利益关系披露与回避。
 *
 * 规则：编制单位（委员所在单位）与审议事项存在利益关系时，
 * 必须披露并对相关条款的表决执行回避；未披露即参与表决视为违规。
 */

/**
 * 判断委员对某条款是否具备表决资格。
 * @param memberId 委员标识
 * @param clauseId 条款标识
 * @param disclosures 披露记录：{ member_id, organization, related_clause_ids }
 * @param recusals 已执行回避：{ member_id, clause_id }
 * @returns { eligible, reason, violation }
 */
export function checkVoteEligibility(memberId, clauseId, disclosures, recusals) {
  const conflict = disclosures.find((d) => d.member_id === memberId && (d.related_clause_ids ?? []).includes(clauseId));
  if (!conflict) return { eligible: true, reason: "无已披露利益关系", violation: false };

  const recused = recusals.some((r) => r.member_id === memberId && r.clause_id === clauseId);
  if (recused) return { eligible: false, reason: "已披露利益关系并执行回避", violation: false };
  return { eligible: false, reason: "已披露利益关系但未执行回避，不得表决", violation: true };
}

/**
 * 校验一次表决记录：votes = [{ member_id, clause_id }]。
 * 返回 { valid, violations }，violations 列出每一张违规票及原因。
 */
export function validateVotes(votes, disclosures, recusals) {
  const violations = [];
  for (const v of votes) {
    const check = checkVoteEligibility(v.member_id, v.clause_id, disclosures, recusals);
    if (check.violation) violations.push({ ...v, reason: check.reason });
  }
  return { valid: violations.length === 0, violations };
}

/** 某条款应当回避的委员清单（供会议组织方提前通知）。 */
export function requiredRecusals(clauseId, disclosures) {
  return disclosures.filter((d) => (d.related_clause_ids ?? []).includes(clauseId)).map((d) => d.member_id);
}
