/**
 * 证据链业务策略（纯函数，输入投影状态，输出判定结果，不产生副作用）。
 *
 * 核心原则：
 * 1. 研究结论只能支持其证据等级、人群、剂量、观察期范围内的主张；
 * 2. 传统食养资料 / 实验室（含动物）/ 人体证据三级不得互相替代；
 * 3. “适合所有人”在任何证据组合下都不成立；
 * 4. 历史判定只反映当时有效的版本；标准更新产生迁移评估，不追溯改写。
 */

export const TIER_RANK = {
  traditional: 0,
  in_vitro_lab: 1,
  animal: 2,
  post_market_surveillance: 3,
  human_exploratory: 4,
  human_pivotal: 5,
  systematic_review: 6,
};

export const TIER_LABEL = {
  traditional: "传统食养资料",
  in_vitro_lab: "实验室（体外）",
  animal: "动物实验",
  post_market_surveillance: "上市后监测",
  human_exploratory: "探索性人体试验",
  human_pivotal: "关键性人体试验",
  systematic_review: "系统综述",
};

// 每类主张所需的最低证据等级；null 表示永远禁止
export const MIN_TIER_FOR_CLAIM = {
  universal_health: null,
  risk_reduction: TIER_RANK.human_pivotal,
  structure_function: TIER_RANK.human_exploratory,
  nutrient_content: TIER_RANK.in_vitro_lab,
  traditional_nourishment: TIER_RANK.traditional,
  mechanistic_support: TIER_RANK.in_vitro_lab,
};

const HUMAN_TIERS = new Set(["human_exploratory", "human_pivotal", "systematic_review"]);
const SERIOUS_SEVERITY = new Set(["serious", "severe"]);

const f = (code, message, evidence_id) => ({ code, message, ...(evidence_id ? { evidence_id } : {}) });

/** 找出与某原料供应商相关的全部配方版本。 */
export function formulasUsingSupplier(state, supplierId) {
  return [...state.formulas.values()].filter((formula) =>
    formula.components.some((c) => c.ingredient_supplier_id === supplierId),
  );
}

