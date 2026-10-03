# 精准营养研发证据链

面向团体标准编制与产品研发的证据链服务骨架：把**标准草案/正式版本、原料来源与批次、适用人群假设、配方版本、试验方案、样本排除、功效指标、安全事件、生产放大、上市主张**分层管理，以只追加事件作为统一交换格式（遵循 `contracts/domain.schema.json`）。

## 要解决的问题

- 科研院所用人群试验讨论功效，企业用原料检测和小样稳定性证明可生产，市场部却把阶段结果写成"适合所有人"的宣称——**研究结论只能支持其人群、剂量、观察期内的主张**。
- 传统食养资料、实验室结果、人体证据**三级不得互相替代**。
- 草案条款每次调整后，"旧配方现在是否还合规"要能秒级回答。
- 原料/供应商变化要自动算出受影响的安全与功效证据；标准更新生成迁移评估，**不追溯篡改当时合法的版本**。
- 编制单位有利益关系必须披露并回避；受试者撤回只按同意范围停止新用途；监管看到的是**去标识化证据**而非个人明细。
- 标准委员会能复现条款从提案、异议、试行到发布的理由。

## 目录

| 路径 | 说明 |
| --- | --- |
| `contracts/domain.schema.json` | 领域事件契约：信封 + 31 类事件的 payload 约束（if/then）、16 类聚合、证据分级与主张类型枚举 |
| `src/validator.js` | 事件信封/事件-聚合映射/必填字段/语义约束（普适宣称禁止、身份字段禁止、证据越级禁止、放大边界等），链式哈希 |
| `src/store.js` | 只追加事件存储：聚合版本连续递增、event_id 去重、哈希锚点、`dumpChain`/`loadChain` 防篡改持久化 |
| `src/projections.js` | 事件流 → 当前状态投影（证据失效/同意撤回/暂停均为投影状态，历史事件不动） |
| `src/policies.js` | 纯函数策略：主张核查、证据分级、影响分析、迁移评估、放大边界、回避、同意范围、理由链、监管去标识化视图 |
| `src/service.js` | 应用服务：用例编排（供应商变更联动影响评估与主张暂停、发布联动迁移评估、审查落事件、监管查看落审计） |
| `src/scenario.js` | 完整业务场景（58 个事件，覆盖 2026-09 至 2027-07 全流程） |
| `src/demo.js` | 场景演示输出 |
| `data/sample.json` | 单事件联调样例 |
| `tests/` | 29 个测试：契约一致性、证据分级、影响分析、迁移不追溯、回避、撤回、去标识化、理由复现、防篡改、端到端场景 |

## 分层与证据边界

证据分级（低 → 高）：

```
traditional 传统食养资料
in_vitro_lab 实验室（体外）
animal 动物实验
post_market_surveillance 上市后监测
human_exploratory 探索性人体试验
human_pivotal 关键性人体试验
systematic_review 系统综述
```

主张所需最低等级（`src/policies.js` 中 `MIN_TIER_FOR_CLAIM`）：

| 主张类型 | 最低证据 |
| --- | --- |
| `traditional_nourishment` 传统食养表述 | 传统食养资料 |
| `nutrient_content` 营养成分含量 | 实验室检测 |
| `structure_function` 结构/功能 | 探索性人体试验 |
| `risk_reduction` 疾病风险降低 | 关键性人体试验 |
| `universal_health` 适合所有人 | **永远禁止** |
| `mechanistic_support` | 仅机制支持，不得单独支撑上市主张 |

人体主张还必须同时满足：证据绑定同一人群假设、同一配方版本及其全部原料来源、主张剂量落在研究剂量区间、主张周期不超过观察期、至少一个终点同时统计学显著且临床有意义、商业批量落在放大验证边界内、无未决严重安全事件。

## 关键规则实现

- **变更影响**：`INGREDIENT_SOURCE_CHANGED` 按等效性声明（`identical_spec` 监测 / `equivalent_tested` 待再验证 / `unverified` 证据失效）联动 `IMPACT_ASSESSED`，已批准主张自动 `CLAIM_SUSPENDED`；新配方版本只触发剂量/人群桥接核查，不自动继承旧证据。
- **标准迁移**：`STANDARD_PUBLISHED` 联动 `MIGRATION_ASSESSED`，按冻结时刻版本处于 `published/trial/draft` 判定 `compliant_at_time`——当时合法即合法，输出 `still_compliant / grandfathered_with_deadline / non_compliant_new_production`；历史事件永不改写，迁移后证据失效会丧失祖父资格。
- **利益冲突**：`COI_DECLARED` 后若该单位出现在审查方且无 `RECUSAL_ENFORCED`，审查硬拒。
- **同意与撤回**：受试者只有研究编码与分用途同意范围；`SUBJECT_CONSENT_WITHDRAWN` 后仅停止被撤回用途的新使用，既存数据按 `retain_until` 留存。
- **排除**：`SUBJECT_EXCLUDED` 只能引用方案预先登记的规则。
- **监管视图**：`regulatorView` 只输出样本量/排除数/撤回数等汇总，`subject_level_records_released=0`，每次查看落 `EVIDENCE_VIEWED` 审计事件。
- **可复现**：条款理由链（提案→异议→修订）、标准全生命周期（draft→trial→published→superseded）均可从事件流重建；一次编制流程的事件共享 `correlation_id`，因果关系用 `causation_id`。
- **防篡改**：每事件含前一事件哈希，篡改、删除、重排在 `verifyIntegrity()` 或重新 `loadChain` 时暴露。

## 本地使用

```bash
npm test     # 29 项测试
npm run demo # 打印完整场景的审查、影响、迁移、理由链、监管视图
```

场景中的典型结果：

- 限定 IFG 人群、2.0g、84 天的主张 → approved；"适合所有人" → rejected；传统食养+体外实验宣称降糖尿病风险 → needs_evidence；4g/180 天超界主张 → needs_evidence。
- 供应商未验证切换后 `ev-rct1` 失效、`claim-a-ifg` 暂停；桥接 RCT 产生 `ev-bridge` 后 `claim-a2-ifg` 恢复。
- 旧规格 F-v0.9 迁移状态为祖父过渡（2028-07-14 前转版）；F-v1 证据失效禁止新生产但历史记录不改写；F-v2 草案期冻结不算合规，正式版生效后重新冻结才合规。

## 扩展约定

新增事件类型时需要三处同步（`tests/contract.test.js` 会防漂移）：

1. `contracts/domain.schema.json` 的 `$defs.eventType` 枚举与对应 `if/then` payload 分支；
2. `src/validator.js` 的 `eventAggregateMap` 与 `requiredPayload`；
3. 投影 `src/projections.js` 与策略 `src/policies.js`。
