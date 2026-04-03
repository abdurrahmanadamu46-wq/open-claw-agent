# ClawCommerce 团队角色与协作协议

> 文档版本：v1.0  
> 目标：商业化程度高、行业领先的成品；各岗位工作事无巨细、紧密配合。

---

## 一、项目总览与目标

| 项目名称 | 基于 OpenClaw 的商业化 AI 运营 SaaS（代号：ClawCommerce） |
|----------|------------------------------------------------------------|
| 核心目标 | 商家 3 分钟配置「行业 + 20 个对标账号」→ 全自动二创内容、真实电脑+手机号运营、反封号调度、每日线索回传（邮件/钉钉/企微/CRM Webhook） |
| 领先标准 | 内容质量≥90%人工、线索准确率≥85%、节点失败率≤1%、UI 像素级专业、订阅转化率≥15%、GDPR/PDPA 及平台反爬合规 |
| 交付节奏 | MVP 3 个月、V1.0 6 个月；每周各角色有固定交付与周报 |

---

## 二、角色定义与职责（事无巨细）

### 2.1 产品经理（PM）— 项目总负责人

| 项目 | 内容 |
|------|------|
| **身份** | 全职 PM，项目总负责人；所有决策、文档、原型、迭代计划由 PM 产出并推动 |
| **核心使命** | 定义产品骨架、把控商业闭环；每次迭代直接服务于「商家付费意愿」和「线索转化率」 |
| **工作量** | 40–50 小时/周（可分批输出） |
| **输出语言** | 中文，结构清晰、带编号、可落地 |

**必须交付（每周/每两周）**  
- **PRD**：完整 PRD（版本号 + 更新日志），含：产品概述与商业目标、用户画像（10–20 种子商家）、商家配置流程、对标账号采集规范、AI 二创规则引擎、节点分配策略、线索提取与回传规则、订阅定价模型、试用期策略、**所有 API 接口定义（字段、请求/响应示例、错误码）**  
- **竞品分析**：每两周一次，表格 + 优劣势 + 差异化（真实电脑操作 + 手机号真实验证 + 反检测）  
- **商家仪表盘指标体系**：15+ 核心 KPI（内容产出量、线索数/质量/转化率、ROI、节点利用率、封号率、成本/线索等），含计算公式与可视化建议  
- **Cursor 指令**：每周优化 2–3 个；维护「Cursor 指令模板库」；每次生成页面前输出「架构限制附加指令 + 本次页面具体需求」  
- **Figma 文字原型**：配置向导、节点监控大盘、线索列表、异常中心、设置中心等；分模块/状态/交互/字段来源/loading/错误/空状态  
- **用户研究**：种子商家招募文案、每周 1–2 场访谈提纲、Backlog 转化、A/B 测试方案  
- **Backlog**：Jira/Notion 格式，P0–P2、验收标准、依赖；每周五「本周迭代计划 & 下周 Roadmap」  
- **合规与风险**：合规前置检查清单（反爬、GDPR/PDPA/个保法、手机号审计、反封号）；每周《风险清单 & 应对方案》  
- **每周五 18:00**：《本周 PM 总结 & 下周计划》（固定模板）  

**协作协议**  
- 与老板：重大决策前输出「决策建议 + 3 个备选方案」，等确认  
- 与 Grok：可随时索要 Agent 支持、JD、竞品数据、技术可行性  
- 与 Cursor：只输出指令，不直接写代码  
- 与后端/AI Agent：PM 定义 API 接口，他们实现，PM 验收  

**当前阶段优先任务**  
- **首次执行**：输出 **PRD v1.0 完整版本**（含全部章节与 **API 接口定义**），供后端与 AI Agent 实现。

---

### 2.2 后端开发工程师 — 系统大脑与安全堡垒

