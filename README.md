# 精准营养研发证据链

本仓库保存精准营养研发证据链的领域词汇、事件约定与基础服务代码，便于各参与方在后续开发中统一对象身份和版本语义。

## 目录

- `contracts/domain.schema.json`：领域事件信封及稳定枚举。
- `data/sample.json`、`data/sample-claim-reviewed.json`：可用于联调的中文业务样例。
- `src/`：事件校验与各领域服务模块。
- `tests/`：领域资料与服务规则的一致性检查。

## 分层对象

证据链按以下聚合分层管理，接入记录遵循 `contracts/domain.schema.json` 的事件信封：

| 聚合 | 含义 |
| --- | --- |
| `standard_revision` | 标准草案与正式版本（条款全周期） |
| `formula_version` | 配方版本（冻结、供应商变更、影响评估） |
| `ingredient_batch` | 原料来源与批次 |
| `study_protocol` | 试验方案与样本排除 |
| `study_evidence` | 功效指标、安全事件与研究结论 |
| `scale_up` | 生产放大评估 |
| `product_claim` | 上市主张评审 |
| `consent` | 受试者知情同意与撤回 |
| `coi_disclosure` | 编制单位利益关系披露与回避 |

## 服务模块（src/）

- `validator.js`：事件信封基础校验（必填、枚举、时间格式）。
- `store.js`：追加式事件存储，按聚合强制 version 递增——历史版本不追溯篡改。
- `evidence.js`：证据三级（传统食养 / 实验室 / 人体）**不得互相替代**；研究结论只支持其人群、剂量、观察期内的主张。
- `claims.js`：主张评审，输出缺少哪一级证据（`insufficient_evidence` / `rejected` / `approved`）。
- `impact.js`：配方或原料供应商变化时，计算受影响的安全与功效证据及联动主张。
- `migration.js`：标准更新生成迁移评估，旧版本下的合规结论原样保留。
- `scaleup.js`：判断一次放大是否仍在验证边界内，越界则需再验证。
- `consent.js`：受试者撤回按同意范围停止新用途，撤回前的合法使用不追溯。
- `privacy.js`：监管视图只给出去标识化汇总证据，低人数指标自动抑制。
- `coi.js`：利益关系披露与回避，未回避的表决记为违规。
- `standard.js`：条款从提案、异议、试行到发布的阶段机与理由链复现。

## 本地检查

```bash
npm test
```
