/**
 * 监管视图：去标识化证据。
 *
 * 监管查看的是汇总后的去标识化证据，而非个人明细。
 * 直接标识符一律剥离；分组人数低于 k 阈值的指标被抑制，防止间接再识别。
 */

const DIRECT_IDENTIFIERS = ["subject_id", "subject_refs", "name", "id_number", "phone", "address"];

export const DEFAULT_K = 3;

/**
 * 将一条证据记录转换为监管视图。
 * @param evidence 证据记录（含 subject_refs 等内部字段）
 * @param groupSizes 各指标对应的分组人数：{ 指标名: n }
 * @param k 最小分组人数，默认 3
 */
export function regulatorView(evidence, groupSizes = {}, k = DEFAULT_K) {
  const view = {};
  for (const [key, value] of Object.entries(evidence)) {
    if (!DIRECT_IDENTIFIERS.includes(key)) view[key] = value;
  }
  view.indicators = (evidence.indicators ?? []).map((ind) => {
    const n = groupSizes[ind.name] ?? 0;
    if (n < k) return { name: ind.name, suppressed: true, reason: `分组人数 ${n} 低于阈值 ${k}` };
    return { name: ind.name, value: ind.value, n };
  });
  view.deidentified = true;
  return view;
}

/** 校验一份记录是否已无可识别字段（供对外输出前自检）。 */
export function assertDeidentified(record) {
  const leaked = DIRECT_IDENTIFIERS.filter((f) => f in record);
  if (leaked.length > 0) throw new Error(`记录仍含可识别字段：${leaked.join("、")}`);
  return true;
}
