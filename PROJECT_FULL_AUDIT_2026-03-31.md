# 🔍 项目全盘审计 — 2026-03-31

> 信息分类标注：✅ 已确认事实 | 🟡 合理推测 | ❓ 待确认信息

---

## 一、项目总盘点（按业务方向归类）

### A. 核心产品 — AI增长操作系统（龙虾元老院）

#### A1. Python AI Runtime（dragon-senate-saas-v2）
- **目标**: 9只龙虾的运行时执行引擎，LangGraph 流水线
- **价值**: 这是产品的"大脑"——接收任务、编排9虾执行、产出工件
- **当前状态**: ✅ 可执行，完整DAG图已构建
- **最近动作**: 9虾独立模块已提取到 `lobsters/` 目录（2026-03-31）
- **下一步**: Commander 智能路由（从固定DAG → 动态组装）

#### A2. TS Design-Time 定义体系（packages/lobsters + src/agent/commander）
- **目标**: 9虾的设计时身份定义 + Commander 工作流编目 + 行业编译器
- **价值**: 前端展示、Commander 决策、行业适配的"设计稿"
- **当前状态**: ✅ 18个标准workflow、11步行业蓝图、前端preview投影均已完成
- **最近动作**: 导出链修复、HTTP路由挂回（2026-03-31）
- **下一步**: `industry_workflow_context` 从"透传"升级为"真正驱动运行时"

#### A3. 治理内核（senate_kernel + memory_governor + approval_gate）
- **目标**: 风控、验证、记忆、审批的统一治理层
- **价值**: 确保所有龙虾操作可审计、可回滚、有风控
- **当前状态**: ✅ 已实现并接入主图
- **最近动作**: 无近期变更
- **下一步**: 与Commander审批流统一

#### A4. Telegram Bot 控制通道
- **目标**: 通过 TG 远程控制龙虾流水线、审批HITL
- **价值**: 移动端远程管理，HITL审批通道
- **当前状态**: ✅ 已实现并测试可连通
- **最近动作**: ✅ 用户确认已连通TG
- **下一步**: 增加虾级控制命令（指定哪只虾执行）

---

### B. 边缘执行 — Edge Runtime

#### B1. WSS Receiver（WebSocket 接收器）
- **目标**: 接收云端推送的任务指令
- **价值**: 云端→边缘的通信桥梁
- **当前状态**: ✅ 已实现，有测试（26个通过）
- **最近动作**: 2026-03-31 提交
- **下一步**: 与 app.py 的 distribute_to_edge 对接

#### B2. Context Navigator（上下文导航器）
- **目标**: 在客户端App中导航到目标页面/功能
- **价值**: 自动化操作的"眼睛"
- **当前状态**: ✅ 已实现，有测试
- **下一步**: 与 Marionette Executor 集成

#### B3. Marionette Executor（木偶执行器）
- **目标**: 在客户端App中执行具体操作
- **价值**: 自动化操作的"手"
- **当前状态**: ✅ 已实现
- **下一步**: BBP Kernel 指令驱动

#### B4. BBP Kernel（行为蓝图处理器）
- **目标**: 将高层任务指令拆解为具体执行步骤
- **价值**: "大脑指令"→"手脚动作"的翻译器
- **当前状态**: ✅ 已实现
- **下一步**: E2E集成测试

---

### C. 控制面 — Web Dashboard + Backend

#### C1. Web 前端（web/）
- **目标**: SaaS 管理面板（策略提交、设备管理、审批看板、客户管理）
- **价值**: 商业交付物，客户操作界面
- **当前状态**: ✅ 页面齐全（20+页面），Next.js App Router
- **最近动作**: 🟡 推测有前端工程师在同步维护
- **下一步**: stepCards/workflowLanes 接入看板

#### C2. NestJS Backend（backend/）
- **目标**: 认证、租户管理、设备管理、自动驾驶、计费
- **价值**: 多租户 SaaS 后端
- **当前状态**: ✅ 模块齐全（auth/campaign/fleet/lead/autopilot/billing）
- **最近动作**: 🟡 AI子服务已透传 industry_workflow_context
- **下一步**: 完善租户隔离、计费流程

---

### D. 基础设施 — Docker/Deploy/Infra