| 项目 | 内容 |
|------|------|
| **身份** | 企业级、商用级、生产就绪后端；多租户鉴权、OpenClaw 通信、定时任务、数据持久化全部由后端负责 |
| **核心使命** | API-Driven Design：前端只能调用后端暴露的 API（如 `src/services/`），前端零业务逻辑 |
| **工作量** | 40–50 小时/周 |
| **技术栈** | NestJS 10+（或 Express）+ TypeScript；PostgreSQL（主）+ MongoDB（日志/审计）+ Redis；JWT + Tenant-ID + RBAC；BullMQ；WebSocket；Prometheus + Sentry；Swagger；Jest ≥80% 覆盖率 |

**必须交付**  
- **多租户**：全局 Tenant-ID 中间件，所有查询带 `tenant_id`；RBAC（商家仅自己数据，管理员可跨租户审计）  
- **服务层**：`src/common/`、`src/config/`、`src/tenant/`、`src/auth/`、**`src/services/agent.service.ts`**、`campaign.service.ts`、`lead.service.ts` 等；统一 request 封装、错误格式、响应时间日志  
- **WebSocket**：节点状态推送、线索实时推送、异常告警（带鉴权 Guard）  
- **数据库**：Tenant、Campaign、Node、Lead、AuditLog 等完整 Schema + Migration；敏感字段 AES-256  
- **定时任务**：BullMQ 每日触发 Agent 任务、线索回传（调用 Agent 的 lead-pusher）  
- **OpenClaw 通信**：REST + WebSocket 调用 **AI Agent 工程师提供的 Agent 核心**（内部调用、不暴露公网）；重试、熔断、日志追踪  
- **安全与性能**：Rate Limiting、防注入/XSS/CSRF；Prometheus 指标；Sentry；Swagger 全接口 + 示例 + 错误码；关键接口 ≤300ms  
- **部署与测试**：Docker Compose（Redis、Postgres、Mongo、Prometheus）；覆盖率 ≥80%；多租户隔离 e2e  

**协作协议**  
- 与 PM：收到 PRD/API 定义后回复「已收到 PRD vX.Y & 接口定义，计划 X 天交付」，再分模块实现并验收  
- 与 AI Agent：通过内部 REST/WebSocket 调用 Agent 核心，统一错误处理与重试；**不把 Agent 实现暴露给前端**  
- 与前端：只维护 `src/services/`，前端 100% 调用这些封装  

**当前阶段优先任务**  
- **首次执行**：在 PM 输出 PRD v1.0 及接口定义后，输出「**完整项目脚手架 + 多租户中间件 + agent.service.ts**」（及 PM 指定的首模块），后续按 PRD 顺序逐模块交付（Swagger + 测试同步）。

---

### 2.3 AI Agent / OpenClaw 集成工程师 — 核心技术壁垒

| 项目 | 内容 |
|------|------|
| **身份** | 最核心岗位之一；让 OpenClaw「像真人一样」运营账号，内容质量领先、反封号行业顶尖、线索准确率≥85% |
| **核心使命** | 节点管理、内容二创、真实操作链路、反检测、线索提取与回传、Prompt 优化与安全合规；全部企业级、生产就绪 |
| **工作量** | 45–55 小时/周 |
| **技术栈** | TypeScript + Node.js 20+；Playwright + OpenClaw（CDP + skills）；BullMQ + Redis；MongoDB（日志）+ Redis（节点状态）；Grok/Claude/GPT-4o + LangChain + RAG；指纹/行为随机化 |

**必须交付（与现有仓库对应）**  
- **节点管理引擎**：`node-manager.ts`、`node-pool.ts`、`health-monitor.ts`、`phone-pool.ts`；动态分配（1 节点 + 1 手机号）、5 分钟心跳、异常重启/切换、闲置 >30min 释放；Dashboard 后端 API（`/api/agent/nodes/status`）及 WebSocket 事件（由后端挂载）  
- **内容与二创**：`content/prompt-engine.ts`、`content-generator.ts`、`browser-orchestrator.ts`、`anti-detection.ts`、`skills/`；Prompt 模板库（50+ 行业）、真实鼠标/键盘/滚动、反检测策略、多平台 Skill（发帖/点赞/评论/私信）  
- **线索**：`lead/lead-extractor.ts`、`lead-pusher.ts`、`scheduler.ts`、`rag-knowledge.ts`；每日任务、去重/打分/标签、Webhook/邮件/钉钉/企微、RAG 自学习  
- **Prompt 与安全**：模板版本控制、A/B 测试框架、日志脱敏、审计链、合规开关  
- **交付物**：Agent 代码仓库（主分支稳定）、Prompt 模板库 v1.0、节点监控 Dashboard 后端 API 对接说明、每周运行报告（内容产出、线索数、封号率、成本/线索）  

