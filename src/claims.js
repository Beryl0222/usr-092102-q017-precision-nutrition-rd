import { analyzeClaimGap } from "./evidence.js";

/**
 * 主张评审服务：研发人员据此判断一项上市主张缺少哪一级证据。
 *
 * 评审结论三态：
 * - approved：所有必需层级均有边界内支持的证据；
 * - insufficient_evidence：缺少某些层级的有效证据（missing_levels 指明哪一级）；
 * - rejected：有证据但全部明确不支持（边界外），不得上市。
 */
export function reviewClaim(claim, evidences) {
  const gap = analyzeClaimGap(claim, evidences);
  let status;
  if (gap.satisfied) {
    status = "approved";
  } else if (gap.missing_levels.some((level) => gap.detail[level].verdicts.length === 0)) {
    // 至少一个必需层级完全没有证据
    status = "insufficient_evidence";
  } else {
    // 各层级都有证据，但均落在结论边界之外
    status = "rejected";
  }

  return {
    claim_id: claim.claim_id,
    status,
    missing_levels: gap.missing_levels,
    detail: gap.detail,
    reviewed_at: claim.reviewed_at ?? new Date().toISOString(),
  };
}

/** 生成 CLAIM_REVIEWED 事件负载（由调用方追加到事件存储）。 */
export function toClaimReviewedEvent(review, { event_id, aggregate_id, version, occurred_at }) {
  return {
    event_id,
    event_type: "CLAIM_REVIEWED",
    aggregate_type: "product_claim",
    aggregate_id,
    occurred_at,
    version,
    summary: `主张 ${review.claim_id} 评审结论：${review.status}`,
    review,
  };
}
