/**
 * 从只追加事件流折叠出当前世界状态。
 * 历史事件永不修改；“证据失效”“同意撤回”等均为投影状态，并保留使其失效的触发事件。
 */

export function buildProjector() {
  return function project(events) {
    const state = {
      standardRevisions: new Map(), // id -> revision
      clauses: new Map(), // id -> clause（含按版本的历史文本）
      suppliers: new Map(), // id -> supplier，含 source 变更链
      batches: new Map(), // batch_no -> { tests:[], stability:[] , supplierId }
      populations: new Map(), // id -> assumption
      formulas: new Map(), // id -> formula
      protocols: new Map(), // id -> protocol
      subjects: new Map(), // id(pseudonymous) -> { enrollment, excluded, withdrawnScope:[] }
      evidence: new Map(), // id -> evidence record（含 status: active|invalidated）
      safetyEvents: new Map(), // id -> event
      scaleUps: new Map(), // id -> scale up verification
      claims: new Map(), // id -> claim 草稿+最新审查
      coi: new Map(), // declaration id -> declaration
      recusals: [], // { org, scope, ... }
      impacts: new Map(),
      migrations: [],
      audit: [],
    };

    for (const e of events) apply(state, e);
    return state;
  };
}

function apply(state, e) {
  const p = e.payload ?? {};
  switch (e.event_type) {
    case "STANDARD_PROPOSED":
    case "STANDARD_DRAFT_REVISED":
    case "STANDARD_TRIAL_ISSUED":
    case "STANDARD_PUBLISHED":
    case "STANDARD_SUPERSEDED": {
      const prev = state.standardRevisions.get(e.aggregate_id) ?? {
        id: e.aggregate_id,
        history: [],
      };
      prev.history.push({ event_id: e.event_id, at: e.occurred_at, ...p });
      prev.stage = p.lifecycle_stage ?? (e.event_type === "STANDARD_SUPERSEDED" ? "superseded" : prev.stage);
      prev.revision_no = p.revision_no ?? prev.revision_no;
      prev.standard_code = p.standard_code ?? prev.standard_code;
      prev.effective_date = p.effective_date ?? prev.effective_date;
      prev.superseded_by = p.superseded_by ?? prev.superseded_by;
      state.standardRevisions.set(e.aggregate_id, prev);
      break;
    }
    case "CLAUSE_PROPOSED":
    case "CLAUSE_OBJECTED":
    case "CLAUSE_REVISED": {
      const clause = state.clauses.get(e.aggregate_id) ?? {
        id: e.aggregate_id,
        standard_revision_id: p.standard_revision_id,
        texts: [],
        objections: [],
      };
      if (e.event_type === "CLAUSE_PROPOSED" || e.event_type === "CLAUSE_REVISED") {
        clause.texts.push({
          event_id: e.event_id,
          at: e.occurred_at,
          text: p.text,
          clause_no: p.clause_no ?? clause.clause_no,
          reason: p.change_reason ?? "proposed",
        });
        clause.clause_no = p.clause_no ?? clause.clause_no;
        // 修订明确回应的异议标记为已由修订处理（异议本身的原始记录保留）
        for (const objectionId of p.responds_to_objection_ids ?? []) {
          const obj = clause.objections.find((o) => o.event_id === objectionId);
          if (obj) obj.resolution = "resolved_by_revision";
        }
      }
      if (e.event_type === "CLAUSE_OBJECTED") {
        clause.objections.push({
          event_id: e.event_id,
          at: e.occurred_at,
          reason: p.reason,
          objector_org: p.objector_org,
          resolution: p.resolution ?? "pending",
        });
      }
      state.clauses.set(e.aggregate_id, clause);
      break;
    }
    case "INGREDIENT_SOURCE_REGISTERED": {
      state.suppliers.set(e.aggregate_id, {
        id: e.aggregate_id,
        ingredient_name: p.ingredient_name,
        current: { supplier_name: p.supplier_name, spec: p.source_spec },
        history: [{ at: e.occurred_at, supplier_name: p.supplier_name, spec: p.source_spec, event_id: e.event_id }],
      });
      break;
    }
    case "INGREDIENT_SOURCE_CHANGED": {
      const s = state.suppliers.get(e.aggregate_id);
      if (s) {
        s.history.push({
          at: e.occurred_at,
          from: p.old_source,
          to: p.new_source,
          equivalence: p.equivalence_claim,
          event_id: e.event_id,
        });
        s.current = { supplier_name: p.new_source, spec: s.current.spec };
        s.lastChangeEventId = e.event_id;
        s.lastEquivalence = p.equivalence_claim;
      }
      break;
    }
    case "BATCH_TEST_RECORDED": {
      const b = state.batches.get(p.batch_no) ?? { batch_no: p.batch_no, tests: [], stability: [] };
      b.supplierId = p.supplier_id;
      b.tests.push({ report: p.test_report_no, at: p.tested_at ?? e.occurred_at, results: p.results });
      state.batches.set(p.batch_no, b);
      break;
    }
    case "BATCH_STABILITY_RECORDED": {
      const b = state.batches.get(p.batch_no) ?? { batch_no: p.batch_no, tests: [], stability: [] };
      b.stability.push({ ...p });
      state.batches.set(p.batch_no, b);
      break;
    }
    case "POPULATION_ASSUMPTION_SET":
      state.populations.set(e.aggregate_id, { id: e.aggregate_id, ...p });
      break;
    case "FORMULA_DESIGNED":
      state.formulas.set(e.aggregate_id, {
        id: e.aggregate_id,
        ...p,
        frozen: null,
      });
      break;
    case "FORMULA_FROZEN": {
      const f = state.formulas.get(e.aggregate_id);
      if (f) f.frozen = { at: e.occurred_at, ...p };
      break;
    }
    case "TRIAL_PROTOCOL_REGISTERED":
      state.protocols.set(e.aggregate_id, { id: e.aggregate_id, ...p });
      break;
    case "SUBJECT_ENROLLED": {
      // 以受试者聚合 id 为主键，研究编码作为字段（排除/撤回事件只携带聚合 id）
      state.subjects.set(e.aggregate_id, {
        id: e.aggregate_id,
        pseudonymous_id: p.pseudonymous_id,
        trial_protocol_id: p.trial_protocol_id,
        consent_scope: [...p.consent_scope],
        withdrawn_scope: [],
        enrolled_at: p.enrolled_at,
        excluded: null,
      });
      break;
    }
    case "SUBJECT_EXCLUDED": {
      // 排除记录挂在协议下；按 pseudonymous 无法直接定位时以 aggregate_id 记录
      const subj = state.subjects.get(e.aggregate_id);
      if (subj) {
        subj.excluded = { rule: p.rule_applied, at: e.occurred_at };
      }
      break;
    }
    case "SUBJECT_CONSENT_WITHDRAWN": {
      const subj = state.subjects.get(e.aggregate_id);
      if (subj) {
        for (const scope of p.withdrawn_scope) {
          if (scope === "all_new_use") {
            subj.withdrawn_scope = ["trial_analysis", "safety_followup", "future_secondary_research"];
          } else if (!subj.withdrawn_scope.includes(scope)) {
            subj.withdrawn_scope.push(scope);
          }
        }
        subj.retain_until = p.retain_until;
        subj.withdrawn_at = p.withdrawn_at;
      }
      break;
    }
    case "EVIDENCE_ACCEPTED":
      state.evidence.set(e.aggregate_id, {
        id: e.aggregate_id,
        event_id: e.event_id,
        status: "active",
        ...p,
      });
      break;
    case "SAFETY_EVENT_REPORTED":
      state.safetyEvents.set(e.aggregate_id, { id: e.aggregate_id, ...p, adjudication: null });
      break;
    case "SAFETY_EVENT_ADJUDICATED": {
      const s = state.safetyEvents.get(e.aggregate_id);
      if (s) s.adjudication = { at: e.occurred_at, ...p };
      break;
    }
    case "SCALE_UP_VERIFIED":
      state.scaleUps.set(e.aggregate_id, { id: e.aggregate_id, ...p });
      break;
    case "CLAIM_DRAFTED":
      state.claims.set(e.aggregate_id, {
        id: e.aggregate_id,
        text: p.claim_text,
        type: p.claim_type,
        target_population: p.target_population,
        dose: p.claimed_dose,
        dose_unit: p.claimed_dose_unit,
        period_days: p.claimed_period_days,
        formula_version_id: p.formula_version_id,
        population_assumption_id: p.population_assumption_id,
        commercial_batch_size: p.commercial_batch_size,
        commercial_batch_size_unit: p.commercial_batch_size_unit,
        evidence_ids: p.evidence_ids ?? [],
        reviews: [],
        suspended: null,
      });
      break;
    case "CLAIM_REVIEWED": {
      const c = state.claims.get(e.aggregate_id);
      if (c) {
        c.reviews.push({ at: e.occurred_at, event_id: e.event_id, ...p });
        // 再验证后审查通过即恢复主张；暂停历史保留在事件流中
        if (p.decision === "approved") c.suspended = null;
      }
      break;
    }
    case "CLAIM_SUSPENDED": {
      const c = state.claims.get(e.aggregate_id);
      if (c) c.suspended = { at: e.occurred_at, ...p };
      break;
    }
    case "COI_DECLARED":
      state.coi.set(e.aggregate_id, { id: e.aggregate_id, ...p });
      break;
    case "RECUSAL_ENFORCED":
      state.recusals.push({ at: e.occurred_at, ...p });
      break;
    case "IMPACT_ASSESSED":
      state.impacts.set(e.aggregate_id, { id: e.aggregate_id, ...p });
      // 把失效/需复验状态回写到证据
      for (const item of [...p.affected_evidence, ...p.affected_claims, ...p.affected_safety]) {
        const ev = state.evidence.get(item.id);
        if (ev && item.impact === "invalidated") {
          ev.status = "invalidated";
          ev.invalidated_by = p.change_event_id;
        } else if (ev && item.impact === "requires_revalidation") {
          ev.status = ev.status === "invalidated" ? ev.status : "requires_revalidation";
          ev.revalidation_triggered_by = p.change_event_id;
        }
      }
      break;
    case "MIGRATION_ASSESSED":
      state.migrations.push({ id: e.aggregate_id, ...p });
      break;
    case "EVIDENCE_VIEWED":
      state.audit.push({ at: e.occurred_at, ...p });
      break;
    default:
      break;
  }
}
