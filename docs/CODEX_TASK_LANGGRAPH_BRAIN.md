# CODEX TASK: LangGraph Server 升级大脑层（陈总指挥图）
**任务ID**: CODEX-LANGGRAPH-P2-001  
**优先级**: 🟡 P2（大脑层：commander 多龙虾协同调度从线性→有向图）  
**依赖文件**: `dragon-senate-saas-v2/commander_graph_builder.py`, `dragon-senate-saas-v2/lobster_runner.py`  
**参考项目**: LangGraph（https://github.com/langchain-ai/langgraph）  
**预计工期**: 3天

---

## 一、当前痛点

**现状**：`commander_graph_builder.py` 构建了一个简单的线性 DAG，陈总（commander）按顺序调度龙虾：
```
陈总 → 苏丝(strategist) → 老建(dispatcher) → 铁狗(catcher) → 小锤(followup)
```

**问题**：
- 龙虾任务是顺序执行的，互相不依赖的任务无法并行
- 没有条件分支（如果苏丝策略失败，应自动重规划而不是中断）
- 没有循环（人工审批后继续、失败重试）
- 不支持"人在回路"（Human-in-the-Loop）中断等待

**LangGraph 解决**：
- **State Graph**：将龙虾协作定义为有状态的有向图
- **并行节点**：分析/撰文/数据抓取 可以同时执行
- **条件边**：苏丝输出质量分 < 60 → 重规划；≥ 60 → 继续
- **Human Interrupt**：重要决策暂停等待人工确认
- **持久化 Checkpoint**：中断后继续，不丢失进度

---

## 二、龙虾协作图设计

```
START
  │
  ▼
[陈总 Commander] ← 接收任务，制定总计划
  │
  ├─── 并行 ───────────────────────────────────────────────┐
  │                                                        │
  ▼                                                        ▼
[苏丝 Strategist]                               [林涛 Radar]
 制定内容策略                                     市场情报收集
  │                                                        │
  └─────────────────── 合并 ─────────────────────────────┘
                              │
                              ▼
                    [质量判断节点]
                    score >= 70?
                    /            \
                  Yes             No
                  │               │
                  ▼               ▼
         [墨小鸦 Inkwriter]   [重新规划]──→ 回到苏丝
          撰写内容
              │
              ▼
    [Human Review 节点] ← 等待人工审批（可选）
              │
     approved / rejected
              │
              ▼
         [影子 Visualizer]
          生成视觉素材
              │
              ▼
         [老建 Dispatcher]
          分发到边缘节点
              │
              ▼
         [小锤 Followup]
          跟进互动数据
              │
              ▼
            END
```

---

## 三、核心实现

