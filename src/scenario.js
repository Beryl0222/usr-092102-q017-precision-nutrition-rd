import { EvidenceChainService } from "./service.js";

/**
 * 完整业务场景（2026-09 至 2027-06）：
 * 标准草案→试行→发布→换版；原料检测/小样→人体试验→放大→主张审查；
 * 市场部越界宣称被拒；利益披露与回避；供应商变更触发证据失效与主张暂停；
 * 桥接再验证；迁移评估区分祖父合规/不得新生产/仍合规；监管去标识化查看。
 */
export function buildScenario() {
  const svc = new EvidenceChainService();
  const r = (record, opts) => svc.record(record, opts);
  const CORR = "corr-pn-standard-2026";

  // ── 1. 标准编制：提案、条款、异议、修订 ─────────────────────────────
  r({
    event_id: "evt-001",
    event_type: "STANDARD_PROPOSED",
    aggregate_type: "standard_revision",
    aggregate_id: "rev-draft",
    occurred_at: "2026-09-20T09:00:00+08:00",
    summary: "提出《精准营养产品研发证据链要求》团体标准草案 v0.1",
    payload: {
      standard_code: "T/CNIA-PN",
      revision_no: "0.1.0",
      lifecycle_stage: "draft",
      proposing_org: "省营养学会",
      rationale: "统一原料、配方、试验、主张各环节证据边界，避免阶段结果被写成全民健康宣称",
    },
  }, { correlationId: CORR });

  r({
    event_id: "evt-002",
    event_type: "CLAUSE_PROPOSED",
    aggregate_type: "standard_clause",
    aggregate_id: "clause-005",
    occurred_at: "2026-09-25T10:00:00+08:00",
    summary: "提案第5条：人体功效主张须以受试人群、剂量、观察期相匹配的人体试验为依据",
    payload: {
      standard_revision_id: "rev-draft",
      clause_no: "5.2",
      text: "人体功效主张应有与目标人群、食用剂量、观察期一致的人体试验证据；传统食养资料与实验室结果不得替代。",
      proposer_org: "科研院所联合体"
    },
  }, { correlationId: CORR });

  // 利益关系披露 + 回避（先披露，后异议）
  r({
    event_id: "evt-003",
    event_type: "COI_DECLARED",
    aggregate_type: "coi_declaration",
    aggregate_id: "coi-huayan-001",
    occurred_at: "2026-09-22T14:00:00+08:00",
    summary: "华研营养科技披露其为本标准相关产品研发的资助方",
    payload: {
      org: "华研营养科技有限公司",
      interest_type: "funding",
      related_entity: "T/CNIA-PN 编制项目",
      declared_at: "2026-09-22T14:00:00+08:00",
      detail: "提供草案编制经费及两条试验线中的一条研究合同",
    },
  }, { correlationId: CORR });

  r({
    event_id: "evt-004",
    event_type: "RECUSAL_ENFORCED",
    aggregate_type: "coi_declaration",
    aggregate_id: "coi-huayan-001",
    occurred_at: "2026-09-23T09:30:00+08:00",
    summary: "华研营养科技退出第5.2条及相关主张审查，由省营养学会接替",
    payload: {
      org: "华研营养科技有限公司",
      scope: "clause-005,claim-b-universal,claim-c-trad-risk",
      replacement_reviewer_org: "省营养学会",
      coi_declaration_id: "coi-huayan-001",
    },
  }, { correlationId: CORR });

  r({
    event_id: "evt-005",
    event_type: "CLAUSE_OBJECTED",
    aggregate_type: "standard_clause",
    aggregate_id: "clause-005",
    occurred_at: "2026-10-02T15:00:00+08:00",
    summary: "企业方异议：认为小样本探索性人体试验也应可支持功能宣称",
    payload: {
      standard_revision_id: "rev-draft",
      reason: "探索性试验若已观察到显著趋势，企业希望可先行标注功能宣称以缩短上市周期",
      objector_org: "某保健食品企业代表",
      counter_evidence_ids: [],
      resolution: "pending",
    },
  }, { correlationId: CORR });

  r({
    event_id: "evt-006",
    event_type: "CLAUSE_REVISED",
    aggregate_type: "standard_clause",
    aggregate_id: "clause-005",
    occurred_at: "2026-10-20T11:00:00+08:00",
    summary: "第5.2条修订：探索性人体证据仅支持研究性表述，关键性人体证据方可支持功效主张",
    payload: {
      standard_revision_id: "rev-draft",
      text: "人体功效主张须有人群、剂量、观察期一致的关键性人体试验或更高等级证据；探索性人体结果仅可用于研究性表述，传统食养与实验室证据不得替代。",
      change_reason: "采纳异议中对探索性结果价值的部分意见，但维持功效主张的证据门槛；探索性结果可用于机制与后续研究表述",
      responds_to_objection_ids: ["evt-005"],
    },
  }, { correlationId: CORR });

  r({
    event_id: "evt-007",
    event_type: "STANDARD_DRAFT_REVISED",
    aggregate_type: "standard_revision",
    aggregate_id: "rev-draft",
    occurred_at: "2026-11-01T09:00:00+08:00",
    summary: "草案修改形成 v0.9 报批前版本",
    payload: { revision_no: "0.9.0", change_note: "吸纳第5.2条异议处理结果，细化证据分级", affected_clause_ids: ["clause-005"] },
  }, { correlationId: CORR });

  r({
    event_id: "evt-008",
    event_type: "STANDARD_TRIAL_ISSUED",
    aggregate_type: "standard_revision",
    aggregate_id: "rev-draft",
    occurred_at: "2026-11-05T09:00:00+08:00",
    summary: "v0.9 发布试行",
    payload: {
      lifecycle_stage: "trial",
      trial_period_end: "2026-12-15",
      grandfather_policy: "试行期内依据试行版冻结的配方仅可用于试验与试生产，不得作为量产合规依据",
    },
  }, { correlationId: CORR });

  // v1.0 报批稿与正式发布
  r({
    event_id: "evt-009",
    event_type: "STANDARD_PROPOSED",
    aggregate_type: "standard_revision",
    aggregate_id: "rev-v1",
    occurred_at: "2026-11-10T09:00:00+08:00",
    summary: "形成 v1.0 正式报批稿",
    payload: {
      standard_code: "T/CNIA-PN",
      revision_no: "1.0.0",
      lifecycle_stage: "draft",
      proposing_org: "省营养学会",
      based_on_revision: "rev-draft",
      rationale: "试行期反馈无重大分歧",
    },
  }, { correlationId: CORR });

  // ── 2. 原料来源、批次检测、小样稳定性（企业侧“可生产”证据的前半段） ──
  r({
    event_id: "evt-010",
    event_type: "INGREDIENT_SOURCE_REGISTERED",
    aggregate_type: "ingredient_supplier",
    aggregate_id: "sup-mulberry",
    occurred_at: "2026-09-28T10:00:00+08:00",
    summary: "登记桑叶提取物来源：陕南基地，春季嫩叶，水提工艺",
    payload: {
      ingredient_name: "桑叶提取物（DNJ 标准化）",
      supplier_name: "陕南植提基地",
      source_spec: { origin: "陕西安康", harvest: "春季嫩叶", process: "水提醇沉", dnj_pct: "1.0%" },
    },
  });

  r({
    event_id: "evt-011",
    event_type: "INGREDIENT_SOURCE_REGISTERED",
    aggregate_type: "ingredient_supplier",
    aggregate_id: "sup-chromium",
    occurred_at: "2026-09-28T10:05:00+08:00",
    summary: "登记铬酵母来源",
    payload: {
      ingredient_name: "铬酵母",
      supplier_name: "华中酵母厂",
      source_spec: { strain: "酿酒酵母 Y-3", cr_content: "2000 mg/kg" },
    },
  });

  r({
    event_id: "evt-012",
    event_type: "BATCH_TEST_RECORDED",
    aggregate_type: "ingredient_batch",
    aggregate_id: "batch-M-20261015",
    occurred_at: "2026-10-15T16:00:00+08:00",
    summary: "桑叶提取物批次 M-20261015 进厂检验合格",
    payload: {
      batch_no: "M-20261015",
      supplier_id: "sup-mulberry",
      test_report_no: "QC-M-261015",
      tested_at: "2026-10-15T15:00:00+08:00",
      results: [
        { item: "DNJ含量", value: "1.06%", spec_limit: "≥1.0%", conforms: true },
        { item: "铅", value: "0.08 mg/kg", spec_limit: "≤0.5 mg/kg", conforms: true },
        { item: "水分", value: "4.2%", spec_limit: "≤6.0%", conforms: true },
      ],
    },
  });

  r({
    event_id: "evt-013",
    event_type: "BATCH_STABILITY_RECORDED",
    aggregate_type: "ingredient_batch",
    aggregate_id: "batch-M-20261015",
    occurred_at: "2026-11-02T10:00:00+08:00",
    summary: "实验室小样加速稳定性 90 天合格（注意：小样稳定性不外推放大）",
    payload: {
      batch_no: "M-20261015",
      condition: "加速40°C/75%RH",
      duration_days: 90,
      conforms: true,
      sample_scale: "lab_sample",
    },
  });

  // ── 3. 人群假设与配方 ─────────────────────────────────────────────
  r({
    event_id: "evt-014",
    event_type: "POPULATION_ASSUMPTION_SET",
    aggregate_type: "population_assumption",
    aggregate_id: "pop-ifg-4065",
    occurred_at: "2026-10-05T09:00:00+08:00",
    summary: "适用人群假设：40-65岁空腹血糖受损（IFG）人群",
    payload: {
      population_label: "40-65岁空腹血糖受损（IFG）人群",
      inclusion: ["年龄40-65岁", "空腹血糖6.1-6.9 mmol/L", "近3个月生活方式稳定"],
      exclusion: ["已确诊糖尿病并用药者", "妊娠哺乳期", "严重肝肾功能不全"],
      universal_claim_allowed: false,
    },
  });

  r({
    event_id: "evt-015",
    event_type: "FORMULA_DESIGNED",
    aggregate_type: "formula_version",
    aggregate_id: "formula-F-v0.9",
    occurred_at: "2026-12-03T14:00:00+08:00",
    summary: "旧规格配方 F-v0.9（单一铬酵母）",
    payload: {
      formula_code: "PN-Sugar",
      version_no: "0.9.0",
      components: [{ ingredient_supplier_id: "sup-chromium", dose_per_serving: 0.2, unit: "mg(以Cr计)" }],
      population_assumption_id: "pop-ifg-4065",
    },
  });

  r({
    event_id: "evt-016",
    event_type: "FORMULA_DESIGNED",
    aggregate_type: "formula_version",
    aggregate_id: "formula-F-v1",
    occurred_at: "2026-11-11T14:00:00+08:00",
    summary: "配方 F-v1：桑叶提取物 + 铬酵母复合",
    payload: {
      formula_code: "PN-Sugar",
      version_no: "1.0.0",
      components: [
        { ingredient_supplier_id: "sup-mulberry", dose_per_serving: 2.0, unit: "g" },
        { ingredient_supplier_id: "sup-chromium", dose_per_serving: 0.2, unit: "mg(以Cr计)" },
      ],
      population_assumption_id: "pop-ifg-4065",
    },
  });

  // ── 4. 人体试验：方案、受试者、排除、撤回 ──────────────────────────
  r({
    event_id: "evt-017",
    event_type: "TRIAL_PROTOCOL_REGISTERED",
    aggregate_type: "trial_protocol",
    aggregate_id: "protocol-RCT-01",
    occurred_at: "2026-11-12T09:00:00+08:00",
    summary: "注册双盲随机对照试验方案 RCT-01：84天，2.0g/袋，每日2袋",
    payload: {
      formula_version_id: "formula-F-v1",
      population_assumption_id: "pop-ifg-4065",
      design: "RCT_double_blind",
      dose_per_serving: 2.0,
      dose_unit: "g",
      frequency: "每日2袋",
      observation_period_days: 84,
      endpoints: [
        { endpoint: "空腹血糖变化", endpoint_type: "primary_efficacy" },
        { endpoint: "糖化血红蛋白变化", endpoint_type: "secondary_efficacy" },
        { endpoint: "不良事件发生率", endpoint_type: "safety" },
      ],
      planned_exclusion_rules: ["依从性<80%", "试验期间启用降糖药物", "主动撤回同意"],
    },
  });

  const subjects = [
    ["subj-0001", "PN-RCT01-S0001", ["trial_analysis", "safety_followup", "future_secondary_research", "regulatory_inspection"]],
    ["subj-0002", "PN-RCT01-S0002", ["trial_analysis", "safety_followup", "regulatory_inspection"]],
    ["subj-0003", "PN-RCT01-S0003", ["trial_analysis", "safety_followup", "future_secondary_research", "regulatory_inspection"]],
    ["subj-0004", "PN-RCT01-S0004", ["trial_analysis", "safety_followup", "future_secondary_research", "regulatory_inspection"]],
  ];
  const subjectEnrollTimes = ["09:00", "09:30", "10:00", "10:30"];
  subjects.forEach(([aggId, pseudo, scope], i) => {
    r({
      event_id: `evt-018-${i + 1}`,
      event_type: "SUBJECT_ENROLLED",
      aggregate_type: "subject",
      aggregate_id: aggId,
      occurred_at: `2026-11-15T${subjectEnrollTimes[i]}:00+08:00`,
      summary: `受试者 ${pseudo} 登记入组（仅研究编码）`,
      payload: {
        trial_protocol_id: "protocol-RCT-01",
        pseudonymous_id: pseudo,
        consent_scope: scope,
        enrolled_at: `2026-11-15T${subjectEnrollTimes[i]}:00+08:00`,
      },
    });
  });

  r({
    event_id: "evt-019",
    event_type: "SUBJECT_EXCLUDED",
    aggregate_type: "subject",
    aggregate_id: "subj-0003",
    occurred_at: "2027-01-10T10:00:00+08:00",
    summary: "S0003 因依从性 72% 按方案预定规则排除",
    payload: { trial_protocol_id: "protocol-RCT-01", rule_applied: "依从性<80%", pre_registered_rule: true },
  });

  r({
    event_id: "evt-020",
    event_type: "SUBJECT_CONSENT_WITHDRAWN",
    aggregate_type: "subject",
    aggregate_id: "subj-0004",
    occurred_at: "2026-12-20T11:30:00+08:00",
    summary: "S0004 撤回二次研究授权；主分析与安全随访同意仍有效",
    payload: {
      withdrawn_scope: ["future_secondary_research"],
      withdrawn_at: "2026-12-20T11:30:00+08:00",
      retain_until: "2031-12-31T23:59:59+08:00",
    },
  });

  // ── 5. 三级证据：传统食养 / 实验室 / 人体（不得互相替代） ─────────
  r({
    event_id: "evt-021",
    event_type: "EVIDENCE_ACCEPTED",
    aggregate_type: "study_evidence",
    aggregate_id: "ev-trad",
    occurred_at: "2026-10-10T10:00:00+08:00",
    summary: "传统食养资料：古籍中桑叶“止消渴”记载的文献梳理",
    payload: {
      evidence_tier: "traditional",
      title: "桑叶止消渴传统食养文献梳理",
      supports_claim_type: ["traditional_nourishment"],
    },
  });

  r({
    event_id: "evt-022",
    event_type: "EVIDENCE_ACCEPTED",
    aggregate_type: "study_evidence",
    aggregate_id: "ev-lab",
    occurred_at: "2026-10-28T10:00:00+08:00",
    summary: "实验室证据：DNJ 对 α-葡萄糖苷酶的体外抑制",
    payload: {
      evidence_tier: "in_vitro_lab",
      title: "DNJ 体外 α-葡萄糖苷酶抑制实验",
      supports_claim_type: ["mechanistic_support"],
    },
  });

  r({
    event_id: "evt-023",
    event_type: "EVIDENCE_ACCEPTED",
    aggregate_type: "study_evidence",
    aggregate_id: "ev-rct1",
    occurred_at: "2026-12-20T10:00:00+08:00",
    summary: "关键性人体证据 RCT-01：F-v1 在 IFG 人群 84 天空腹血糖显著下降",
    payload: {
      evidence_tier: "human_pivotal",
      title: "RCT-01：桑叶铬酵母配方对IFG人群血糖指标的随机双盲对照试验",
      supports_claim_type: ["structure_function", "risk_reduction"],
      trial_protocol_id: "protocol-RCT-01",
      formula_version_id: "formula-F-v1",
      ingredient_supplier_ids: ["sup-mulberry", "sup-chromium"],
      population_assumption_id: "pop-ifg-4065",
      dose_per_serving: 2.0,
      dose_unit: "g",
      observation_period_days: 84,
      n_analyzed: 3,
      endpoint_results: [
        { endpoint: "空腹血糖变化", statistically_significant: true, clinically_meaningful: true },
        { endpoint: "糖化血红蛋白变化", statistically_significant: true, clinically_meaningful: false },
        { endpoint: "不良事件发生率", statistically_significant: false, clinically_meaningful: true },
      ],
    },
  });

  r({
    event_id: "evt-024",
    event_type: "EVIDENCE_ACCEPTED",
    aggregate_type: "study_evidence",
    aggregate_id: "ev-old",
    occurred_at: "2026-12-08T10:00:00+08:00",
    summary: "旧规格 F-v0.9 的人体证据（铬酵母单一配方）",
    payload: {
      evidence_tier: "human_pivotal",
      title: "铬酵母配方 IFG 人群随机对照试验（历史）",
      supports_claim_type: ["structure_function"],
      formula_version_id: "formula-F-v0.9",
      ingredient_supplier_ids: ["sup-chromium"],
      population_assumption_id: "pop-ifg-4065",
      dose_per_serving: 0.2,
      dose_unit: "mg(以Cr计)",
      observation_period_days: 84,
      n_analyzed: 40,
      endpoint_results: [
        { endpoint: "空腹血糖变化", statistically_significant: true, clinically_meaningful: true },
      ],
    },
  });

  // ── 6. 安全事件：中度、已裁决，不阻断 ─────────────────────────────
  r({
    event_id: "evt-025",
    event_type: "SAFETY_EVENT_REPORTED",
    aggregate_type: "safety_event",
    aggregate_id: "safe-001",
    occurred_at: "2026-12-18T16:00:00+08:00",
    summary: "1例轻度胃肠胀气报告",
    payload: {
      severity: "mild",
      related_formula_version_id: "formula-F-v1",
      related_batch_no: "M-20261015",
      reported_at: "2026-12-18T16:00:00+08:00",
      description: "服用首周餐后腹胀，自行缓解",
      causality_assessment: "possible",
    },
  });

  r({
    event_id: "evt-026",
    event_type: "SAFETY_EVENT_ADJUDICATED",
    aggregate_type: "safety_event",
    aggregate_id: "safe-001",
    occurred_at: "2026-12-23T10:00:00+08:00",
    summary: "安全裁决：可能相关、症状轻微，标签增加服用提示",
    payload: {
      causality_assessment: "possible",
      adjudication: "label_change",
      adjudicator_org: "科研院所联合体安全组",
    },
  });

  // ── 7. v1.0 正式发布；配方依据正式版冻结；放大验证 ───────────────
  svc.publishStandard({
    event_id: "evt-027",
    event_type: "STANDARD_PUBLISHED",
    aggregate_type: "standard_revision",
    aggregate_id: "rev-v1",
    occurred_at: "2027-01-01T09:00:00+08:00",
    summary: "T/CNIA-PN v1.0 正式发布，2027-01-01 实施",
    payload: { lifecycle_stage: "published", effective_date: "2027-01-01", supersedes: "rev-draft", grandfather_policy: "试行结论不自动构成量产合规" },
  }, { oldRevisionId: "rev-draft", transitionDays: 0, correlationId: CORR });

  r({
    event_id: "evt-028",
    event_type: "STANDARD_SUPERSEDED",
    aggregate_type: "standard_revision",
    aggregate_id: "rev-draft",
    occurred_at: "2027-01-01T09:05:00+08:00",
    summary: "试行/草案版本被 v1.0 替代",
    payload: { superseded_by: "rev-v1", effective_date: "2027-01-01" },
  }, { correlationId: CORR });

  r({
    event_id: "evt-029",
    event_type: "FORMULA_FROZEN",
    aggregate_type: "formula_version",
    aggregate_id: "formula-F-v0.9",
    occurred_at: "2027-01-05T09:00:00+08:00",
    summary: "F-v0.9 依据 v1.0 冻结用于市场供货（旧规格）",
    payload: { frozen_for_purpose: "market_supply", standard_revision_id: "rev-v1" },
  });

  r({
    event_id: "evt-030",
    event_type: "FORMULA_FROZEN",
    aggregate_type: "formula_version",
    aggregate_id: "formula-F-v1",
    occurred_at: "2027-01-06T09:00:00+08:00",
    summary: "F-v1 依据 v1.0 冻结用于市场供货",
    payload: { frozen_for_purpose: "market_supply", standard_revision_id: "rev-v1" },
  });

  r({
    event_id: "evt-031",
    event_type: "SCALE_UP_VERIFIED",
    aggregate_type: "scale_up_batch",
    aggregate_id: "scale-F-v1-800",
    occurred_at: "2027-01-08T10:00:00+08:00",
    summary: "F-v1 放大验证：500-1200 kg 批量边界，800 kg 批次质量合格",
    payload: {
      formula_version_id: "formula-F-v1",
      batch_no: "P-20261212",
      batch_size: 800,
      batch_size_unit: "kg",
      process_parameters: { inlet_temp_c: 165, mixing_rpm: 40 },
      verified_bounds: { min_batch_size: 500, max_batch_size: 1200 },
      quality_results_conform: true,
      evidence_ids_relied_upon: ["evt-012", "evt-013", "ev-rct1"],
    },
  });

  // ── 8. 上市主张：1 条合法 + 3 条越界 ─────────────────────────────
  r({
    event_id: "evt-032",
    event_type: "CLAIM_DRAFTED",
    aggregate_type: "product_claim",
    aggregate_id: "claim-a-ifg",
    occurred_at: "2027-02-12T09:00:00+08:00",
    summary: "主张A：限定 IFG 人群、2.0g、84天的餐后血糖支持",
    payload: {
      claim_text: "供40-65岁空腹血糖受损人群食用，每日2袋、连续84天，有助于维持餐后血糖平稳",
      claim_type: "structure_function",
      target_population: "40-65岁IFG人群",
      claimed_dose: 2.0,
      claimed_dose_unit: "g",
      claimed_period_days: 84,
      formula_version_id: "formula-F-v1",
      population_assumption_id: "pop-ifg-4065",
      commercial_batch_size: 800,
      commercial_batch_size_unit: "kg",
      evidence_ids: ["ev-rct1"],
    },
  });

  r({
    event_id: "evt-033",
    event_type: "CLAIM_DRAFTED",
    aggregate_type: "product_claim",
    aggregate_id: "claim-b-universal",
    occurred_at: "2027-02-12T09:05:00+08:00",
    summary: "市场部提前写成“适合所有人”的健康宣称",
    payload: {
      claim_text: "全家都能吃，天天喝，血糖稳稳的，适合所有人的健康选择",
      claim_type: "universal_health",
      target_population: "all",
      claimed_dose: 2.0,
      claimed_dose_unit: "g",
      claimed_period_days: 84,
      formula_version_id: "formula-F-v1",
      population_assumption_id: "pop-ifg-4065",
      commercial_batch_size: 800,
      commercial_batch_size_unit: "kg",
      evidence_ids: ["ev-rct1"],
    },
  });

  r({
    event_id: "evt-034",
    event_type: "CLAIM_DRAFTED",
    aggregate_type: "product_claim",
    aggregate_id: "claim-c-trad-risk",
    occurred_at: "2027-02-13T09:00:00+08:00",
    summary: "市场部试图用传统食养资料+体外实验宣称降低糖尿病风险",
    payload: {
      claim_text: "长期饮用可降低患糖尿病风险",
      claim_type: "risk_reduction",
      target_population: "40-65岁IFG人群",
      claimed_dose: 2.0,
      claimed_dose_unit: "g",
      claimed_period_days: 84,
      formula_version_id: "formula-F-v1",
      population_assumption_id: "pop-ifg-4065",
      evidence_ids: ["ev-trad", "ev-lab"],
    },
  });

  r({
    event_id: "evt-035",
    event_type: "CLAIM_DRAFTED",
    aggregate_type: "product_claim",
    aggregate_id: "claim-d-overreach",
    occurred_at: "2027-02-13T09:05:00+08:00",
    summary: "主张D：剂量与周期超出研究边界",
    payload: {
      claim_text: "每天4袋，持续半年，血糖持续改善",
      claim_type: "structure_function",
      target_population: "40-65岁IFG人群",
      claimed_dose: 4.0,
      claimed_dose_unit: "g",
      claimed_period_days: 180,
      formula_version_id: "formula-F-v1",
      population_assumption_id: "pop-ifg-4065",
      commercial_batch_size: 800,
      commercial_batch_size_unit: "kg",
      evidence_ids: ["ev-rct1"],
    },
  });

  svc.reviewClaim("claim-a-ifg", { reviewerOrg: "省营养学会", standardRevisionId: "rev-v1", reviewedAt: "2027-02-14T10:00:00+08:00" });
  svc.reviewClaim("claim-b-universal", { reviewerOrg: "省营养学会", standardRevisionId: "rev-v1", reviewedAt: "2027-02-14T10:05:00+08:00" });
  svc.reviewClaim("claim-c-trad-risk", { reviewerOrg: "省营养学会", standardRevisionId: "rev-v1", reviewedAt: "2027-02-14T10:10:00+08:00" });
  svc.reviewClaim("claim-d-overreach", { reviewerOrg: "省营养学会", standardRevisionId: "rev-v1", reviewedAt: "2027-02-14T10:15:00+08:00" });

  // ── 9. 原料来源变更：等效性未验证 → 证据失效、主张暂停 ───────────
  svc.changeIngredientSource({
    event_id: "evt-036",
    event_type: "INGREDIENT_SOURCE_CHANGED",
    aggregate_type: "ingredient_supplier",
    aggregate_id: "sup-mulberry",
    occurred_at: "2027-03-01T09:00:00+08:00",
    summary: "桑叶提取物采购来源由陕南基地切换为华东基地，尚未取得等效性验证",
    payload: {
      old_source: "陕南植提基地（水提醇沉，DNJ 1.0%）",
      new_source: "华东植提工厂（来源、工艺变更，等效性未验证）",
      change_reason: "原基地供应中断",
      equivalence_claim: "unverified",
    },
  }, { correlationId: CORR });

  // ── 10. 桥接再验证：新配方 + 新来源上的关键性人体证据 ─────────────
  r({
    event_id: "evt-037",
    event_type: "FORMULA_DESIGNED",
    aggregate_type: "formula_version",
    aggregate_id: "formula-F-v2",
    occurred_at: "2027-03-05T14:00:00+08:00",
    summary: "F-v2：切换新来源桑叶后的配方版本，须桥接核查，不自动继承旧证据",
    payload: {
      formula_code: "PN-Sugar",
      version_no: "2.0.0",
      components: [
        { ingredient_supplier_id: "sup-mulberry", dose_per_serving: 2.0, unit: "g" },
        { ingredient_supplier_id: "sup-chromium", dose_per_serving: 0.2, unit: "mg(以Cr计)" },
      ],
      population_assumption_id: "pop-ifg-4065",
      based_on_formula_version: "formula-F-v1",
    },
  });

  r({
    event_id: "evt-038",
    event_type: "EVIDENCE_ACCEPTED",
    aggregate_type: "study_evidence",
    aggregate_id: "ev-bridge",
    occurred_at: "2027-06-10T10:00:00+08:00",
    summary: "新来源桥接 RCT：F-v2 在同人群同剂量 84 天达到主要终点",
    payload: {
      evidence_tier: "human_pivotal",
      title: "RCT-02：华东来源桑叶配方桥接随机对照试验",
      supports_claim_type: ["structure_function", "risk_reduction"],
      formula_version_id: "formula-F-v2",
      ingredient_supplier_ids: ["sup-mulberry", "sup-chromium"],
      population_assumption_id: "pop-ifg-4065",
      dose_per_serving: 2.0,
      dose_unit: "g",
      observation_period_days: 84,
      n_analyzed: 48,
      endpoint_results: [
        { endpoint: "空腹血糖变化", statistically_significant: true, clinically_meaningful: true },
        { endpoint: "糖化血红蛋白变化", statistically_significant: true, clinically_meaningful: true },
      ],
    },
  });

  r({
    event_id: "evt-039",
    event_type: "SCALE_UP_VERIFIED",
    aggregate_type: "scale_up_batch",
    aggregate_id: "scale-F-v2-700",
    occurred_at: "2027-06-15T10:00:00+08:00",
    summary: "F-v2 放大验证：400-1000 kg，700 kg 批次合格",
    payload: {
      formula_version_id: "formula-F-v2",
      batch_no: "P-20270425",
      batch_size: 700,
      batch_size_unit: "kg",
      process_parameters: { inlet_temp_c: 160, mixing_rpm: 42 },
      verified_bounds: { min_batch_size: 400, max_batch_size: 1000 },
      quality_results_conform: true,
      evidence_ids_relied_upon: ["ev-bridge"],
    },
  });

  r({
    event_id: "evt-040",
    event_type: "CLAIM_DRAFTED",
    aggregate_type: "product_claim",
    aggregate_id: "claim-a2-ifg",
    occurred_at: "2027-06-16T09:00:00+08:00",
    summary: "F-v2 重新提交限定人群主张",
    payload: {
      claim_text: "供40-65岁空腹血糖受损人群食用，每日2袋、连续84天，有助于维持餐后血糖平稳",
      claim_type: "structure_function",
      target_population: "40-65岁IFG人群",
      claimed_dose: 2.0,
      claimed_dose_unit: "g",
      claimed_period_days: 84,
      formula_version_id: "formula-F-v2",
      population_assumption_id: "pop-ifg-4065",
      commercial_batch_size: 700,
      commercial_batch_size_unit: "kg",
      evidence_ids: ["ev-bridge"],
    },
  });

  svc.reviewClaim("claim-a2-ifg", { reviewerOrg: "省营养学会", standardRevisionId: "rev-v1", reviewedAt: "2027-06-18T10:00:00+08:00" });

  // ── 11. 标准换版 v2.0：迁移评估（不追溯） ─────────────────────────
  r({
    event_id: "evt-041",
    event_type: "STANDARD_PROPOSED",
    aggregate_type: "standard_revision",
    aggregate_id: "rev-v2",
    occurred_at: "2027-04-15T09:00:00+08:00",
    summary: "提出 v2.0 草案：增加原料变更桥接与放大验证边界条款",
    payload: {
      standard_code: "T/CNIA-PN",
      revision_no: "2.0.0",
      lifecycle_stage: "draft",
      proposing_org: "省营养学会",
      based_on_revision: "rev-v1",
      rationale: "收集到来源变更导致证据失效的实际案例",
    },
  }, { correlationId: CORR });

  r({
    event_id: "evt-042",
    event_type: "FORMULA_FROZEN",
    aggregate_type: "formula_version",
    aggregate_id: "formula-F-v2",
    occurred_at: "2027-06-20T09:00:00+08:00",
    summary: "F-v2 依据 v2.0 报批稿冻结量产准备",
    payload: { frozen_for_purpose: "market_supply", standard_revision_id: "rev-v2" },
  });

  const { migration } = svc.publishStandard({
    event_id: "evt-043",
    event_type: "STANDARD_PUBLISHED",
    aggregate_type: "standard_revision",
    aggregate_id: "rev-v2",
    occurred_at: "2027-07-01T09:00:00+08:00",
    summary: "T/CNIA-PN v2.0 发布，2027-07-15 实施，旧规格给 365 天过渡期",
    payload: { lifecycle_stage: "published", effective_date: "2027-07-15", supersedes: "rev-v1", grandfather_policy: "依据 v1.0 合法冻结且证据仍有效的配方给予 365 天过渡期" },
  }, { oldRevisionId: "rev-v1", transitionDays: 365, correlationId: CORR });

  r({
    event_id: "evt-044",
    event_type: "STANDARD_SUPERSEDED",
    aggregate_type: "standard_revision",
    aggregate_id: "rev-v1",
    occurred_at: "2027-07-01T09:05:00+08:00",
    summary: "v1.0 被 v2.0 替代（历史版本与当时决定保留）",
    payload: { superseded_by: "rev-v2", effective_date: "2027-07-15" },
  }, { correlationId: CORR });

  // v2.0 生效后，F-v2 按正式版本重新冻结（草案期冻结不构成量产合规）
  r({
    event_id: "evt-045",
    event_type: "FORMULA_FROZEN",
    aggregate_type: "formula_version",
    aggregate_id: "formula-F-v2",
    occurred_at: "2027-07-16T09:00:00+08:00",
    summary: "F-v2 在 v2.0 生效后按正式版本重新冻结量产",
    payload: { frozen_for_purpose: "market_supply", standard_revision_id: "rev-v2" },
  }, { correlationId: CORR });

  // ── 12. 监管去标识化查看 ─────────────────────────────────────────
  const regulatorView = svc.regulatorInspection({
    viewerOrg: "省市场监督管理局",
    viewedAt: "2027-07-20T10:00:00+08:00",
    standardRevisionId: "rev-v2",
    evidenceIds: ["ev-rct1", "ev-bridge", "ev-old", "ev-trad", "ev-lab"],
  });

  return { service: svc, migration, regulatorView, correlationId: CORR };
}
