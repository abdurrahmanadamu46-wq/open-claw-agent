# SYSPROMPTS CODEX INDEX
# AI工具 System Prompt 借鉴全索引

**来源库**：https://github.com/x1xhlol/system-prompts-and-models-of-ai-tools（⭐134,012）  
**分析完成日期**：2026-04-02  
**生成文件**：3个（分析报告 + P1任务 + P2任务）

---

## 文件索引

| 文件 | 类型 | 内容摘要 |
|------|------|---------|
| `SYSPROMPTS_BORROWING_ANALYSIS.md` | 分析报告 | 8大AI工具架构速览 + 6层逐层对比 + TOP5设计模式 + P1/P2优先级汇总 |
| `CODEX_TASK_SYSPROMPTS_P1.md` | P1 Codex | Agent Loop标准化 / 执行步骤摘要 / 龙虾职责边界守卫 / 能力Module注册表 / 边缘截图回传 |
| `CODEX_TASK_SYSPROMPTS_P2.md` | P2 Codex | 任务复杂度分类器 / 工具类型系统 / 三阶段任务框架 / Prompt Changelog / 边缘无头模式 |

---

## 借鉴来源映射

| AI 工具 | 核心贡献 | 我们如何用 |
|---------|---------|-----------|
| **Manus Agent** | Agent Loop（感知→选择→执行→观察→完成）+ Modules化设计 | 升级 `lobster_runner.py` + 新建 `module_registry.py` |
| **Windsurf（Cascade）** | toolSummary（每步2-5字摘要）+ Browser Preview 截图 | 升级 `api_lobster_realtime.py` + `marionette_executor.py` |
| **Claude Code 2.0** | 最小执行原则（Do nothing more）+ 输出精简 | 新建 `lobster_boundary_guard.py` |
| **Kiro** | Mode Classifier（Vibe vs Spec 双模式）| 新建 `task_classifier.py` |
| **Devin AI** | Plan/Execute/Verify 三阶段框架 | 升级 `lobster_task_dag.py` |
| **Cursor** | Prompt 版本化（v1.0→2.0，CLI独立）| 升级 `prompt_registry.py` + 新建 `headless_prompt.py` |
| **v0（Vercel）** | 前端规范化（shadcn/tailwind严格约束）| 前端组件规范（已落地）|
| **Replit** | 沙箱工具集标准化（25KB工具定义）| 参考设计 `tool_schema.py` |

---

## P1 任务清单（立即落地）

| # | 任务 | 落地文件 | 状态 |
|---|------|---------|------|
| P1-1 | 标准化 Agent Loop | `lobster_runner.py` | ⬜ 待开发 |
| P1-2 | 执行步骤摘要（action_summary） | `api_lobster_realtime.py` | ⬜ 待开发 |
| P1-3 | 龙虾职责边界守卫（BoundaryGuard） | `lobster_boundary_guard.py`（新建）| ⬜ 待开发 |
| P1-4 | 能力 Module 注册表 | `module_registry.py`（新建）| ⬜ 待开发 |
| P1-5 | 边缘截图回传 | `edge-runtime/marionette_executor.py` | ⬜ 待开发 |

## P2 任务清单（计划落地）

| # | 任务 | 落地文件 | 状态 |
|---|------|---------|------|
| P2-1 | 任务复杂度分类器（Vibe/Spec）| `task_classifier.py`（新建）| ⬜ 待开发 |
| P2-2 | 工具类型系统（TypeScript-like）| `tool_schema.py`（新建）| ⬜ 待开发 |
| P2-3 | 三阶段任务框架（Plan/Execute/Verify）| `lobster_task_dag.py` | ⬜ 待开发 |
| P2-4 | Prompt 版本 Changelog | `prompt_registry.py` | ⬜ 待开发 |
| P2-5 | 边缘无头模式（Headless Prompt）| `edge-runtime/headless_prompt.py`（新建）| ⬜ 待开发 |

---

## 关键洞察（不可遗忘）

```
1. Manus 的 Agent Loop 是行业最佳实践的执行循环设计
   → 我们的 lobster_runner 要对齐这个结构

2. Claude Code "Do nothing more" 是最重要的 Agent 安全原则
   → 每只龙虾都需要明确的职责红线清单

3. Windsurf toolSummary 是用户体验的关键细节
   → "正在分析线索"比 read_lead_profile 更友好

4. Kiro 的 Vibe/Spec 双模式是任务调度的核心分层
   → 简单任务不需要规划，直接执行，减少延迟

5. 我们的独特优势（这些工具都没有）：
   - 9只有灵魂的龙虾（AI人格化）
   - 中国 IM 渠道深度集成
   - LLM 成本实时可见
   - 营销漏斗量化指标
```

---

## 关联文档

- `BORROWING_GAP_ANALYSIS_2026-04-01.md` — 综合借鉴差距分析
- `CODEX_MASTER_INDEX_2026-04-01.md` — 所有 Codex Task 总索引
- `LOBSTER_CONSTITUTION.md` — 龙虾宪法（职责边界的基础）
- `FLEET_CODEX_INDEX.md` — 边缘管理相关（与截图回传联动）

---

*⭐134k System Prompts 库 | 分析日期：2026-04-02 | 文件共3个*
