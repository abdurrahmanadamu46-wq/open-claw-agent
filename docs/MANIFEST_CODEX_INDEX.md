# MANIFEST 借鉴总览索引
> 来源：https://github.com/mnfst/manifest（OpenClaw 专属智能 LLM 路由器）
> 分析日期：2026-04-02
> 文件总量：870个

---

## 项目定位一句话

> **Manifest = 坐在龙虾和 LLM 之间的智能路由层，按请求难度自动选最便宜模型，节省最多 70% 成本**

---

## 三大核心发现

| # | 发现 | 影响层 | 预期收益 |
|---|------|--------|---------|
| 🔴1 | **按请求复杂度动态路由**（Quality Score → Economy/Standard/Premium） | 云端大脑 ProviderRegistry | 节省 30-50% LLM 成本 |
| 🔴2 | **龙虾预算通知系统**（每小时检查，超 80% 预警，超 100% 阻断） | SaaS 支撑微服务 | 消除商业化意外超支风险 |
| 🔴3 | **API Key AES-256-GCM 加密存储**（客户 LLM Key 不可明文存储） | SaaS 安全层 | 商业化法律合规必备 |

---

## P1 任务清单

| 任务编号 | 任务名称 | 目标文件 | 状态 |
|---|---|---|---|
| M-P1-1 | LLM 请求智能质量评分路由器 | `dragon-senate-saas-v2/smart_router.py` | 📋 待执行 |
| M-P1-2 | 龙虾预算通知系统 | `dragon-senate-saas-v2/lobster_budget_alert.py` | 📋 待执行 |
| M-P1-3 | API Key AES 加密金库 | `dragon-senate-saas-v2/api_key_vault.py` | 📋 待执行 |
| M-P1-4 | 龙虾维度成本分析 API | `dragon-senate-saas-v2/lobster_cost_api.py` | 📋 待执行 |

## P2 任务清单（后续）

| 任务名称 | 描述 |
|---|---|
| SSE 预算告警推送 | 前端实时接收成本超限告警（替代轮询） |
| 龙虾成本看板页面 | `/operations/cost` 展示10只龙虾各自 Token/成本/趋势 |
| Ollama 边缘本地模型 | 边缘节点接入 Ollama，降低本地执行 LLM 成本 |
| Per-Agent Tier 前端配置 | 运营可视化配置每只龙虾的路由 Tier |
| OTLP 遥测接入 | 标准 OpenTelemetry 接入 Grafana/Jaeger |

---

## 文档清单

| 文档 | 路径 |
|---|---|
| 完整分析报告 | `docs/MANIFEST_BORROWING_ANALYSIS.md` |
| P1 任务（含代码） | `docs/CODEX_TASK_MANIFEST_P1.md` |
| 本索引 | `docs/MANIFEST_CODEX_INDEX.md` |

---

## 10只龙虾路由 Tier 默认配置

| 龙虾 | 默认 Tier | 原因 |
|---|---|---|
| commander | 🔴 Premium | 编排决策，需最强推理 |
| strategist | 🔴 Premium | 4视角分析，高复杂度 |
| radar | 🟡 Standard | 信号搜索，中等复杂 |
| inkwriter | 🟡 Standard | 文案生成，中等复杂 |
| visualizer | 🟡 Standard | 分镜设计，中等复杂 |
| catcher | 🟡 Standard | 线索评分，中等复杂 |
| abacus | 🟡 Standard | ROI 计算，中等复杂 |
| dispatcher | 🟢 Economy | 执行调度，规则化 |
| echoer | 🟢 Economy | 回复话术，简单重复 |
| followup | 🟢 Economy | 跟进话术，简单模板 |

*预估：2 Premium + 5 Standard + 3 Economy，相比全走 Premium 节省约 40%*

---

*生成时间：2026-04-02 | 维护者：龙虾池研发团队*