```python
# dragon-senate-saas-v2/commander_langgraph.py（新建）
"""
基于 LangGraph 的龙虾协作图
替代 commander_graph_builder.py 的简单 DAG

特性：
- 并行节点（苏丝+林涛并发执行）
- 条件边（质量分判断）
- Human-in-the-Loop（重要内容人工审批）
- SQLite Checkpoint（中断续跑）
"""

from typing import TypedDict, Annotated, Optional
from langgraph.graph import StateGraph, START, END
from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.types import interrupt
import operator


# ═══ 状态定义 ═══
class DragonSenateState(TypedDict):
    """龙虾参谋部协作状态"""
    # 任务输入
    task_id: str
    task_type: str
    raw_requirements: str
    
    # 各龙虾输出
    commander_plan: Optional[dict]      # 陈总的总计划
    strategy: Optional[dict]            # 苏丝的内容策略
    market_intel: Optional[dict]        # 林涛的市场情报
    quality_score: Optional[float]      # 质量评分
    content_draft: Optional[str]        # 墨小鸦的内容草稿
    visual_assets: Optional[list]       # 影子的视觉素材
    dispatch_result: Optional[dict]     # 老建的分发结果
    followup_data: Optional[dict]       # 小锤的跟进数据
    
    # 流程控制
    revision_count: int                 # 重规划次数（防止死循环）
    human_approved: Optional[bool]      # 人工审批结果
    error: Optional[str]               # 错误信息


# ═══ 节点函数 ═══

async def commander_node(state: DragonSenateState) -> dict:
    """陈总：制定总计划"""
    from .lobster_runner import run_lobster
    
    result = await run_lobster(
        lobster_id="commander",
        task="制定任务计划",
        context={
            "task_type": state["task_type"],
            "requirements": state["raw_requirements"],
        }
    )
    
    return {"commander_plan": result["output"]}


async def strategist_node(state: DragonSenateState) -> dict:
    """苏丝：制定内容策略"""
    from .lobster_runner import run_lobster
    
    result = await run_lobster(
        lobster_id="strategist",
        task="制定内容策略",
        context={
            "plan": state["commander_plan"],
            "market_intel": state.get("market_intel"),  # 可能已有林涛的情报
        }
    )
    
    return {
        "strategy": result["output"],
        "quality_score": result.get("confidence", 0.7) * 100,
    }


async def radar_node(state: DragonSenateState) -> dict:
    """林涛：市场情报收集（与苏丝并行）"""
    from .lobster_runner import run_lobster
    
    result = await run_lobster(
        lobster_id="radar",
        task="收集市场情报",
        context={"task_type": state["task_type"]},
    )
    
    return {"market_intel": result["output"]}


def quality_router(state: DragonSenateState) -> str:
    """质量评分路由：决定是继续还是重规划"""
    score = state.get("quality_score", 0)
    revision_count = state.get("revision_count", 0)
    
    if score >= 70:
        return "proceed"
    elif revision_count >= 2:
        # 最多重规划2次，避免死循环
        return "proceed"  # 强制继续
    else:
        return "revise"


async def human_review_node(state: DragonSenateState) -> dict:
    """人工审批节点（重要内容必须人工确认）"""
    # LangGraph 的 Human-in-the-Loop：暂停等待外部输入
    human_decision = interrupt({
        "action": "review_content",
        "content": state.get("content_draft"),
        "task_id": state["task_id"],
        "message": "请审批以下内容草稿",
    })
    
    return {"human_approved": human_decision.get("approved", False)}


async def inkwriter_node(state: DragonSenateState) -> dict:
    """墨小鸦：撰写内容"""
    from .lobster_runner import run_lobster
    
    result = await run_lobster(
        lobster_id="inkwriter",
        task="撰写内容",
        context={
            "strategy": state["strategy"],
            "market_intel": state.get("market_intel"),
        }
    )
    
    return {"content_draft": result["output"]}


# ═══ 构建图 ═══

def build_dragon_senate_graph(require_human_review: bool = False):
    """
    构建龙虾协作图
    
    Args:
        require_human_review: 是否需要人工审批
    """
    graph = StateGraph(DragonSenateState)
    
    # 添加节点
    graph.add_node("commander", commander_node)
    graph.add_node("strategist", strategist_node)
    graph.add_node("radar", radar_node)
    graph.add_node("inkwriter", inkwriter_node)
    graph.add_node("human_review", human_review_node)
    
    # 起点
    graph.add_edge(START, "commander")
    
    # 陈总 → 苏丝和林涛并行
    graph.add_edge("commander", "strategist")
    graph.add_edge("commander", "radar")
    
    # 苏丝和林涛完成后 → 质量判断
    graph.add_conditional_edges(
        "strategist",  # 苏丝完成后触发路由
        quality_router,
        {
            "proceed": "inkwriter",
            "revise": "strategist",   # 重规划回苏丝
        }
    )
    
    # 林涛 → 直接到墨小鸦（她的情报会被墨小鸦使用）
    graph.add_edge("radar", "inkwriter")
    
    # 墨小鸦 → 人工审批 or 直接结束
    if require_human_review:
        graph.add_edge("inkwriter", "human_review")
        graph.add_edge("human_review", END)
    else:
        graph.add_edge("inkwriter", END)
    
    # SQLite 持久化 Checkpoint（支持中断续跑）
    memory = SqliteSaver.from_conn_string(
        "/data/openclaw/langgraph_checkpoints.db"
    )
    
    return graph.compile(checkpointer=memory, interrupt_before=["human_review"] if require_human_review else [])


# ═══ 执行入口 ═══

async def run_dragon_senate(
    task_id: str,
    task_type: str,
    requirements: str,
    require_human_review: bool = False,
    thread_id: str = None,
) -> dict:
    """运行龙虾参谋部协作图"""
    
    app = build_dragon_senate_graph(require_human_review)
    
    config = {
        "configurable": {
            "thread_id": thread_id or task_id,
        }
    }
    
    initial_state = {
        "task_id": task_id,
        "task_type": task_type,
        "raw_requirements": requirements,
        "revision_count": 0,
    }
    
    final_state = await app.ainvoke(initial_state, config=config)
    return final_state
```

---

## 四、与 SaaS 集成

```python
# dragon-senate-saas-v2/app.py — 新增路由

@app.post("/api/tasks/{task_id}/approve")
async def approve_task(task_id: str, body: dict):
    """人工审批接口（对接 Human-in-the-Loop）"""
    app = build_dragon_senate_graph(require_human_review=True)
    config = {"configurable": {"thread_id": task_id}}
    
    # 恢复被中断的图，传入审批结果
    await app.ainvoke(
        Command(resume={"approved": body.get("approved", False)}),
        config=config,
    )
    
    return {"status": "resumed", "task_id": task_id}
```

---

## 五、验收标准

- [ ] `build_dragon_senate_graph()` 成功构建图（节点+边完整）
- [ ] 苏丝和林涛**并行执行**（不是顺序）
- [ ] 质量评分 < 70：自动触发重规划（最多2次）
- [ ] `require_human_review=True`：图在 `human_review` 节点暂停，等待 `/api/tasks/{id}/approve`
- [ ] SQLite Checkpoint：中断后重新运行，从断点继续
- [ ] 与 `lobster_runner.py` 集成：图节点调用真实龙虾
- [ ] 与 `task_queue.py` 集成：任务提交 → 触发图执行
