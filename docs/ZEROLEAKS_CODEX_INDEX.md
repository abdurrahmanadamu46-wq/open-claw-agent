# ZeroLeaks Codex 索引

**来源**：https://github.com/ZeroLeaks/zeroleaks（⭐539）  
**定位**：AI Security Scanner，多 Agent 架构 LLM 安全扫描器  
**分析日期**：2026-04-02  
**状态**：✅ 分析完成，P1/P2 任务已拆解

---

## 文档索引

| 文档 | 说明 |
|------|------|
| [ZEROLEAKS_BORROWING_ANALYSIS.md](./ZEROLEAKS_BORROWING_ANALYSIS.md) | 完整借鉴分析报告（架构解析+逐层对比+5大设计模式+优先级汇总）|
| [CODEX_TASK_ZEROLEAKS_P1.md](./CODEX_TASK_ZEROLEAKS_P1.md) | P1 任务（5个，立即落地）|
| [CODEX_TASK_ZEROLEAKS_P2.md](./CODEX_TASK_ZEROLEAKS_P2.md) | P2 任务（5个，计划落地）|

---

## P1 任务清单（5项，高价值立即落地）

| # | 任务 | 新建/升级文件 | 核心价值 |
|---|------|-------------|---------|
| P1-1 | **消息变异器**（成功消息自动生成5-10个变体）| `message_mutator.py`（新建）| A/B测试找最优，规避重复过滤 |
| P1-2 | **线索转化状态机**（7级漏斗状态机）| `lead_conversion_fsm.py`（新建）| 精确追踪每个线索的转化进展 |
| P1-3 | **失败原因精确分类**（12种失败原因枚举）| `audit_logger.py`（升级）| 精确诊断失败根因，自动建议修复 |
| P1-4 | **Commander 任务攻击树**（TAP 风格任务覆盖树）| `commander_graph_builder.py`（升级）| 系统性覆盖所有执行路径，智能剪枝 |
| P1-5 | **多轮对话序列编排**（内置冷启动/热跟进序列）| `lobster_task_dag.py`（升级）| 精细控制多轮对话的节奏和条件 |

---

## P2 任务清单（5项，计划落地）

| # | 任务 | 新建/升级文件 | 核心价值 |
|---|------|-------------|---------|
| P2-1 | **动态 Temperature 控制**（8种执行阶段对应不同温度）| `prompt_registry.py`（升级）| 提升龙虾输出质量和一致性 |
| P2-2 | **线索特征数据库**（4+种线索类型自动识别）| `lead_profile_db.py`（新建）| 自动识别线索类型，推荐最优策略 |
| P2-3 | **OpenClaw SDK**（`pip install openclaw`）| `sdk/__init__.py`（升级）| 开发者可编程调用龙虾 |
| P2-4 | **并行评估机制**（4维度并行评估，取加权共识）| `llm_quality_judge.py`（升级）| 更快更全面的龙虾输出质量评估 |
| P2-5 | **IM 渠道统一包装器**（BaseIMChannel + IMChannelRouter）| `lobster_im_channel.py`（升级）| 渠道故障自动切换，解耦渠道差异 |

---

## 核心设计模式（5个）

| 模式 | ZeroLeaks 原版 | 我们的转化 |
|------|-------------|----------|
| **TAP 攻击树** | 攻击路径树状规划+剪枝 | 任务执行路径树状规划+剪枝 |
| **DefenseProfile** | 目标系统防御画像 | 线索响应行为画像 |
| **LeakStatus（5级）** | 信息泄露程度评估 | 线索转化漏斗状态（7级）|
| **Mutator 变异** | 成功攻击Prompt变异生成变体 | 成功消息变异生成A/B测试变体 |
| **FailureReason** | 4种攻击失败原因精确分类 | 12种龙虾执行失败原因分类 |

---

## 关键洞察

```
ZeroLeaks 的攻击框架 ≈ 我们的营销框架

ZeroLeaks：探测目标系统漏洞（Probe → 攻击 → 评估 → 变异）
我们：      探测线索转化潜力（调研 → 触达 → 评估 → 优化）

ZeroLeaks 的 6 阶段攻击框架：
  reconnaissance → profiling → soft_probe → escalation → exploitation → persistence

类比我们的线索跟进阶段：
  调研画像 → 特征识别 → 软接触 → 价值深化 → 推动决策 → 持续维护
```

---

*ZeroLeaks/zeroleaks ⭐539 | 分析完成 2026-04-02*