/** 审查一条上市主张，返回 findings（空数组表示可批准）。 */
export function evaluateClaim(state, claimId, { reviewerOrg = null, standardRevisionId = null } = {}) {
  const claim = state.claims.get(claimId);
  if (!claim) throw new Error(`主张不存在：${claimId}`);
  const findings = [];

  // 0) 已被暂停的主张不能再审
  if (claim.suspended) {
    findings.push(f("UNRESOLVED_SAFETY", `主张已被暂停（原因：${claim.suspended.reason}），须先处置后重审`));
  }

  // 1) 普适宣称直接禁止
  if (claim.type === "universal_health" || /^(all|所有人|所有人群|全民)$/.test(String(claim.target_population).trim())) {
    findings.push(f("UNIVERSAL_CLAIM_FORBIDDEN", "任何研究结论都只能支持其受试人群，不得宣称适合所有人"));
  }

  // 2) 审查方利益冲突且未回避
  if (reviewerOrg && hasUnrecusedConflict(state, reviewerOrg, claimId)) {
    findings.push(f("REVIEWER_CONFLICT_NOT_RECUSAL", `审查单位 ${reviewerOrg} 存在已披露利益关系且未执行回避`));
  }

  const formula = claim.formula_version_id ? state.formulas.get(claim.formula_version_id) : null;
  if (claim.formula_version_id && !formula) {
    findings.push(f("EVIDENCE_TIER_INSUFFICIENT", `主张引用的配方版本不存在：${claim.formula_version_id}`));
  }

  // 3) 逐条核查被引用的证据
  const usableEvidence = [];
  for (const evid of claim.evidence_ids) {
    const e = state.evidence.get(evid);
    if (!e) {
      findings.push(f("EVIDENCE_TIER_INSUFFICIENT", `引用的证据不存在：${evid}`, evid));
      continue;
    }
    if (e.status === "invalidated") {
      findings.push(f("STALE_EVIDENCE_AFTER_CHANGE", `证据 ${e.title} 已因 ${e.invalidated_by} 的原料/配方变更失效，不能再支持主张`, e.id));
      continue;
    }
    if (e.status === "requires_revalidation") {
      findings.push(f("STALE_EVIDENCE_AFTER_CHANGE", `证据 ${e.title} 处于待再验证状态（触发：${e.revalidation_triggered_by}）`, e.id));
      continue;
    }
    if (!e.supports_claim_type.includes(claim.type)) {
      findings.push(f("EVIDENCE_TIER_INSUFFICIENT", `证据 ${e.title}（${TIER_LABEL[e.evidence_tier]}）不支持 ${claim.type} 类主张——证据等级之间不得互相替代`, e.id));
      continue;
    }
    if (TIER_RANK[e.evidence_tier] < MIN_TIER_FOR_CLAIM[claim.type]) {
      findings.push(
        f(
          "EVIDENCE_TIER_INSUFFICIENT",
          `${claim.type} 主张至少需要 ${labelForRank(MIN_TIER_FOR_CLAIM[claim.type])}，现有为 ${TIER_LABEL[e.evidence_tier]}`,
          e.id,
        ),
      );
      continue;
    }
    usableEvidence.push(e);
  }
  if (claim.evidence_ids.length === 0) {
    findings.push(f("EVIDENCE_TIER_INSUFFICIENT", "主张未引用任何证据"));
  }

  // 4) 人群边界：人体证据必须绑定同一人群假设
  const needsHuman = MIN_TIER_FOR_CLAIM[claim.type] >= TIER_RANK.human_exploratory;
  const humanEvidence = usableEvidence.filter((e) => HUMAN_TIERS.has(e.evidence_tier));
  if (needsHuman) {
    if (humanEvidence.length === 0) {
      findings.push(f("EVIDENCE_TIER_INSUFFICIENT", "人体功效主张缺少人体试验证据，实验室与动物结果不能替代"));
    } else {
      for (const e of humanEvidence) {
        if (!e.population_assumption_id) {
          findings.push(f("POPULATION_MISMATCH", `人体证据 ${e.title} 未限定受试人群，不能外推`, e.id));
        } else if (claim.population_assumption_id && e.population_assumption_id !== claim.population_assumption_id) {
          const pop = state.populations.get(e.population_assumption_id);
          findings.push(f("POPULATION_MISMATCH", `证据人群为「${pop?.population_label ?? e.population_assumption_id}」，与主张目标人群不一致`, e.id));
        }
        if (!e.formula_version_id || (formula && e.formula_version_id !== formula.id)) {
          findings.push(f("POPULATION_MISMATCH", `证据 ${e.title} 不是用该配方版本产生，不能桥接到本配方`, e.id));
        }
        if (formula && (!Array.isArray(e.ingredient_supplier_ids) || e.ingredient_supplier_ids.length === 0)) {
          findings.push(f("EVIDENCE_TIER_INSUFFICIENT", `人体证据 ${e.title} 未绑定原料来源批次，证据链不可追溯`, e.id));
        } else if (formula) {
          for (const comp of formula.components) {
            if (!e.ingredient_supplier_ids.includes(comp.ingredient_supplier_id)) {
              findings.push(f("STALE_EVIDENCE_AFTER_CHANGE", `证据 ${e.title} 未覆盖配方原料来源 ${comp.ingredient_supplier_id}`, e.id));
            }
          }
        }
        const positive = (e.endpoint_results ?? []).filter((r) => r.statistically_significant && r.clinically_meaningful);
        if (positive.length === 0) {
          findings.push(f("EVIDENCE_TIER_INSUFFICIENT", `证据 ${e.title} 没有同时达到统计学显著且临床有意义的功效终点`, e.id));
        }
      }

      // 5) 剂量边界：主张剂量必须落在研究剂量范围内
      const units = new Set(humanEvidence.map((e) => `${e.dose_per_serving ?? ""}${e.dose_unit ?? ""}`));
      const sameUnit = humanEvidence.filter((e) => e.dose_unit === claim.dose_unit);
      if (sameUnit.length === 0) {
        findings.push(f("DOSE_MISMATCH", `研究剂量单位与主张不一致（研究：${[...units].join("、")}；主张：${claim.dose_unit}）`));
      } else {
        const minDose = Math.min(...sameUnit.map((e) => e.dose_per_serving));
        const maxDose = Math.max(...sameUnit.map((e) => e.dose_per_serving));
        if (claim.dose < minDose - 1e-9 || claim.dose > maxDose + 1e-9) {
          findings.push(f("DOSE_MISMATCH", `主张剂量 ${claim.dose}${claim.dose_unit} 超出研究剂量范围 ${minDose}~${maxDose}${claim.dose_unit}`));
        }
      }

      // 6) 观察期边界：主张周期不得超过研究观察期
      const maxPeriod = Math.max(...humanEvidence.map((e) => e.observation_period_days ?? 0));
      if (claim.period_days > maxPeriod) {
        findings.push(f("PERIOD_EXCEEDS_EVIDENCE", `主张观察期 ${claim.period_days} 天超出研究最长观察期 ${maxPeriod} 天`));
      }
    }
  }

  // 7) 未决严重安全事件
  if (formula) {
    const openSerious = [...state.safetyEvents.values()].filter(
      (s) =>
        s.related_formula_version_id === formula.id &&
        SERIOUS_SEVERITY.has(s.severity) &&
        (!s.adjudication || s.adjudication.adjudication === "formula_suspend"),
    );
    for (const s of openSerious) {
      findings.push(f("UNRESOLVED_SAFETY", `存在未结案的严重安全事件 ${s.id}（${s.severity}），不得放行功效主张`));
    }
  }

  // 8) 放大验证边界：商业批量必须落在已验证边界内
  if (formula && typeof claim.commercial_batch_size === "number") {
    const bounds = scaleUpStatus(state, formula.id, claim.commercial_batch_size, claim.commercial_batch_size_unit);
    if (!bounds.verifiable) {
      findings.push(f("SCALE_UP_OUT_OF_BOUNDS", bounds.reason));
    } else if (!bounds.within) {
      findings.push(
        f(
          "SCALE_UP_OUT_OF_BOUNDS",
          `拟上市批量 ${claim.commercial_batch_size}${claim.commercial_batch_size_unit} 超出已验证边界 ${bounds.min}~${bounds.max}${bounds.unit}；小样稳定性与原料检测不能证明可生产`,
        ),
      );
    }
  }

  return findings;
}

