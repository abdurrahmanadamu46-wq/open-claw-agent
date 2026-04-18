# AI 前端补位交接摘要

Date: 2026-04-17

## 结论

AI 前端补位线已经完成本轮核心收口：

- 群协作区三页可联调。
- 主管能力树页可以表达“主管 -> 细化岗位”。
- `tenant-cockpit` 和 `control-panel` 已改成辅助承接页口径。
- `/operations/frontend-gaps` 已可作为 QA / 联调口径清单。
- owned 页面轻量 smoke 已通过。
- 完整生产构建已通过。

## 链路 A 冻结口径

- 链路 A 唯一主入口：`/`
- 链路 A 唯一产品名：租户增长总控台
- `/operations/tenant-cockpit`：只保留为 schema 详情页 / 治理辅助页
- `/operations/control-panel`：只保留为后台资源 CRUD 控制面
- 如果后续有人想把链路 A 入口挂回 `operations`，必须先升级给项目总控，不允许直接改

## AI 前端补位 Ownership

本轮 ownership 收口在以下页面和直接相关局部组件：

- `web/src/app/collab/page.tsx`
- `web/src/app/collab/reports/page.tsx`
- `web/src/app/collab/approvals/page.tsx`
- `web/src/app/lobsters/[id]/capabilities/page.tsx`
- `web/src/components/collab/CollabMetricCard.tsx`
- `web/src/components/collab/CollabRecordCard.tsx`
- `web/src/components/operations/IntegrationHelpCard.tsx`
- `web/src/components/lobster/SupervisorCapabilityTree.tsx`
- `web/src/lib/lobster-capability-tree.ts`

## 已完成页面

### 群协作总览

Path: `/collab`

完成状态：

- 消费统一 `group-collab` contract。
- 展示 summary、recent records、adapter 状态。
- 有加载态、空状态、错误态。
- 有联调责任提示：数据模型找 AI群协作集成工程师，读接口找后端工程师，blocker 找 AI收尾总指挥。

### 群播报记录

Path: `/collab/reports`

完成状态：

- 消费 `objectType=report` records。
- 展示 record、route、receipt、trace。
- 有加载态、空状态、错误态。
- 明确当前是 record-strong / callback-light，真实 thread/readback 仍依赖后端回执接口。

### 待确认项

Path: `/collab/approvals`

完成状态：

- 消费 `summary.pendingItems`。
- 支持表达 approval / confirmation / reminder。
- mock-assisted inbound 回写按钮可用于前端联调。
- 有加载态、空状态、错误态。
- 不再使用 commercial readiness blockers 代替确认队列。

### 单主管能力树

Path example: `/lobsters/strategist/capabilities`

完成状态：

- 能明确表达“主管 -> 细化岗位”。
- 能返回主管详情页。
- 有加载态、空状态、错误态。
- 能显示技能数、知识包数、细化岗位数。
- 如果角色没有能力树配置，会显示可解释的空态/警告态，不会白屏。

### tenant-cockpit 辅助页

Path: `/operations/tenant-cockpit`

完成状态：

- 已改成 schema 详情页 / 治理辅助页口径。
- 不再表达链路 A 主入口。
- 有加载态、错误态。
- 提供返回 `/` 的入口。

### control-panel 辅助页

Path: `/operations/control-panel`

完成状态：

- 已改成后台资源 CRUD 控制面口径。
- 不再表达租户增长总控台语义。
- 有加载态、空状态、错误态。
- 仅保留资源管理语义。

### 前端联调与 QA 清单

Path: `/operations/frontend-gaps`

完成状态：

- 写入链路 A 冻结口径。
- 写入 QA 页面检查清单。
- 写入实时读接口健康度。
- 写入剩余 contract 风险。
- 写入下一轮推进顺序。

## 验证结果

### 轻量页面 smoke

Command:

```powershell
npm run test:e2e:owned
```

Result:

```text
5 passed
```

覆盖页面：

- `/collab`
- `/collab/reports`
- `/collab/approvals`
- `/lobsters/strategist/capabilities`
- `/operations/frontend-gaps`

### 完整生产构建

Command:

```powershell
npm run build
```

Result:

```text
BUILD_EXIT=0
```

备注：

- 构建通过。
- 仍有历史 ESLint warning，主要在 analytics、cost、edge-audit、escalations、skills-improvements、ArtifactRenderer 等非本轮 ownership 页面。
- 这些 warning 不阻塞当前 AI 前端补位交付。

## 当前剩余风险

### 群协作真实通道回执仍需稳定

影响页面：

- `/collab`
- `/collab/reports`
- `/collab/approvals`

风险说明：

- 前端已统一消费 `group-collab` contract。
- 但真实 Feishu / 微信群通道的 read receipt、thread id、ack actor、callback depth 仍需要 AI群协作集成工程师和后端工程师确认。

建议找谁：

- 数据模型：AI群协作集成工程师
- 读接口：后端工程师
- blocker 协调：AI收尾总指挥

### 能力树语义仍部分前端本地维护

影响页面：

- `/lobsters/[id]/capabilities`
- `/lobsters/capability-tree`

风险说明：

- 页面已经能表达“主管 -> 细化岗位”。
- 但 `manages`、`knowledgeSurfaces`、`executionSurfaces`、`collaborationSurfaces`、`governanceSurfaces` 仍主要来自前端语义映射。

建议后续：

- 如果要把能力树变成后端真相源，需要项目总控先拍板范围调整。
- 后端再提供自描述 capability graph contract。

### QA 口径需要继续保持冻结

影响页面：

- `/`
- `/operations/tenant-cockpit`
- `/operations/control-panel`

风险说明：

- 链路 A 只认 `/`。
- `tenant-cockpit` 和 `control-panel` 不能再被 QA 或演示脚本误写成链路 A 入口。

建议找谁：

- 页面挂载和视觉结构：前端工程师
- QA 脚本起点：QA
- 口径争议：AI收尾总指挥，必要时项目总控

## 下一轮建议

1. QA 按 `/operations/frontend-gaps` 的页面清单跑一轮人工验收。
2. AI群协作集成工程师确认 `pendingItems`、`receipt`、`history`、`route` 字段是否稳定。
3. 后端工程师确认 `group-collab` 读接口和 mock 代理在 QA 环境可用。
4. 如果还要继续推进能力树真相源，下轮先找项目总控确认是否允许把 capability tree contract 下沉到后端。