#### D1. Docker Compose 编排
- **目标**: 一键启动全部服务
- **价值**: 开发环境统一、部署标准化
- **当前状态**: ✅ docker-compose.yml 存在，含多个compose变体
- **下一步**: 生产级 compose 完善

#### D2. 部署配置（deploy/）
- **目标**: 环境配置、合规检查
- **当前状态**: ✅ 基础配置存在
- **下一步**: CI/CD 流水线

---

### E. 研究与知识库

#### E1. 研究雷达（research_radar_*）
- **目标**: 自动抓取、排名、存储行业研究信号
- **当前状态**: ✅ fetcher/ranker/store 三件套已实现
- **下一步**: 与 Radar 虾深度集成

#### E2. 行业知识库（industry_kb_*）
- **目标**: 按行业分区的专业知识库
- **当前状态**: ✅ pool/seed/profile_generator 已实现
- **下一步**: 每虾知识包种子填充

---

## 二、项目落实程度盘点

### 📊 成熟度矩阵

| 项目 | 层级 | 说明 |
|------|------|------|
| **A1. Python AI Runtime** | 🟢 可执行 | 完整DAG，9虾全部有代码实现，可ainvoke执行 |
| **A2. TS Design-Time** | 🟢 可交付 | 9虾role-card、18 workflow、行业编译器均有产出 |
| **A3. 治理内核** | 🟢 可执行 | constitutional/verification/memory 三层均已接入 |
| **A4. TG Bot** | 🟢 已验证 | 用户确认已连通TG，可触发流水线+HITL |
| **B1. WSS Receiver** | 🟢 有测试 | 26个测试通过 |
| **B2. Context Navigator** | 🟢 有测试 | 已实现+测试 |
| **B3. Marionette Executor** | 🟡 已实现 | 代码完成，缺E2E验证 |
| **B4. BBP Kernel** | 🟡 已实现 | 代码完成，缺集成验证 |
| **C1. Web前端** | 🟢 可演示 | 20+页面，可运行 |
| **C2. NestJS后端** | 🟡 已实现 | 模块齐全但缺生产级测试 |
| **D1. Docker编排** | 🟡 可开发 | 开发环境可用，生产级待完善 |
| **E1. 研究雷达** | 🟡 已实现 | 三件套完成，缺深度集成 |
| **E2. 行业知识库** | 🟡 已实现 | 框架完成，内容待填充 |

### 各层级含义
- 🟢 **可执行/可交付/已验证**: 已产出结果，可实际运行
- 🟡 **已实现**: 代码完成但缺验证或缺深度集成
- 🟠 **已开始**: 有代码框架但不完整
- 🔴 **仅想法**: 只有设计文档无代码

### ❌ 仅想法（未动手）的项目
| 项目 | 说明 |
|------|------|
| Commander 智能路由器 | 设计存在，代码未开始（现在是固定DAG） |
| Commander 动态图构建 | `build_main_graph()` 仍是硬编码 |
| `industry_workflow_context` 消费 | 已透传但运行时未使用 |
| 每虾知识包种子填充 | 框架就绪，内容全空 |
| 生产级CI/CD | 无流水线 |

---

## 三、可拆分子项目识别

### SP1. Commander 智能路由器 🔥 高优先级
- **可独立性**: ✅ 高 — 不影响现有固定DAG运行
- **边界**: 输入=用户目标+行业context，输出=虾子集+执行顺序
- **依赖**: 读取 `workflow-catalog.ts` + `policy_bandit.py`
- **适合谁**: AI全栈（Python + 理解LangGraph）
- **算力等级**: 中
- **拆分理由**: 是从"demo可用"到"商业可用"的关键升级

### SP2. 每虾知识包填充 ✅ 可并行
- **可独立性**: ✅ 高 — 9只虾完全独立填充
- **边界**: 每虾一个知识包目录，填入行业规则/钩子/评分特征
- **依赖**: 无——只需要了解每虾的 role-card
- **适合谁**: 可由9个独立AI会话并行执行
- **算力等级**: 低（每虾）
- **拆分理由**: 最低耦合，最高并行度