/** 由 findings 给出综合决定。 */
export function decide(findings) {
  if (findings.length === 0) return "approved";
  const hardReject = new Set([
    "UNIVERSAL_CLAIM_FORBIDDEN",
    "REVIEWER_CONFLICT_NOT_RECUSAL",
    "UNRESOLVED_SAFETY",
    "SCALE_UP_OUT_OF_BOUNDS",
  ]);
  return findings.some((x) => hardReject.has(x.code)) ? "rejected" : "needs_evidence";
}

/** 查询某配方在某批量下是否仍处于放大验证边界内。 */
export function scaleUpStatus(state, formulaId, batchSize, unit) {
  const verifications = [...state.scaleUps.values()].filter((v) => v.formula_version_id === formulaId);
  if (verifications.length === 0) {
    return { verifiable: false, within: false, reason: `配方 ${formulaId} 没有任何放大验证记录` };
  }
  const matching = verifications.filter((v) => v.batch_size_unit === unit && v.quality_results_conform === true);
  if (matching.length === 0) {
    return { verifiable: false, within: false, reason: `没有单位为 ${unit ?? "未注明"} 且质量结果合格的放大验证记录` };
  }
  const min = Math.min(...matching.map((v) => v.verified_bounds.min_batch_size));
  const max = Math.max(...matching.map((v) => v.verified_bounds.max_batch_size));
  return {
    verifiable: true,
    within: batchSize >= min - 1e-9 && batchSize <= max + 1e-9,
    min,
    max,
    unit,
    verifications: matching.map((v) => v.id),
  };
}

/**
 * 原料来源 / 配方版本变更的影响计算。
 * 历史证据不删除：被判定 invalidated / requires_revalidation 的证据在投影中带状态，
 * 当初基于它作出的决定仍保留在事件流里（不追溯篡改）。
 */
