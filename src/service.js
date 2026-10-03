import { buildProjector } from "./projections.js";
import { EventStore, EventValidationError } from "./store.js";
import {
  assessImpact,
  assessMigration,
  clauseRationale,
  consentCoverage,
  decide,
  evaluateClaim,
  formulaCompliance,
  regulatorView,
  scaleUpStatus,
  standardTimeline,
} from "./policies.js";

const project = buildProjector();

/**
 * 研发证据链应用服务：在只追加存储之上提供业务用例。
 * 所有判定（主张审查、影响分析、迁移评估）落成事件，保证可审计、可复现。
 */
export class EvidenceChainService {
  constructor() {
    this.store = new EventStore();
  }

  get state() {
    return project(this.store.events());
  }

  /** 通用追加：自动按聚合顺序分配 version。 */
  record(record, { causationId = null, correlationId = null } = {}) {
    const version = this.store.currentVersion(record.aggregate_id) + 1;
    const full = { ...record, version };
    return this.store.append(full, { causationId, correlationId });
  }

  /** 原料来源变更：落变更事件并立即生成影响评估。 */
  changeIngredientSource(changeEvent, { correlationId = null } = {}) {
    // 先基于变更前状态计算影响（投影包含刚追加的变更事件亦可，影响只引用证据 id）
    const appended = this.record(changeEvent, { correlationId });
    const impact = assessImpact(this.state, appended.event);
    let impactId = null;
    if (impact) {
      const saved = this.record(
        {
          event_id: `${changeEvent.event_id}-impact`,
          event_type: "IMPACT_ASSESSED",
          aggregate_type: "impact_assessment",
          aggregate_id: `impact-${changeEvent.event_id}`,
          occurred_at: changeEvent.occurred_at,
          summary: `原料/配方变更影响评估：${impact.revalidation_required ? "需要再验证" : "保持监测"}`,
          payload: impact,
        },
        { causationId: changeEvent.event_id, correlationId },
      );
      impactId = saved.event.aggregate_id;
    }
    // 已批准但受影响的主张自动暂停
    for (const c of impact?.affected_claims ?? []) {
      if (c.impact === "requires_revalidation") {
        const claim = this.state.claims.get(c.id);
        if (claim?.reviews.at(-1)?.decision === "approved" && !claim.suspended) {
          this.record(
            {
              event_id: `${changeEvent.event_id}-suspend-${c.id}`,
              event_type: "CLAIM_SUSPENDED",
              aggregate_type: "product_claim",
              aggregate_id: c.id,
              occurred_at: changeEvent.occurred_at,
              summary: "原料来源变更导致已批准主张暂停，待再验证",
              payload: { reason: c.reason, trigger_event_id: changeEvent.event_id },
            },
            { causationId: changeEvent.event_id, correlationId },
          );
        }
      }
    }
    return { change: appended.event, impactId, impact };
  }

  /** 配方新版本：生成桥接影响评估。 */
  designFormula(formulaEvent, { correlationId = null } = {}) {
    const appended = this.record(formulaEvent, { correlationId });
    const impact = assessImpact(this.state, appended.event);
    if (impact) {
      this.record(
        {
          event_id: `${formulaEvent.event_id}-impact`,
          event_type: "IMPACT_ASSESSED",
          aggregate_type: "impact_assessment",
          aggregate_id: `impact-${formulaEvent.event_id}`,
          occurred_at: formulaEvent.occurred_at,
          summary: "配方新版本影响评估：旧证据需剂量/人群桥接核查",
          payload: impact,
        },
        { causationId: formulaEvent.event_id, correlationId },
      );
    }
    return appended.event;
  }

  /** 主张审查：计算 findings，落 CLAIM_REVIEWED 事件。 */
  reviewClaim(claimId, { reviewerOrg = null, standardRevisionId = null, reviewedAt = null } = {}) {
    const state = this.state;
    const claim = state.claims.get(claimId);
    if (!claim) throw new Error(`主张不存在：${claimId}`);
    const findings = evaluateClaim(state, claimId, { reviewerOrg, standardRevisionId });
    const decision = decide(findings);
    const list = findings.length > 0 ? findings : [{ code: "OK", message: "证据等级、人群、剂量、观察期与放大边界均满足" }];
    this.record({
      event_id: `review-${claimId}-${claim.reviews.length + 1}`,
      event_type: "CLAIM_REVIEWED",
      aggregate_type: "product_claim",
      aggregate_id: claimId,
      occurred_at: reviewedAt ?? new Date().toISOString(),
      summary: `主张审查：${decision}`,
      payload: {
        decision,
        findings: list,
        ...(reviewerOrg ? { reviewer_org: reviewerOrg } : {}),
        ...(standardRevisionId ? { reviewed_against_standard_revision_id: standardRevisionId } : {}),
      },
    });
    return { decision, findings };
  }

  /** 标准发布：生成迁移评估（不追溯改写当时合法版本）。 */
  publishStandard(publishEvent, { oldRevisionId, transitionDays = 365, correlationId = null } = {}) {
    const published = this.record(publishEvent, { correlationId });
    const migration = assessMigration(this.state, {
      oldRevisionId,
      newRevisionId: publishEvent.aggregate_id,
      transitionDays,
    });
    this.record(
      {
        event_id: `${publishEvent.event_id}-migration`,
        event_type: "MIGRATION_ASSESSED",
        aggregate_type: "migration_assessment",
        aggregate_id: `migration-${oldRevisionId}-to-${publishEvent.aggregate_id}`,
        occurred_at: publishEvent.occurred_at,
        summary: "标准版本更新迁移评估",
        payload: migration,
      },
      { causationId: publishEvent.event_id, correlationId },
    );
    return { published: published.event, migration };
  }

  complianceOf(formulaId) {
    return formulaCompliance(this.state, formulaId);
  }

  scaleUpBoundary(formulaId, batchSize, unit) {
    return scaleUpStatus(this.state, formulaId, batchSize, unit);
  }

  rationaleOf(clauseId) {
    return clauseRationale(this.state, clauseId);
  }

  timelineOf(revisionId) {
    return standardTimeline(this.state, revisionId);
  }

  consentOf(protocolId) {
    return consentCoverage(this.state, protocolId);
  }

  /** 监管查看：返回去标识化视图并落审计事件。 */
  regulatorInspection({ viewerOrg, viewedAt, standardRevisionId = null, evidenceIds = [] } = {}) {
    const view = regulatorView(this.state, { standardRevisionId });
    this.record({
      event_id: `view-${viewerOrg}-${Date.parse(viewedAt) / 1000}`,
      event_type: "EVIDENCE_VIEWED",
      aggregate_type: "audit_log",
      aggregate_id: `audit-${Date.parse(viewedAt)}`,
      occurred_at: viewedAt,
      summary: `监管查看（去标识化）：${viewerOrg}`,
      payload: {
        viewer_org: viewerOrg,
        purpose: "regulatory_inspection",
        viewed_at: viewedAt,
        de_identified: true,
        evidence_ids: evidenceIds,
        subject_count_released: 0,
      },
    });
    return view;
  }

  verify() {
    return this.store.verifyIntegrity();
  }
}

export { EventValidationError };
