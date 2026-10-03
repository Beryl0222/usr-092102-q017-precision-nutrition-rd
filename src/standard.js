/**
 * 标准条款全周期管理：提案 → 异议/答复 → 试行 → 发布。
 *
 * 每一步都以事件落库并携带理由，标准委员会可随时复现
 * 条款从提案、异议、试行到发布的完整理由链。
 */

export const CLAUSE_STAGES = ["proposed", "objected", "trial", "published"];

const EVENT_TO_STAGE = {
  STANDARD_PROPOSED: "proposed",
  OBJECTION_RAISED: "objected",
  TRIAL_STARTED: "trial",
  STANDARD_PUBLISHED: "published",
};

/** 允许的主线推进；异议是横插状态，答复后回到提出异议时的阶段。 */
const ALLOWED_NEXT = {
  proposed: ["objected", "trial"],
  trial: ["objected", "published"],
  published: [],
};

/**
 * 当前阶段：由该聚合已发生的事件序列推导。
 * 用栈记录异议发生前的阶段，OBJECTION_RESOLVED 后回到该阶段。
 */
export function currentStage(events) {
  let stage = null;
  const stack = [];
  for (const e of events) {
    if (e.event_type === "OBJECTION_RESOLVED") {
      if (stage !== "objected") throw new Error(`未处于异议状态，不能答复异议（事件 ${e.event_id}）`);
      stage = stack.pop();
      continue;
    }
    const next = EVENT_TO_STAGE[e.event_type];
    if (!next) continue;
    if (stage === null) {
      if (next !== "proposed") throw new Error(`条款首个事件必须是提案，实际为 ${e.event_type}`);
    } else if (next === "objected") {
      if (!ALLOWED_NEXT[stage].includes("objected")) throw new Error(`阶段 ${stage} 下不能再提异议（事件 ${e.event_id}）`);
      stack.push(stage);
    } else if (!ALLOWED_NEXT[stage].includes(next)) {
      throw new Error(`条款阶段不能从 ${stage} 推进到 ${next}（事件 ${e.event_id}）`);
    }
    stage = next;
  }
  return stage;
}

/**
 * 复现某条款的理由链：按时间顺序返回每一步的阶段、理由与出处事件。
 * 供标准委员会回答“这条款为什么是这样定的”。
 */
export function clauseTrail(events) {
  // 先走一遍状态机，确保链条本身合法
  currentStage(events);
  return events
    .filter((e) => e.event_type in EVENT_TO_STAGE || e.event_type === "OBJECTION_RESOLVED")
    .map((e) => ({
      stage: e.event_type === "OBJECTION_RESOLVED" ? "resolved" : EVENT_TO_STAGE[e.event_type],
      event_id: e.event_id,
      occurred_at: e.occurred_at,
      rationale: e.rationale ?? e.summary,
      actor: e.actor ?? null,
    }));
}