export function assessImpact(state, changeEvent) {
  const p = changeEvent.payload;
  if (changeEvent.event_type === "INGREDIENT_SOURCE_CHANGED") {
    const supplierId = changeEvent.aggregate_id;
    const impactForEvidence =
      p.equivalence_claim === "identical_spec"
        ? "monitor"
        : p.equivalence_claim === "equivalent_tested"
          ? "requires_revalidation"
          : "invalidated";
    const reason =
      impactForEvidence === "invalidated"
        ? "新原料来源等效性未验证，基于旧来源的人体证据不得继续支持功效与安全主张"
        : impactForEvidence === "requires_revalidation"
          ? "新来源仅有规格等效检测，需补充桥接/再验证证据"
          : "来源规格一致，保持监测";

    const affectedEvidence = [...state.evidence.values()]
      .filter((e) => (e.ingredient_supplier_ids ?? []).includes(supplierId))
      .map((e) => ({ id: e.id, impact: impactForEvidence, reason }));

    const affectedFormulas = formulasUsingSupplier(state, supplierId);
    const affectedClaims = [];
    const affectedSafety = [];
    for (const formula of affectedFormulas) {
      for (const c of state.claims.values()) {
        if (c.formula_version_id !== formula.id) continue;
        const approved = c.reviews.at(-1)?.decision === "approved" && !c.suspended;
        affectedClaims.push({
          id: c.id,
          impact: approved && impactForEvidence !== "monitor" ? "requires_revalidation" : "monitor",
          reason: `配方 ${formula.id} 使用了变更来源的原料，已批准主张须按新证据重审，草稿须重新核查`,
        });
      }
      for (const s of state.safetyEvents.values()) {
        if (s.related_formula_version_id === formula.id) {
          affectedSafety.push({ id: s.id, impact: "monitor", reason: "历史安全事件保持有效，新来源生产期间加强同类事件监测" });
        }
      }
    }

    return {
      change_event_id: changeEvent.event_id,
      change_kind: "ingredient_source",
      affected_evidence: affectedEvidence,
      affected_claims: affectedClaims,
      affected_safety: affectedSafety,
      revalidation_required: impactForEvidence !== "monitor",
    };
  }

  if (changeEvent.event_type === "FORMULA_DESIGNED" && p.based_on_formula_version) {
    const baseId = p.based_on_formula_version;
    const affectedEvidence = [...state.evidence.values()]
      .filter((e) => e.formula_version_id === baseId)
      .map((e) => ({
        id: e.id,
        impact: "dose_population_recheck",
        reason: `证据产生于旧配方 ${baseId}，新版本 ${changeEvent.aggregate_id} 需做剂量与人群桥接核查，不得自动继承`,
      }));
    const affectedClaims = [...state.claims.values()]
      .filter((c) => c.formula_version_id === baseId)
      .map((c) => ({
        id: c.id,
        impact: "monitor",
        reason: "旧版本主张仍只属于旧版本；新版本主张须独立提交审查",
      }));
    const affectedSafety = [...state.safetyEvents.values()]
      .filter((s) => s.related_formula_version_id === baseId)
      .map((s) => ({ id: s.id, impact: "monitor", reason: "旧版本安全结论作为新版本风险参考，不免除新版本监测" }));
    return {
      change_event_id: changeEvent.event_id,
      change_kind: "formula_version",
      affected_evidence: affectedEvidence,
      affected_claims: affectedClaims,
      affected_safety: affectedSafety,
      revalidation_required: affectedEvidence.length > 0,
    };
  }

  return null;
}

/**
 * 标准发布时的迁移评估。
 * compliant_at_time 只按配方冻结当时有效版本判定——即使现在不合规，当时合法就是合法。
 */
