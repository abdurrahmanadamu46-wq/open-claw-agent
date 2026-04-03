# Repo Total Inventory

Last Updated: 2026-03-30
Scope: full repository scan + current state docs + active code paths

## 方法说明

- **已确认事实**：直接来自仓库目录、`package.json`、`README`、`PROJECT_STATE.md`、`docs/handover/01-REPO-MAP.md`、已通过的测试/构建记录。
- **合理推测**：基于目录结构、命名、模块边界和当前接线方式作出的工程判断。
- **待确认信息**：仓库内证据不足，或外部子项目本体并不在当前主仓中。

## 项目总表

| 项目 | 目录 | 类型 | 当前定位 | 状态判断 | 信息等级 |
|---|---|---|---|---|---|
| Unified Control Plane Web | `web/` | 主线项目 | 商家/运营控制台 | 接近交付 | 已确认事实 |
| Unified Control Plane Backend | `backend/` | 主线项目 | 统一 API 网关 / 鉴权 / 多租户 / 代理层 | 接近交付 | 已确认事实 |
| Dragon Senate SaaS v2 | `dragon-senate-saas-v2/` | 主线项目 | AI 子服务 / 9 龙虾 / Senate Kernel / Billing 子能力 | 接近交付但仍有外部切真阻塞 | 已确认事实 |
| Edge Runtime | `edge-runtime/` | 主线项目 | 边缘执行器（无脑执行） | 执行中 / 部分完成 | 已确认事实 |
| Desktop Client | `apps/desktop-client/` | 主线项目 | 客户执行端 / 更新链 / 桌面入口 | 执行中 / 部分完成 | 已确认事实 |
| Root Ops & Delivery Scripts | `scripts/`, root `package.json` | 主线配套 | 启停、备份、合规、迁移、回归 | 接近交付 | 已确认事实 |
| Aoto Cut Integration Layer | `backend/src/subprojects/` + `docs/AOTO_CUT_INTEGRATION_PREP_2026-03-29.md` | 子项目对接层 | 仅做 contract / handoff package，不做内容生产内部实现 | 对接准备完成 | 已确认事实 |
| Commander / TG Integration Layer | `dragon-senate-saas-v2/app.py` + `backend/src/ai-subservice/*` + `docs/COMMANDER_TG_INTEGRATION_PREP_2026-03-30.md` | 子项目对接层 | 仅做 async submit/status 契约，不做编排层内部实现 | 对接准备完成 | 已确认事实 |
| Legacy Dragon Senate SaaS | `dragon-senate-saas/` | 历史项目 | 旧版 AI 服务 | 历史残留 | 已确认事实 |
| Liaoyuan OS | `liayouan_os/` | 历史/实验项目 | 早期云边行为内核 | 历史/实验 | 已确认事实 |
| SuperHarbor | `superharbor/` | 历史/实验项目 | 早期前端 MVP | 历史/实验 | 已确认事实 |
| textsrc / textdesign / textinfra | `textsrc/`, `textdesign/`, `textinfra/` | 历史/实验项目 | 早期内容/雷达/实验源代码 | 历史/实验 | 已确认事实 |
| openclaw_ref_20260323 | `openclaw_ref_20260323/` | 参考项目 | 外部参考快照 | 参考/只读 | 已确认事实 |
| services/* family | `services/` | 微服务候选 | CTI / policy / trust / scorer 等 | 未来拆分方向 | 合理推测 |
| packages/* family | `packages/` | 基础设施候选 | contracts / observability | 未来拆分方向 | 合理推测 |
| 外部模板推荐/CLI Seeder 子项目 | 不在主仓 | 外部子项目 | 模板推荐规则层 / seeder 对齐 | 执行中，但不在本仓 | 待确认信息 |

## 进度状态

### 1. 主线生产项目

#### 1.1 Web
- **已确认事实**
  - `next build` 持续通过。
  - 公共站点、设置页、商业化就绪页、移动审批页、客户端设计中心均已接真或已改成真实入口。
  - 当前生产构建 warning 已清零。
- **状态**
  - 接近交付

#### 1.2 Backend
- **已确认事实**
  - NestJS build 持续通过。
  - 已具备：auth proxy、tenant registry、HITL proxy、Commander async proxy、Aoto Cut contract module。
  - 已有多条 node-based regression tests。
- **状态**
  - 接近交付

#### 1.3 Dragon Senate SaaS v2
- **已确认事实**
  - 已落地：CampaignGraph ToolTree-lite、Role Memory、Kernel metrics、risk taxonomy、starter kit、mobile approval loop、billing skeleton、industry KB。
  - 有大量 in-process Python regression 脚本。
- **状态**
  - 接近交付，但生产切真仍卡外部资源

#### 1.4 Edge Runtime
- **已确认事实**
  - 仓库地图明确它是主干项目之一。
  - 当前定位清晰：只执行，不拥有策略脑。
- **合理推测**
  - 还没有像 Web/Backend/AI 子服务那样拥有同等密度的收口证据。
- **状态**
  - 执行中 / 部分完成

#### 1.5 Desktop Client
- **已确认事实**
  - 有独立 `package.json`、Tauri/Vite 构建链、更新链。
  - 已有真实 client-center / client-mobile 联动页与更新链设计。
- **状态**
  - 执行中 / 部分完成

### 2. 子项目对接层

#### 2.1 Aoto Cut
- **已确认事实**
  - 主仓仅保 contract / handoff package 接口。
  - 未重复建设内容生产页面与内部模型。
- **状态**
  - 对接准备完成

#### 2.2 Commander / TG
- **已确认事实**
  - 主仓已提供 async submit/status 主通道。
  - 策略中心已接 async commander submit/status UI。
- **状态**
  - 对接准备完成

### 3. 历史/实验/参考

#### 3.1 Legacy Dragon Senate SaaS / Liaoyuan OS / SuperHarbor / textsrc family / openclaw_ref
- **已确认事实**
  - Repo map 明确这几类默认不作为真相源。
- **状态**
  - 历史/实验/参考，不应作为当前主线开发依据

### 4. 哪些只是想法，哪些已经进入执行，哪些接近交付

#### 只是想法 / 尚未形成完整执行面
- `services/*` 的服务化方向
- `packages/*` 的基础设施化方向
- `P2 Visual-ERM upgrade`
- `P2 Replay dataset / trajectory evaluator`
- 更深的自动化处置策略
- 真实 Feishu/DingTalk rich card

#### 已进入执行
- `edge-runtime`
- `apps/desktop-client`
- `P1` 路线图项：
  - ToolTree-lite
  - Role-aligned memory
  - Autonomy metrics
  - TrinityGuard risk taxonomy
  - Synthetic industry starter tasks
  - Mobile approval loop

#### 接近交付
- `web`
- `backend`
- `dragon-senate-saas-v2` 本地可完成部分
- Root ops / scripts / compliance / migration layer
- Aoto Cut integration prep
- Commander/TG integration prep

## 可拆分子项目

以下是适合继续拆分成独立子项目、以减少主项目压力和在线算力消耗的方向。

| 子项目 | 当前状态 | 拆分价值 | 是否适合独立 | 是否适合不同 AI 并行处理 | 信息等级 |
|---|---|---|---|---|---|
| Research Radar Batch | 已执行 | 高 | 是 | 高 | 已确认事实 |
| Industry Compiler | 已执行 | 高 | 是 | 高 | 已确认事实 |
| Memory Compiler | 已执行 | 高 | 是 | 高 | 已确认事实 |
| Governance Analytics | 已执行 | 高 | 是 | 高 | 已确认事实 |
| Telephony / Followup Voice | 未切真 | 极高 | 是 | 中高 | 合理推测 |
| Integration Adapter Hub | 部分已在主仓 | 高 | 是 | 高 | 合理推测 |
| Desktop Delivery Chain | 部分已在主仓 | 中高 | 可以 | 中 | 合理推测 |
| Aoto Cut | 已是外部子域 | 已拆 | 是 | 是 | 已确认事实 |
| Commander / TG | 已是外部子域 | 已拆 | 是 | 是 | 已确认事实 |
| Template Recommender / CLI Seeder | 外部执行中 | 高 | 是 | 是 | 待确认信息 |

### 不建议拆的核心
- Auth / Tenant / RBAC
- Billing / Subscription / Order / Compensation
- Senate Kernel 主决策层
- Async command ingress 契约
- Audit / Trace / Rollback 主证据链

## 风险阻塞

### 已确认事实
1. 真正阻塞完整商业化的是外部资源切真：
   - 支付
   - Feishu 公网回调
   - 真实 SMTP/SMS
   - ICP 线下主体与域名
   - Telephony canary
2. 历史/实验目录很多，极易误判为主线。
3. 顶层测试数据库、构建产物、缓存目录很多，容易误判成熟度。

### 合理推测
1. `services/*` 很可能是未来微服务化方向，但当前不应视作活跃生产项目。
2. `packages/contracts` 与 `packages/observability` 更像基础设施候选，不是已成型独立项目。

### 待确认信息
1. 外部子项目本体是否与当前主仓契约完全对齐。
2. `services/*` 是否已有其他线程在并行独立推进。
3. `edge-runtime` 与 `desktop-client` 的真实生产使用深度。

## 建议执行顺序

### 当前最值得优先推进的 3 件事
1. **支付 + Feishu/SMS/ICP 的切真准备包收口**
   - 原因：这是“完整商业化状态”的硬门槛
   - 信息等级：已确认事实

2. **把 async main path 扩展成所有长任务入口的默认主通道**
   - 原因：Commander/TG 已明确不应再依赖同步 `/run-dragon-team`
   - 信息等级：已确认事实 + 合理推测

3. **Telephony provider canary + CRM/线索回流闭环**
   - 原因：这是从“可控 AI 系统”迈向“真正增长操作系统”的关键缺口
   - 信息等级：合理推测

### 如果按工程 ROI 排序
1. Governance Analytics 独立化
2. Industry Compiler 强化
3. Telephony / Followup Voice 独立化

## 交接摘要

### 1. 当前真相源
- `PROJECT_STATE.md`
- `BACKLOG.md`
- `docs/handover/01-REPO-MAP.md`
- `docs/handover/03-OPEN-ITEMS.md`

### 2. 当前生产主干只认四块
- `web/`
- `backend/`
- `dragon-senate-saas-v2/`
- `edge-runtime/`

### 3. 子项目边界原则
- Aoto Cut：只做 contract / handoff package，不重做内容生产内部实现
- Commander / TG：只做 async 服务契约，不重做编排层
- 模板推荐 / CLI Seeder：只做对接准备，不重复实现规则层

### 4. 最容易误判的地方
- 把历史目录当主线
- 把测试 SQLite / `.next` / `dist` 当真实交付资产
- 把“本地已可运行”误判为“生产已切真”
- 把外部子项目汇报误判为主仓已落地事实

### 5. 一句话总结
当前仓库已经形成：

`主线商业化系统 + 若干已明确边界的外部子项目 + 一批适合进一步服务化拆分的高算力子系统`

下一步应继续沿主线做切真与基础契约，不重复外部子项目实现，不把在线决策层重新做回超级单体。
