# Open WebUI 借鉴落地索引

**分析日期**：2026-04-02  
**来源**：https://github.com/open-webui/open-webui（⭐129,557）  
**定位**：User-friendly AI Interface — Python(FastAPI) + SvelteKit，支持 Ollama/OpenAI

---

## 生成文件清单

| 文件 | 类型 | 状态 |
|------|------|------|
| `docs/OPENWEBUI_BORROWING_ANALYSIS.md` | 完整分析报告（逐层对比）| ✅ 已生成 |
| `docs/CODEX_TASK_ARTIFACT_RENDERER.md` | P1-1 Codex Task | ✅ 已生成 |
| `docs/CODEX_TASK_LOBSTER_FEEDBACK.md` | P1-2 Codex Task | ✅ 已生成 |
| `docs/CODEX_TASK_LOBSTER_PIPELINE_MW.md` | P1-3+4 合并 Codex Task | ✅ 已生成 |
| `docs/CODEX_TASK_OPENWEBUI_P2.md` | P2 合并 Codex Task（7项）| ✅ 已生成 |

---

## P1 执行顺序（推荐）

```
1. CODEX_TASK_LOBSTER_PIPELINE_MW   ← 先建中间件基础（DLP + 后台任务）
2. CODEX_TASK_LOBSTER_FEEDBACK      ← 反馈收集（依赖 dataset_store，已有）
3. CODEX_TASK_ARTIFACT_RENDERER     ← 前端 Artifact 渲染（最直观的用户体验提升）
```

## P2 执行顺序

```
CODEX_TASK_OPENWEBUI_P2.md 包含：
  P2-1: KnowledgeBaseUI         ← 知识库管理 UI（接入已有 Qdrant）
  P2-2: TaskForkTree            ← 任务 Fork + 并排对比
  P2-3: PromptWorkspaceUI       ← Prompt 工作区前端（后端 prompt_registry 已有）
  P2-4: LobsterBroadcastChannel ← 团队频道（龙虾播报订阅）
  P2-5: ResourceAccessGrant     ← 资源级细粒度授权
  P2-6: OutputShareLink         ← 产出公开分享链接
  P2-7: EdgeFunctionSandbox     ← 自定义 Python 函数沙箱（边缘层）
```

---

## 已跳过项（我们已有或更好）

| 功能 | 跳过原因 |
|------|---------|
| 多语言 i18n | `CODEX_TASK_FRONTEND_I18N.md` 已落地 |
| WebSocket 实时通信 | `api_lobster_realtime.py` 已实现 |
| 内嵌 xterm 终端 | `CODEX_TASK_1PANEL_XTERM_TERMINAL.md` 已落地 |
| 分布式追踪 OTel | `CODEX_TASK_DISTRIBUTED_TRACING.md` 已落地 |
| 技能注册 API | `CODEX_TASK_LOBSTER_SKILL_REGISTRY.md` 已落地 |
| Prompt Diff 视图 | `CODEX_TASK_PROMPT_DIFF_VIEW.md` 已落地 |
| 混合记忆检索 RAG | `CODEX_TASK_HYBRID_MEMORY_SEARCH.md` 已落地 |
| MCP 工具监控 | `CODEX_TASK_MCP_TOOL_MONITOR.md` 已落地 |
| 用户引导流程 | `CODEX_TASK_ONBOARDING_FLOW.md` 已落地 |
| 图像生成 | `video_composer.py` 已有 |
| Docker 一键部署 | `CODEX_TASK_DOCKER_ONE_CLICK_DEPLOY.md` 已落地 |

---

## 核心价值总结

> Open WebUI ⭐129k 最值得我们借鉴的不是对话界面本身，
> 而是其**龙虾输出可视化（Artifact）**、**人工反馈飞轮（👍👎→训练数据）**、
> **Pipeline 调用链插件化**三大机制 — 这三件事能显著提升龙虾产出质量和用户体验。

---

*更新于 2026-04-02*