export function assessMigration(state, { oldRevisionId, newRevisionId, transitionDays = 365 }) {
  const newRev = state.standardRevisions.get(newRevisionId);
  const effectiveDate = newRev?.effective_date ?? null;
  const deadline = effectiveDate ? addDays(effectiveDate, transitionDays) : null;

  const items = [];
  for (const formula of state.formulas.values()) {
    if (!formula.frozen) continue;
    if (formula.frozen.standard_revision_id === newRevisionId) {
      // 依据新版本冻结的，还要看冻结时新版本处于什么阶段：草案期冻结不构成量产合规
      const stageAtFreeze = stageAt(state, newRevisionId, formula.frozen.at);
      if (stageAtFreeze === "published") {
        items.push({
          formula_version_id: formula.id,
          compliant_at_time: true,
          status: "still_compliant",
          deadline: null,
          action: "新版本发布后按其冻结，继续有效",
        });
      } else {
        items.push({
          formula_version_id: formula.id,
          compliant_at_time: false,
          status: "non_compliant_new_production",
          deadline: null,
          action:
            stageAtFreeze === "trial"
              ? "冻结时新版本尚在试行期：仅限试验/试生产用途，正式发布后须重新冻结方可量产"
              : "冻结时新版本仍是草案：量产准备冻结不构成合规依据，发布后须重新冻结",
        });
      }
      continue;
    }
    if (formula.frozen.standard_revision_id !== oldRevisionId) continue;

    const stageAtFreeze = stageAt(state, oldRevisionId, formula.frozen.at);
    const lawfulBasis =
      stageAtFreeze === "published"
        ? "按已发布旧版生产，当时合法"
        : stageAtFreeze === "trial"
          ? "试行期内按试行版冻结"
          : "仅依据草案冻结，未取得正式版本合规地位";
    const compliantThen = stageAtFreeze === "published" || (stageAtFreeze === "trial" && formula.frozen.frozen_for_purpose !== "market_supply");
    const hasInvalidatedEvidence = [...state.evidence.values()].some(
      (e) => e.formula_version_id === formula.id && e.status === "invalidated",
    );

    if (compliantThen && !hasInvalidatedEvidence && formula.frozen.frozen_for_purpose === "market_supply") {
      items.push({
        formula_version_id: formula.id,
        compliant_at_time: true,
        status: "grandfathered_with_deadline",
        deadline,
        action: `${lawfulBasis}；允许消化旧规格库存，须在 ${deadline} 前完成转版或再验证，逾期停止新生产`,
      });
    } else if (compliantThen && !hasInvalidatedEvidence) {
      items.push({
        formula_version_id: formula.id,
        compliant_at_time: true,
        status: "still_compliant",
        deadline: null,
        action: `${lawfulBasis}；研发/试行用途继续有效，转量产前按新版本复核`,
      });
    } else {
      items.push({
        formula_version_id: formula.id,
        compliant_at_time: compliantThen,
        status: "non_compliant_new_production",
        deadline: null,
        action: hasInvalidatedEvidence
          ? `${lawfulBasis}；但支撑证据已失效，禁止以新版本名义新生产，历史生产记录不予改写`
          : `${lawfulBasis}；不得作为新生产合规依据`,
      });
    }
  }
  return { old_standard_revision_id: oldRevisionId, new_standard_revision_id: newRevisionId, items };
}

/** 快速回答“这个配方现在/在某版本下是否合规”。 */
export function formulaCompliance(state, formulaId, { atRevisionId = null } = {}) {
  const formula = state.formulas.get(formulaId);
  if (!formula) throw new Error(`配方不存在：${formulaId}`);
  const latestMigration = [...state.migrations].reverse().find((m) => m.items.some((i) => i.formula_version_id === formulaId));
  const item = latestMigration?.items.find((i) => i.formula_version_id === formulaId) ?? null;
  const evidence = [...state.evidence.values()].filter((e) => e.formula_version_id === formulaId);
  const invalidatedCount = evidence.filter((e) => e.status === "invalidated").length;

  // 迁移快照之后若已按已发布的新版本重新冻结，则当前合规状态以新冻结为准（快照不追溯改写）
  const frozenRevisionId = formula.frozen?.standard_revision_id ?? null;
  const frozenRevision = frozenRevisionId ? state.standardRevisions.get(frozenRevisionId) : null;
  const frozenAt = formula.frozen?.at ?? null;
  const frozenWhenPublished =
    Boolean(frozenRevision && frozenRevision.stage === "published" && stageAt(state, frozenRevisionId, frozenAt) === "published");
  const frozenRevisionSuperseded = Boolean(frozenRevision?.superseded_by);
  let currentStatus = item?.status ?? "no_migration_assessed";
  let currentNote = item?.action ?? "尚未产生针对该配方的标准迁移评估";
  if (frozenWhenPublished && !frozenRevisionSuperseded && invalidatedCount === 0) {
    currentStatus = "compliant_under_current";
    currentNote = `已在 ${frozenAt} 按当前有效版本 ${frozenRevisionId} 冻结，当前合规`;
  } else if (currentStatus === "grandfathered_with_deadline" && invalidatedCount > 0) {
    // 过渡资格以证据持续有效为前提；迁移后证据失效即丧失祖父地位
    currentStatus = "non_compliant_new_production";
    currentNote = `迁移时曾获过渡期（至 ${item.deadline}），但支撑证据此后失效，丧失过渡资格，停止新生产；历史记录不改写`;
  }

  return {
    formula_id: formulaId,
    frozen: formula.frozen
      ? {
          at: formula.frozen.at,
          purpose: formula.frozen.frozen_for_purpose,
          against_standard_revision: formula.frozen.standard_revision_id,
          revision_stage_at_freeze: stageAt(state, frozenRevisionId, frozenAt),
        }
      : null,
    checked_against: atRevisionId ?? latestMigration?.new_standard_revision_id ?? frozenRevisionId,
    migration_snapshot_status: item?.status ?? "no_migration_assessed",
    current_status: currentStatus,
    grandfather_deadline: item?.deadline ?? null,
    evidence_summary: {
      total: evidence.length,
      active: evidence.filter((e) => e.status === "active").length,
      requires_revalidation: evidence.filter((e) => e.status === "requires_revalidation").length,
      invalidated: invalidatedCount,
    },
    open_serious_safety: [...state.safetyEvents.values()].filter(
      (s) => s.related_formula_version_id === formulaId && SERIOUS_SEVERITY.has(s.severity) && !s.adjudication,
    ).length,
    note: currentNote,
  };
}

