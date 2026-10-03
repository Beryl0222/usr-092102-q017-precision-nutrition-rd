/**
 * 生产放大边界评估：判断一次放大是否仍在既有验证边界之内。
 *
 * 验证边界来自中试/小试确认的参数包络（批量、温度、时间、水分等）。
 * 放大记录逐项比对：全部落在包络内 → within_boundary；
 * 任一参数越界 → outside_boundary，需补充验证后方可继续。
 */

/**
 * @param boundary 验证边界：{ batch_size: {min, max}, params: { 温度: {min, max}, ... } }
 * @param actual 实际放大记录：{ batch_size, params: {...} }
 */
export function evaluateScaleUp(boundary, actual) {
  const deviations = [];

  if (actual.batch_size < boundary.batch_size.min || actual.batch_size > boundary.batch_size.max) {
    deviations.push({
      parameter: "batch_size",
      actual: actual.batch_size,
      boundary: boundary.batch_size,
    });
  }

  for (const [name, range] of Object.entries(boundary.params ?? {})) {
    const value = actual.params?.[name];
    if (value === undefined) {
      deviations.push({ parameter: name, actual: null, boundary: range, note: "未记录该参数" });
    } else if (value < range.min || value > range.max) {
      deviations.push({ parameter: name, actual: value, boundary: range });
    }
  }

  return {
    within_boundary: deviations.length === 0,
    deviations,
    requires_revalidation: deviations.length > 0,
  };
}

/** 生成 SCALE_UP_EVALUATED 事件负载。 */
export function toScaleUpEvaluatedEvent(result, { event_id, aggregate_id, version, occurred_at }) {
  return {
    event_id,
    event_type: "SCALE_UP_EVALUATED",
    aggregate_type: "scale_up",
    aggregate_id,
    occurred_at,
    version,
    summary: result.within_boundary ? "放大在验证边界内" : `放大越界 ${result.deviations.length} 项，需再验证`,
    result,
  };
}