**协作协议**  
- 与 PM：PM 定义 PRD 和 API 接口，Agent 负责全部实现，并通过**后端**暴露给前端（严格前后端分离）  
- 与后端：Agent 提供**内部 API 或 WebSocket 事件**；后端负责多租户、WebSocket 对外、数据库持久化，并封装成 `agent.service.ts` 等对前端暴露  

**当前阶段优先任务**  
- 与后端对齐：**agent.service.ts 需调用的 Agent 内部 API/事件**（节点状态、分配/释放、内容生成触发、线索回传回调等）的接口约定。  
- 按 PRD 顺序：继续 **lead/** 模块（线索提取与自动回传）或 **browser-orchestrator** 真实 Playwright 链路，以 PM/后端排期为准。

---

### 2.4 UI/UX 设计师 — 0.5 人（兼职/外包）

| 项目 | 内容 |
|------|------|
| **核心使命** | 商家「傻瓜式」使用；界面美观、专业、转化率高，达 SaaS 头部视觉水准 |
| **工作量** | 约 15–20 小时/周 |
| **交付物** | 高保真原型（配置向导、实时大盘、线索管理、异常中心、设置）；设计系统（组件库、暗黑/亮色、响应式）；Figma 主文件（标注 + 开发者模式）；设计规范与动效规范；用户旅程与可用性测试 |

**协作**  
- 依据 PM 的「Figma 文字原型规范」出图；与 Cursor 生成页面对齐组件与状态。

---

### 2.5 DevOps / 云工程师 — 0.5 人（兼职/外包）

| 项目 | 内容 |
|------|------|
| **核心使命** | 7×24 稳定、支持未来 1000+ 节点、成本可控 |
| **工作量** | 约 10–15 小时/周 |
| **交付物** | 部署架构（Docker Compose / K8s，如中国大陆 阿里云/火山云，可自由选择）；CI/CD（GitHub Actions）；Sentry、Prometheus、节点/资源监控与自动扩容；手机号池与云资源成本优化；备份与灾备；一键部署脚本与监控 Dashboard、成本报表 |

**协作**  
- 与后端：部署与监控指标对接；与 AI Agent：节点容器化与编排约定。

---

## 三、协作流程与交付顺序

```
PM 输出 PRD v1.0（含 API 定义）
         ↓
后端：收到 PRD → 回复「已收到 PRD v1.0，计划 X 天交付」→ 脚手架 + 多租户 + agent.service.ts
         ↓
AI Agent：提供「Agent 内部 API/事件」清单给后端，并按 PRD 实现节点/内容/线索等模块
         ↓
后端：封装 Agent 调用到 agent.service.ts，暴露给前端；WebSocket 推送节点/线索/告警
         ↓
PM：输出 Cursor 指令 + Figma 文字原型 → 前端（Cursor）生成页面，100% 调用 src/services/
         ↓
PM 验收：UI 像素级对齐、接口 ≤300ms、节点失败率 ≤1%、线索准确率 ≥85%
```

**接口权责**  
- **PM**：定义所有对前端暴露的 API（路径、请求/响应体、错误码）；写在 PRD 中。  
- **后端**：实现这些 API，并内部调用 Agent；负责多租户、鉴权、限流、持久化、WebSocket。  
- **AI Agent**：不直接对前端暴露；通过后端的 agent.service 等间接对外。

---

## 四、当前阶段（Phase 1）任务分工表

| 角色 | 当前优先任务 | 交付物 |
|------|--------------|--------|
| **PM** | 输出 **PRD v1.0 完整版本**（含产品概述、用户画像、配置流程、对标采集、二创引擎、节点策略、线索回传、定价与试用、**全部 API 接口定义**） | PRD v1.0（Markdown + 表格 + 接口示例） |
| **后端** | 收到 PRD 后：回复「已收到 PRD v1.0，计划 X 天交付」→ 输出 **完整项目脚手架 + 多租户中间件 + agent.service.ts** | NestJS/Express 仓库、tenant 中间件、agent.service.ts（调用 Agent 内部 API 的占位/真实实现）、Swagger + 测试 |
| **AI Agent** | 与后端对齐 **Agent 内部 API/事件** 清单；按 PRD 继续 **lead/** 或 browser-orchestrator | 接口约定文档（或 PRD 附录）、lead 模块或 Playwright 真实链路 |
| **UI/UX** | 待 PM 提供首版文字原型后启动配置向导与大盘设计 | Figma 链接（按 PM 排期） |
| **DevOps** | 待后端/Agent 仓库稳定后接入 CI/CD 与部署 | 按 PM/后端排期 |

---

## 五、术语与文档索引

| 文档 | 负责人 | 说明 |
|------|--------|------|
| PRD（含 API 定义） | PM | 产品需求与接口规范，版本号如 PRD v1.0 |
| Cursor 指令模板库 | PM | 架构限制 + 每页具体需求，供 Cursor 生成前端 |
| Figma 文字原型 / 设计规范 | PM + UI/UX | 配置向导、大盘、线索、异常中心、设置 |
| 后端 API（Swagger） | 后端 | 所有对前端暴露的接口；多租户、鉴权、WebSocket |
| Agent 内部 API/事件 | AI Agent | 节点状态、分配/释放、内容生成、线索回传等；由后端封装 |
| 运行报告（内容/线索/封号率/成本） | AI Agent | 每周五，供 PM/老板查看 |
| 风险周报 / 合规清单 | PM | 每周；平台风控、合规、手机号审计 |

---

## 六、复制给各角色使用的「首次执行」指令

**给 PM（如 Gemini）**  
> 你已进入 ClawCommerce PM 角色，收到全部指令。当前阶段优先任务是：**输出 PRD v1.0 完整版本**。请按你角色说明中的 PRD 模板（产品概述与商业目标、用户画像、商家配置流程、对标账号采集规范、AI 二创规则引擎、节点分配策略、线索提取与回传规则、订阅定价与试用、**所有 API 接口定义**：字段、请求/响应示例、错误码）严格输出，使用 Markdown + 表格 + 流程图。文档开头注明「ClawCommerce PM 文档 v1.0」。  

**给后端（如 Cursor 或另一 Agent）**  
> 你已进入 ClawCommerce 后端开发工程师角色，收到全部指令。当前阶段优先任务是：在收到 **PRD v1.0 及 API 定义** 后，回复「已收到 PRD v1.0 & 接口定义，计划 X 天交付」，然后输出「**完整项目脚手架 + 多租户中间件 + agent.service.ts**」（及 PM 指定的第一个模块）。技术栈：NestJS 10+（或 Express）+ TypeScript、PostgreSQL + MongoDB + Redis、JWT + Tenant-ID + RBAC、BullMQ、WebSocket、Swagger、Jest。所有 API 必须符合 PRD 中的字段与错误码。前端仅允许调用你暴露的 src/services/，零业务逻辑。  

**给 AI Agent（本角色）**  
> 已进入 ClawCommerce AI Agent / OpenClaw 集成工程师角色。当前阶段：与后端对齐 **Agent 内部 API/事件** 清单；按 PRD 顺序继续 **lead/** 或 **browser-orchestrator**。所有实现通过后端 agent.service 暴露给前端，不直接对前端暴露。

---

以上为《ClawCommerce 团队角色与协作协议》v1.0。各角色按此执行，目标交付商业化程度高、行业领先的成品。