/** 利益冲突：已披露但无对应回避记录。 */
export function hasUnrecusedConflict(state, org, scope) {
  const declared = [...state.coi.values()].some((d) => d.org === org);
  if (!declared) return false;
  return !state.recusals.some((r) => r.org === org && scopeCovers(r.scope, scope));
}

function scopeCovers(recusalScope, target) {
  if (!recusalScope || !target) return false;
  const s = String(recusalScope);
  return s === "all" || s.split(/[,，;；]/).map((x) => x.trim()).includes(target) || s.includes(target);
}

/** 按同意范围返回某试验方案仍可用于某用途的受试者（研究编码）。 */
export function usableSubjectsFor(state, protocolId, purpose) {
  return [...state.subjects.values()]
    .filter((s) => s.trial_protocol_id === protocolId)
    .filter((s) => !s.excluded)
    .filter((s) => s.consent_scope.includes(purpose))
    .filter((s) => !s.withdrawn_scope.includes(purpose))
    .map((s) => s.pseudonymous_id);
}

/** 同意覆盖与撤回统计；撤回后既存数据按 retain_until 留存但不进入新用途。 */
export function consentCoverage(state, protocolId) {
  const subjects = [...state.subjects.values()].filter((s) => s.trial_protocol_id === protocolId);
  const byPurpose = {};
  for (const purpose of ["trial_analysis", "safety_followup", "future_secondary_research", "regulatory_inspection"]) {
    byPurpose[purpose] = {
      consented: subjects.filter((s) => s.consent_scope.includes(purpose)).length,
      withdrawn: subjects.filter((s) => s.withdrawn_scope.includes(purpose)).length,
      usable: usableSubjectsFor(state, protocolId, purpose).length,
    };
  }
  return {
    protocol_id: protocolId,
    enrolled: subjects.length,
    excluded: subjects.filter((s) => s.excluded).length,
    withdrew_any: subjects.filter((s) => s.withdrawn_scope.length > 0).length,
    by_purpose: byPurpose,
  };
}

