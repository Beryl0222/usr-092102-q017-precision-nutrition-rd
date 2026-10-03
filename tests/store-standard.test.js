import assert from "node:assert/strict";
import test from "node:test";

import { EventStore } from "../src/store.js";
import { clauseTrail, currentStage } from "../src/standard.js";

function ev(id, type, version, extra = {}) {
  return {
    event_id: id,
    event_type: type,
    aggregate_type: "standard_revision",
    aggregate_id: "STD-条款-糖",
    occurred_at: "2026-09-01T10:00:00+08:00",
    version,
    summary: id,
    ...extra,
  };
}

test("事件存储强制版本递增，拒绝跳版与改写", () => {
  const store = new EventStore();
  store.append(ev("E1", "STANDARD_PROPOSED", 1));
  store.append(ev("E2", "TRIAL_STARTED", 2));
  assert.throws(() => store.append(ev("E3", "STANDARD_PUBLISHED", 2)), /版本应为 3/);
  assert.throws(() => store.append(ev("E4", "STANDARD_PUBLISHED", 4)), /版本应为 3/);
  assert.equal(store.all().length, 2);
});

test("未知事件类型被拒绝", () => {
  const store = new EventStore();
  assert.throws(() => store.append(ev("E1", "TAMPERED", 1)), /未知事件类型/);
});

test("条款理由链可复现：提案 → 异议 → 答复 → 试行 → 发布", () => {
  const store = new EventStore();
  store.append(ev("E1", "STANDARD_PROPOSED", 1, { rationale: "提案：基于三份人体试验设定糖上限", actor: "工作组" }));
  store.append(ev("E2", "OBJECTION_RAISED", 2, { rationale: "异议：上限对老年人群证据不足", actor: "委员A" }));
  store.append(ev("E3", "OBJECTION_RESOLVED", 3, { rationale: "答复：补充老年亚组数据后维持上限", actor: "工作组" }));
  store.append(ev("E4", "TRIAL_STARTED", 4, { rationale: "试行：六家企业试点一个季度", actor: "委员会" }));
  store.append(ev("E5", "STANDARD_PUBLISHED", 5, { rationale: "发布：试行反馈无重大偏差", actor: "委员会" }));

  const events = store.eventsOf("standard_revision", "STD-条款-糖");
  assert.equal(currentStage(events), "published");

  const trail = clauseTrail(events);
  assert.deepEqual(trail.map((t) => t.stage), ["proposed", "objected", "resolved", "trial", "published"]);
  assert.ok(trail[1].rationale.includes("老年人群"));
  assert.ok(trail[4].rationale.includes("试行反馈"));
});

test("试行期异议答复后回到试行阶段；非法推进被拒绝", () => {
  const store = new EventStore();
  store.append(ev("E1", "STANDARD_PROPOSED", 1));
  store.append(ev("E2", "TRIAL_STARTED", 2));
  store.append(ev("E3", "OBJECTION_RAISED", 3));
  store.append(ev("E4", "OBJECTION_RESOLVED", 4));
  assert.equal(currentStage(store.eventsOf("standard_revision", "STD-条款-糖")), "trial");

  const bad = new EventStore();
  bad.append(ev("E1", "STANDARD_PROPOSED", 1));
  bad.append(ev("E2", "STANDARD_PUBLISHED", 2));
  assert.throws(() => currentStage(bad.eventsOf("standard_revision", "STD-条款-糖")), /不能从 proposed 推进到 published/);
});
