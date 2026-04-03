# 龙虾元老院 — LangGraph 工作流

基于 LangGraph 的 9 只龙虾 + 进化节点编排：**Radar → Strategist → [InkWriter ∥ Visualizer] → Dispatcher → [Echoer ∥ Catcher] → Abacus → 条件 FollowUp → Feedback**，支持并行、条件路由、MemorySaver 中断可恢复，并与 ClawHub 21 个 OpenAPI Schema 绑定占位。

## 流程概览

```mermaid
flowchart LR
  subgraph 情报与决策
    A[Radar 触须虾] --> B[Strategist 脑虫虾]
  end
  subgraph 内容兵工厂（并行）
    B --> C[InkWriter 吐墨虾]
    B --> D[Visualizer 幻影虾]
    C --> E[Dispatcher 点兵虾]
    D --> E
  end
  subgraph 收网与变现（并行）
    E --> F[Echoer 回声虾]
    E --> G[Catcher 铁网虾]
    F --> H[Abacus 金算虾]
    G --> H
  end
  H --> I{score>80?}
  I -->|是| J[FollowUp 回访虾]
  I -->|否| K[Feedback 进化]
  J --> K
  K --> END([结束])
```

## 运行

```bash
cd workflows/dragon-senate
pip install -r requirements.txt
python run.py
```

从仓库根目录运行（需把 `workflows/dragon-senate` 加入 PYTHONPATH 或安装为包）：

```bash
pip install -e workflows/dragon-senate
python -m dragon_senate.run
```

## 依赖

- `langgraph`、`langchain`、`langchain-openai`、`langchain-core`
- 可选：ClawHub skill loader（见 `dragon_senate/nodes.py` 内 `_ensure_llm_tools`，会尝试从 `docs/clawhub-langchain-tools.py` 按 agent 拉取 tools）

## 设计要点

### Fan-in 行为

- **Dispatcher**：InkWriter 与 Visualizer 并行，两条边都指向 Dispatcher。Dispatcher 会被调用最多两次；仅在状态中同时存在 `script_json` 与 `visual_prompts` 时执行真实下发，否则只追加「等待收齐」类 message。
- **Abacus**：Echoer 与 Catcher 并行，两条边都指向 Abacus。Abacus 仅在同时存在 `interaction_replies` 与 `leads` 时执行打分与推送，否则只追加等待 message。

### 条件路由

- **Abacus → FollowUp / Feedback**：`score > 80` 时进入 FollowUp（语音电销），否则直接进入 Feedback（进化）。FollowUp 执行后也会进入 Feedback，再结束。

### 状态与恢复

- **DragonState**：`total=False`，所有键可选；`messages` 使用 `add_messages` 归并。初始只需 `task_description` + `messages`。
- **MemorySaver**：`compile_app(checkpointer=MemorySaver())`，同一 `thread_id` 可中断恢复。

### ClawHub 工具绑定

每个节点内预留 `_ensure_llm_tools(agent_id)`，可从 `docs/clawhub-langchain-tools.py` 的 `get_tools_for_agent(agent_id)` 取该 Agent 的 tools，再 `llm.bind_tools(tools).invoke(...)`。与 `backend/src/agents/clawhub-skills/schemas.ts` 的 21 个 OpenAPI Schema 一一对应（含 universal skill-vetter）。

| 节点 | Agent ID | 绑定 Skills（ClawHub） |
|------|----------|------------------------|
| radar | radar | agent-browser, summarize |
| strategist | strategist | self-improving-agent, ontology, proactive-agent |
| inkwriter | ink-writer | humanizer, summarize |
| visualizer | visualizer | nano-banana-pro |
| dispatcher | dispatcher | proactive-agent, auto-updater |
| echoer | echoer | humanizer |
| catcher | catcher | summarize, ontology |
| abacus | abacus | api-gateway, gog |
| followup | follow-up | openai-whisper |
| feedback | - | self-improving-agent（进化闭环） |

## 单独 vs 配合

- **单独**：每个节点均可单独用 `state` 驱动（例如只跑 Radar+Strategist，或只跑 Abacus 打分），只要传入的 state 满足该节点所需字段。
- **配合**：完整跑法通过 `app.invoke(initial_state, config)` 一次跑通；Dispatcher/Abacus 的 fan-in 保证只在上下游数据齐备时执行核心逻辑。