/** 复现条款从提案、异议到修改的理由链。 */
export function clauseRationale(state, clauseId) {
  const clause = state.clauses.get(clauseId);
  if (!clause) throw new Error(`条款不存在：${clauseId}`);
  const timeline = [
    ...clause.texts.map((t) => ({
      at: t.at,
      kind: t.reason === "proposed" ? "proposal" : "revision",
      text: t.text,
      reason: t.reason,
      event_id: t.event_id,
    })),
    ...clause.objections.map((o) => ({
      at: o.at,
      kind: "objection",
      text: o.reason,
      objector_org: o.objector_org,
      resolution: o.resolution,
      event_id: o.event_id,
    })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  return {
    clause_id: clauseId,
    clause_no: clause.clause_no,
    standard_revision_id: clause.standard_revision_id,
    timeline,
    open_objections: clause.objections.filter((o) => o.resolution === "pending").length,
  };
}

/** 复现标准版本从提案、草案修改、试行到发布的全过程。 */
export function standardTimeline(state, revisionId) {
  const rev = state.standardRevisions.get(revisionId);
  if (!rev) throw new Error(`标准版本不存在：${revisionId}`);
  const clauses = [...state.clauses.values()].filter((c) => c.standard_revision_id === revisionId);
  return {
    revision_id: revisionId,
    code: rev.standard_code,
    revision_no: rev.revision_no,
    stage: rev.stage,
    stages: rev.history.map((h) => ({
      at: h.at,
      event_id: h.event_id,
      stage: h.lifecycle_stage ?? (h.superseded_by ? "superseded" : "revised"),
      note: h.change_note ?? h.rationale ?? h.grandfather_policy ?? (h.superseded_by ? `被 ${h.superseded_by} 替代` : ""),
    })),
    clause_count: clauses.length,
    clauses_with_open_objections: clauses.filter((c) => c.objections.some((o) => o.resolution === "pending")).length,
  };
}

/**
 * 监管视图：只给去标识化的聚合证据。
 * 不含任何受试者编码级明细，更不含身份信息；只有样本量、排除数、撤回数等汇总。
 */
export function regulatorView(state, { standardRevisionId = null } = {}) {
  const protocols = [...state.protocols.values()].map((protocol) => {
    const coverage = consentCoverage(state, protocol.id);
    return {
      protocol_id: protocol.id,
      design: protocol.design,
      observation_period_days: protocol.observation_period_days,
      dose: `${protocol.dose_per_serving}${protocol.dose_unit}`,
      enrolled: coverage.enrolled,
      excluded: coverage.excluded,
      withdrew_any: coverage.withdrew_any,
      consent_coverage: coverage.by_purpose,
    };
  });

  const evidence = [...state.evidence.values()].map((e) => ({
    evidence_id: e.id,
    tier: e.evidence_tier,
    tier_label: TIER_LABEL[e.evidence_tier],
    title: e.title,
    status: e.status,
    supports_claim_type: e.supports_claim_type,
    n_analyzed: e.n_analyzed ?? null,
    population: e.population_assumption_id ? state.populations.get(e.population_assumption_id)?.population_label ?? null : null,
    dose: e.dose_per_serving != null ? `${e.dose_per_serving}${e.dose_unit ?? ""}` : null,
    observation_period_days: e.observation_period_days ?? null,
    positive_endpoints: (e.endpoint_results ?? []).filter((r) => r.statistically_significant && r.clinically_meaningful).length,
    total_endpoints: (e.endpoint_results ?? []).length,
  }));

  const safety = [...state.safetyEvents.values()].map((s) => ({
    event_id: s.id,
    severity: s.severity,
    causality: s.causality_assessment,
    adjudication: s.adjudication?.adjudication ?? null,
    formula_version_id: s.related_formula_version_id,
  }));

  const claims = [...state.claims.values()].map((c) => ({
    claim_id: c.id,
    type: c.type,
    decision: c.reviews.at(-1)?.decision ?? "not_reviewed",
    suspended: Boolean(c.suspended),
  }));

  const scaleUps = [...state.scaleUps.values()].map((v) => ({
    formula_version_id: v.formula_version_id,
    batch_size: `${v.batch_size}${v.batch_size_unit}`,
    verified_bounds: `${v.verified_bounds.min_batch_size}~${v.verified_bounds.max_batch_size}${v.batch_size_unit}`,
    quality_conform: v.quality_results_conform,
  }));

  return {
    generated_for: standardRevisionId,
    de_identified: true,
    subject_level_records_released: 0,
    protocols,
    evidence,
    safety,
    claims,
    scale_ups: scaleUps,
  };
}

function stageAt(state, revisionId, isoAt) {
  const rev = state.standardRevisions.get(revisionId);
  if (!rev) return null;
  let stage = null;
  for (const h of [...rev.history].sort((a, b) => a.at.localeCompare(b.at))) {
    if (h.at.localeCompare(isoAt) <= 0) stage = h.lifecycle_stage ?? stage;
  }
  return stage;
}

function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function labelForRank(rank) {
  const entry = Object.entries(TIER_RANK).find(([, v]) => v === rank);
  return entry ? TIER_LABEL[entry[0]] : `rank ${rank}`;
}
