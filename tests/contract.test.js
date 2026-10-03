import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import test from "node:test";

import { validateEvent, eventAggregateMap } from "../src/validator.js";

const schema = JSON.parse(await readFile(new URL("../contracts/domain.schema.json", import.meta.url), "utf8"));
const sample = JSON.parse(await readFile(new URL("../data/sample.json", import.meta.url), "utf8"));

test("样例符合领域约定", () => {
  assert.deepEqual(validateEvent(sample), []);
});

test("schema 枚举的每个事件类型都在校验器映射中，且聚合类型一致", () => {
  const schemaEvents = schema.$defs.eventType.enum;
  const schemaAggregates = schema.$defs.aggregateType.enum;

  for (const type of schemaEvents) {
    assert.ok(eventAggregateMap[type], `校验器缺少事件映射：${type}`);
    assert.ok(schemaAggregates.includes(eventAggregateMap[type]), `${type} 映射到未知聚合`);
  }
  // 反向：校验器中不能有 schema 未登记的事件
  for (const type of Object.keys(eventAggregateMap)) {
    assert.ok(schemaEvents.includes(type), `校验器含 schema 未登记事件：${type}`);
  }
});

test("schema 为每个事件类型都提供了 if/then 的 payload 约束", () => {
  const covered = new Set();
  for (const rule of schema.allOf) {
    const type = rule.if?.properties?.event_type?.const;
    if (type) covered.add(type);
  }
  for (const type of schema.$defs.eventType.enum) {
    assert.ok(covered.has(type), `schema 缺少 ${type} 的 payload 约束分支`);
  }
});

test("事件类型与聚合类型不匹配被拒", () => {
  const errors = validateEvent({
    ...sample,
    event_id: "x1",
    event_type: "FORMULA_FROZEN",
    aggregate_type: "product_claim",
  });
  assert.ok(errors.some((e) => e.includes("aggregate_type")));
});

test("时间格式、payload 缺失、普适宣称均被拒", () => {
  assert.ok(validateEvent({ ...sample, occurred_at: "2026/09/20" }).length > 0);
  assert.ok(validateEvent({ ...sample, version: 0 }).some((e) => e.includes("version")));
  assert.ok(
    validateEvent({
      event_id: "x2",
      event_type: "POPULATION_ASSUMPTION_SET",
      aggregate_type: "population_assumption",
      aggregate_id: "p",
      occurred_at: "2026-09-20T12:00:00+08:00",
      version: 1,
      summary: "x",
      payload: { population_label: "所有人", inclusion: [], exclusion: [], universal_claim_allowed: true },
    }).some((e) => e.includes("适合所有人")),
  );
});

test("受试者记录禁止携带身份字段", () => {
  const errors = validateEvent({
    event_id: "x3",
    event_type: "SUBJECT_ENROLLED",
    aggregate_type: "subject",
    aggregate_id: "s1",
    occurred_at: "2026-09-20T12:00:00+08:00",
    version: 1,
    summary: "x",
    payload: {
      trial_protocol_id: "pr",
      pseudonymous_id: "S001",
      consent_scope: ["trial_analysis"],
      enrolled_at: "2026-09-20T12:00:00+08:00",
      id_card: "110xxx",
    },
  });
  assert.ok(errors.some((e) => e.includes("身份字段")));
});
