import { validateEvent } from "./validator.js";

/**
 * 追加式事件存储。
 *
 * 语义约定：
 * - 每个聚合（aggregate_type + aggregate_id）的 version 必须从 1 开始逐条递增，
 *   借此保证历史事件不被插入、覆盖或重排——“当时合法”的版本永远保持原样。
 * - 存储只提供追加与读取，不提供修改与删除。
 */
export class EventStore {
  #events = [];

  /** 追加一条事件，返回落库后的事件；不合法或版本不连续时抛错。 */
  append(event) {
    const errors = validateEvent(event);
    if (errors.length > 0) {
      throw new Error(`事件不符合领域契约：${errors.join("；")}`);
    }
    const key = this.#keyOf(event);
    const nextVersion = (this.#lastVersionByKey.get(key) ?? 0) + 1;
    if (event.version !== nextVersion) {
      throw new Error(`聚合 ${key} 的版本应为 ${nextVersion}，实际为 ${event.version}`);
    }
    const stored = Object.freeze({ ...event });
    this.#events.push(stored);
    this.#lastVersionByKey.set(key, event.version);
    return stored;
  }

  #lastVersionByKey = new Map();

  #keyOf(event) {
    return `${event.aggregate_type}/${event.aggregate_id}`;
  }

  /** 读取某聚合的全部事件（按追加顺序）。 */
  eventsOf(aggregateType, aggregateId) {
    return this.#events.filter((e) => e.aggregate_type === aggregateType && e.aggregate_id === aggregateId);
  }

  /** 读取某类聚合的全部事件。 */
  eventsOfType(aggregateType) {
    return this.#events.filter((e) => e.aggregate_type === aggregateType);
  }

  /** 全部事件（按追加顺序，只读副本）。 */
  all() {
    return [...this.#events];
  }
}
