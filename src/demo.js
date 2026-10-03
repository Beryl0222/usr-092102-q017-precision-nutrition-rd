import { buildScenario } from "./scenario.js";
import { TIER_LABEL } from "./policies.js";

const line = (title) => console.log(`\n${"═".repeat(72)}\n${title}\n${"─".repeat(72)}`);

const { service, migration, regulatorView, correlationId } = buildScenario();
const state = service.state;

console.log("精准营养研发证据链服务 · 场景演示");
console.log("=".repeat(72));

// 1. 主张审查结果：研发人员能看到缺哪一级证据
line("1) 上市主张审查（证据等级 / 人群 / 剂量 / 观察期 / 放大边界）");
for (const id of ["claim-a-ifg", "claim-b-universal", "claim-c-trad-risk", "claim-d-overreach", "claim-a2-ifg"]) {
  const c = state.claims.get(id);
  const latest = c.reviews.at(-1);
  console.log(`\n● ${id}：${c.text}`);
  console.log(`  决定：${latest?.decision ?? "未审查"}；当前状态：${c.suspended ? `已暂停（${c.suspended.reason.slice(0, 30)}…）` : "有效"}`);
  for (const fd of latest?.findings ?? []) {
    if (fd.code === "OK") console.log(`  ✓ ${fd.message}`);
    else console.log(`  ✗ [${fd.code}] ${fd.message}`);
  }
}

// 2. 缺哪一级证据的直接回答
line("2) 证据分级（传统食养 / 实验室 / 人体不可互相替代）");
for (const id of ["ev-trad", "ev-lab", "ev-rct1", "ev-old", "ev-bridge"]) {
  const e = state.evidence.get(id);
  console.log(`- ${id}：${TIER_LABEL[e.evidence_tier]}｜${e.title}｜状态=${e.status}｜可支持：${e.supports_claim_type.join("、")}`);
}

// 3. 放大验证边界
line("3) 放大验证边界（小样稳定性≠放大证据）");
for (const [fid, size, unit] of [["formula-F-v1", 800, "kg"], ["formula-F-v1", 2000, "kg"], ["formula-F-v2", 700, "kg"]]) {
  const b = service.scaleUpBoundary(fid, size, unit);
  const verdict = !b.verifiable ? `无法证明（${b.reason}）` : b.within ? `在验证边界内（${b.min}~${b.max}${b.unit}）` : `超出边界，禁止量产（${b.min}~${b.max}${b.unit}）`;
  console.log(`- ${fid} @${size}${unit}：${verdict}`);
}

// 4. 供应商变更影响
line("4) 原料来源变更的影响计算（evt-036 后）");
const impact = [...state.impacts.values()].find((v) => v.change_event_id === "evt-036");
for (const group of ["affected_evidence", "affected_claims", "affected_safety"]) {
  console.log(`· ${group}：`);
  for (const item of impact[group]) console.log(`    - ${item.id}：${item.impact}（${item.reason.slice(0, 40)}…）`);
}

// 5. 旧配方是否仍合规：立即回答
line("5) 配方合规速查（标准更新后不追溯）");
for (const id of ["formula-F-v0.9", "formula-F-v1", "formula-F-v2"]) {
  const info = service.complianceOf(id);
  console.log(`\n● ${id}`);
  console.log(`  冻结依据：${info.frozen?.against_standard_revision}（冻结时该版本阶段：${info.frozen?.revision_stage_at_freeze}）`);
  console.log(`  迁移快照：${info.migration_snapshot_status}｜当前：${info.current_status}｜过渡期截止：${info.grandfather_deadline ?? "—"}`);
  console.log(`  证据：共${info.evidence_summary.total}，有效${info.evidence_summary.active}，待复验${info.evidence_summary.requires_revalidation}，失效${info.evidence_summary.invalidated}`);
  console.log(`  说明：${info.note}`);
}

// 6. 标准迁移评估
line("6) v1.0 → v2.0 迁移评估");
console.log(JSON.stringify(migration.items, null, 2));

// 7) 受试者同意与撤回
line("7) 受试者同意范围（撤回只停新用途，既存数据依法留存）");
console.log(JSON.stringify(service.consentOf("protocol-RCT-01"), null, 2));

// 8) 条款理由链与标准全过程复现
line("8) 条款 5.2 从提案、异议到修订的理由链");
console.log(JSON.stringify(service.rationaleOf("clause-005"), null, 2));

line("9) 标准版本全生命周期（提案→试行→发布→被替代）");
console.log(JSON.stringify(service.timelineOf("rev-draft"), null, 2));

// 9. 监管视图
line("10) 监管查看：去标识化证据（0 条受试者明细）");
console.log(`subject_level_records_released = ${regulatorView.subject_level_records_released}`);
console.log(JSON.stringify(regulatorView, null, 2));

// 10. 防篡改
line("11) 事件链完整性");
console.log(JSON.stringify(service.verify(), null, 2));

line("12) 编制流程关联（correlation_id 可复现）");
console.log(`流程 ${correlationId} 共 ${service.store.trace(correlationId).length} 条事件，类型顺序：`);
console.log(service.store.trace(correlationId).map((e) => e.event_type).join(" → "));