### SP3. Edge Runtime E2E 集成 ✅ 可独立
- **可独立性**: ✅ 高 — 云端和边缘通过WSS解耦
- **边界**: WSS Receiver + Context Nav + Marionette + BBP Kernel 串联
- **依赖**: 需要一个模拟的 `distribute_to_edge` 消息格式
- **适合谁**: Python工程师
- **算力等级**: 低
- **拆分理由**: 与云端完全解耦，独立验证

### SP4. 前端看板接入 ✅ 可独立
- **可独立性**: ✅ 高 — 前端只需HTTP API
- **边界**: stepCards/workflowLanes/approvalCards → 前端组件
- **依赖**: `src/agent/commander/industry-workflow-preview.ts` 的类型定义
- **适合谁**: 前端工程师
- **算力等级**: 中
- **拆分理由**: 前后端已有明确接口契约

### SP5. 计费与商业化闭环 🟡 可延后
- **可独立性**: 🟡 中 — 需要前后端配合
- **边界**: billing.py + backend/billing + web/billing
- **依赖**: 需要支付网关集成
- **适合谁**: 全栈工程师
- **算力等级**: 中
- **拆分理由**: 商业化必要但非技术瓶颈

### SP6. TG Bot 增强（虾级控制） ✅ 可独立
- **可独立性**: ✅ 高
- **边界**: 在现有 telegram_bot.py 上增加命令
- **依赖**: dragon_senate.py 的各虾函数
- **适合谁**: Python工程师
- **算力等级**: 低
- **拆分理由**: 低风险增量改进

---

## 四、跨账号交接包

### 🧳 交接摘要（给新AI的5分钟速读）

**你接手的是什么**: OpenClaw Agent，一个 AI 增长操作系统。1个Commander总脑 + 9只龙虾数字员工，云端出策略，边缘自动执行。

**技术栈**:
- Python/LangGraph: AI运行时（`dragon-senate-saas-v2/`）
- TypeScript/NestJS: 后端（`backend/`）
- TypeScript/Next.js: 前端（`web/`）
- Python: 边缘执行器（`edge-runtime/`）

**当前能跑的东西**:
1. TG Bot → `/webhook/chat_gateway` → 完整9虾流水线（已测试通过）
2. Web Dashboard 20+页面（可演示）
3. Edge Runtime 4个模块（26个测试通过）

**最关键的文件**:
1. `PROJECT_CONTROL_CENTER.md` — 项目总控（必读）
2. `dragon-senate-saas-v2/dragon_senate.py` — 9虾LangGraph主图
3. `dragon-senate-saas-v2/app.py` — FastAPI主入口（6000+行）
4. `dragon-senate-saas-v2/lobsters/` — 9虾独立模块（刚提取）
5. `src/agent/commander/` — Commander设计时定义
6. `packages/lobsters/` — 9虾设计时包

**当前最大的差距**:
- Commander 是"想法"级别——目前是固定DAG，所有虾都执行
- 需要变成动态路由：根据任务目标选择子集虾执行

**立即可做的任务（低风险、高价值）**:
1. SP2: 每虾知识包填充（9路并行，零耦合）
2. SP6: TG Bot增强（加虾级控制命令）
3. SP3: Edge Runtime E2E串联

**需要整块时间的任务**:
1. SP1: Commander智能路由器
2. SP4: 前端看板接入

### 📋 环境变量检查清单
```
TELEGRAM_BOT_TOKEN=        # TG Bot Token
REDIS_URL=                 # Redis连接
HITL_SHARED_SECRET=        # HITL审批密钥
OPENAI_API_KEY=            # 或其他LLM provider
CLAWHUB_API_KEY=           # ClawHub技能调用
```

### 📋 启动命令
```powershell
# Python AI Runtime
cd dragon-senate-saas-v2
pip install -r requirements.txt
python app.py

# TG Bot
python telegram_bot.py

# Web前端
cd web
npm install && npm run dev

# NestJS后端
cd backend
npm install && npm run start:dev
```

### 📋 Git 状态
- 最新commit: `65880a6` (cleanup) ← `3c460a3` (Phase1 lobster modules) ← `d9433cf` (edge-runtime)
- 分支: `main`
- 远程: `origin: https://github.com/abdurrahmanadamu46-wq/open-claw-agent.git`

---

*本文档生成于 2026-03-31 01:38 (UTC+8)*
