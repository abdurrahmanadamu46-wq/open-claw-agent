# CLI-Anything 借鉴索引
> 来源：https://github.com/HKUDS/CLI-Anything
> 创建日期：2026-04-02
> 状态：P1 任务已生成，待执行

---

## 项目定性

**CLI-Anything** = "让任何 GUI 软件对 AI Agent 变成可操作的 CLI 工具框架"

香港大学 HKUDS 实验室出品。已官方支持 OpenClaw 作为 Agent（`openclaw-skill/SKILL.md`）。

---

## 3大核心发现

| # | 发现 | 影响层 | 重要度 |
|---|------|--------|--------|
| 1 | **SKILL.md YAML frontmatter 标准** → 龙虾技能可被自然语言触发 | 龙虾 KB / 支撑微服务 | 🔴 极高 |
| 2 | **probe-then-mutate 两段式执行** → 高风险操作前必须预检 | 云边调度 / 边缘层 | 🔴 极高 |
| 3 | **Backend 适配器标准模式** → MarionetteExecutor 标准化 | 边缘层 | 🔴 高 |

---

## P1 任务清单

| 任务 ID | 任务名 | 目标文件 | 状态 |
|---------|--------|---------|------|
| P1-1 | 龙虾技能 YAML Frontmatter 标准化 | `dragon-senate-saas-v2/lobster_skill_yaml.py` | ⬜ 待执行 |
| P1-2 | ExecutionPlan Probe-then-Mutate 两段式 | `dragon-senate-saas-v2/execution_plan_probe.py` | ⬜ 待执行 |
| P1-3 | 边缘 Browser Backend 适配器重构 | `edge-runtime/browser_backend.py` | ⬜ 待执行 |
| P1-4 | 边缘 Session 文件锁定写入 | `edge-runtime/session_lock.py` | ⬜ 待执行 |

---

## 10只龙虾受益映射

| 龙虾 | 受益内容 | 优先级 |
|------|---------|--------|
| Dispatcher（点兵虾） | probe-then-mutate 两段式、ExecutionPlan 增强 | 🔴 P1 |
| 所有龙虾 | SKILL.md YAML 触发词标准化 | 🔴 P1 |
| Visualizer（幻影虾） | ComfyUI CLI 接口对齐（queue/models/workflows） | 🟡 P2 |
| Radar（触须虾） | Zotero discovery 模式（探针→分析→报告） | 🟡 P2 |

---

## 文档链接

| 文档 | 路径 |
|------|------|
| 完整借鉴分析 | `docs/CLI_ANYTHING_BORROWING_ANALYSIS.md` |
| P1 任务包（含代码） | `docs/CODEX_TASK_CLI_ANYTHING_P1.md` |

---

*CLI-Anything 已官方集成 OpenClaw（见 openclaw-skill/SKILL.md）— 双方生态深度耦合*
