import { hashEvent, validateEvent } from "./validator.js";

/**
 * 只追加事件日志。
 * - 同一 aggregate 的 version 必须连续递增（草案每次调整即新版本，历史版本不被覆盖）；
 * - 链式哈希 + 全局序号，任何对已入库事件的篡改/删除都会在 verifyIntegrity 时暴露；
 * - 不提供 update/delete：受试者撤回以 SUBJECT_CONSENT_WITHDRAWN 事件表达，
 *   标准更新以新版本表达，绝不追溯改写当时合法的记录。
 */
export class EventStore {
  #events = [];
  #seq = 0;
  #hashes = [];

  /** 追加并返回事件；causationId/correlationId 用于影响评估与编制流程溯源。 */
  append(record, { causationId = null, correlationId = null } = {}) {
    const errors = validateEvent(record);
    if (errors.length > 0) throw new EventValidationError(record, errors);

    const currentVersion = this.currentVersion(record.aggregate_id);
    const expected = currentVersion + 1;
    if (record.version !== expected) {
      throw new Error(
        `聚合 ${record.aggregate_id} 版本冲突：期望 v${expected}，收到 v${record.version}（事件版本必须连续递增，禁止覆盖历史版本）`,
      );
    }
    if (this.#events.some((e) => e.event_id === record.event_id)) {
      throw new Error(`event_id 重复：${record.event_id}`);
    }
    if (causationId && !this.#events.some((e) => e.event_id === causationId)) {
      throw new Error(`causation_id 指向不存在的事件：${causationId}`);
    }

    const stored = {
      ...record,
      ...(causationId ? { causation_id: causationId } : {}),
      ...(correlationId ? { correlation_id: correlationId } : {}),
    };
    const prevHash = this.#hashes.at(-1) ?? null;
    const digest = hashEvent(stored, prevHash);
    this.#seq += 1;
    this.#events.push(stored);
    this.#hashes.push(digest);
    return { event: stored, seq: this.#seq, hash: digest };
  }

  events() {
    return this.#events.map((e) => structuredClone(e));
  }

  eventsFor(aggregateId) {
    return this.#events.filter((e) => e.aggregate_id === aggregateId).map((e) => structuredClone(e));
  }

  eventsByType(type) {
    return this.#events.filter((e) => e.event_type === type).map((e) => structuredClone(e));
  }

  currentVersion(aggregateId) {
    return this.#events.filter((e) => e.aggregate_id === aggregateId).length;
  }

  getEvent(eventId) {
    const found = this.#events.find((e) => e.event_id === eventId);
    return found ? structuredClone(found) : null;
  }

  /** 按 correlation_id 取一次编制流程（提案→异议→试行→发布）的全部事件。 */
  trace(correlationId) {
    return this.#events.filter((e) => e.correlation_id === correlationId).map((e) => structuredClone(e));
  }

  /** 重放某一聚合的全部事件，得到当前投影状态（纯函数式折叠）。 */
  replay(aggregateId, reducer, initial = {}) {
    return this.eventsFor(aggregateId).reduce((state, event) => reducer(state, event), structuredClone(initial));
  }

  /** 全量重放。 */
  replayAll(reducer, initial = {}) {
    return this.events().reduce((state, event) => reducer(state, event), structuredClone(initial));
  }

  /** 导出可持久化的链（事件 + 哈希锚点）。 */
  dumpChain() {
    return { events: this.events(), hashes: [...this.#hashes] };
  }

  /**
   * 从持久化介质载入链：逐条重算哈希锚点，任何字段篡改、删除、重排都会被拒绝。
   * 校验通过才填充存储；失败时返回错误位置且本存储保持为空。
   */
  static loadChain({ events, hashes }) {
    const store = new EventStore();
    if (!Array.isArray(events) || !Array.isArray(hashes) || events.length !== hashes.length) {
      return { ok: false, error: "链数据结构不完整" };
    }
    let prev = null;
    for (let i = 0; i < events.length; i += 1) {
      const errors = validateEvent(events[i]);
      if (errors.length > 0) return { ok: false, broken_at_seq: i + 1, event_id: events[i].event_id, error: errors.join("；") };
      if (hashEvent(events[i], prev) !== hashes[i]) {
        return { ok: false, broken_at_seq: i + 1, event_id: events[i].event_id, error: "哈希锚点不匹配：事件被篡改、删除或重排" };
      }
      prev = hashes[i];
    }
    // 版本连续性与 event_id 唯一性
    const seen = new Set();
    const versions = new Map();
    for (const e of events) {
      if (seen.has(e.event_id)) return { ok: false, error: `event_id 重复：${e.event_id}` };
      seen.add(e.event_id);
      const v = (versions.get(e.aggregate_id) ?? 0) + 1;
      if (e.version !== v) return { ok: false, event_id: e.event_id, error: `聚合 ${e.aggregate_id} 版本链不连续` };
      versions.set(e.aggregate_id, v);
      store.#events.push(structuredClone(e));
    }
    store.#hashes = [...hashes];
    store.#seq = events.length;
    return { ok: true, store };
  }

  /** 重算整条哈希链，检测插入、删除、字段篡改。 */
  verifyIntegrity() {
    let prev = null;
    for (let i = 0; i < this.#events.length; i += 1) {
      const digest = hashEvent(this.#events[i], prev);
      if (digest !== this.#hashes[i]) {
        return { ok: false, broken_at_seq: i + 1, event_id: this.#events[i].event_id };
      }
      prev = digest;
    }
    return { ok: true, event_count: this.#events.length };
  }
}

export class EventValidationError extends Error {
  constructor(record, errors) {
    super(`事件校验失败（${record.event_type ?? "unknown"}）：\n- ${errors.join("\n- ")}`);
    this.name = "EventValidationError";
    this.errors = errors;
  }
}
