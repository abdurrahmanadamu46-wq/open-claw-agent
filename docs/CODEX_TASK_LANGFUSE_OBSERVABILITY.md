# CODEX TASK: Langfuse 借鉴落地 — LLM 可观测性体系
> 状态：✅ 核心代码已落地（P0/P1全部完成）
> 创建时间：2026-04-01
> 来源分析：docs/LANGFUSE_BORROWING_ANALYSIS.md

---

## 任务概述

从 Langfuse（YC W23，LLM 可观测性平台）借鉴其核心设计，为 OpenClaw 补全：
1. LLM 调用全量记录（Generation/Trace/Score）
2. Prompt 版本管理
3. LLM-as-Judge 自动质量评估
4. Golden Set 数据集管理
5. API Key 多 Key 管理
6. 配额拦截中间件（Free/Pro/Enterprise 计划）

---

## 已落地文件清单

### P0（最高价值）✅

| 文件 | 功能 | 接入方式 |
|------|------|----------|
| `dragon-senate-saas-v2/llm_call_logger.py` | LLM调用Trace/Span/Generation/Score记录 | 在 `lobster_runner.py` 的 LLM 调用处加 `@log_llm_call` 装饰器 |
| `dragon-senate-saas-v2/prompt_registry.py` | Prompt版本管理（push/get/promote/diff/render）| 替换龙虾里的硬编码 Prompt，改为 `reg.render("inkwriter_copy_generate", vars)` |

### P1（本周落地）✅

| 文件 | 功能 | 接入方式 |
|------|------|----------|
| `dragon-senate-saas-v2/llm_quality_judge.py` | LLM-as-Judge 自动评估（3种模板） | 在 app.py 加定时任务：`EvalRunner().run_batch(lobster="inkwriter")` |
| `dragon-senate-saas-v2/dataset_store.py` | Golden Set 数据集管理 | 高分文案自动入库：`ds.add_item("inkwriter_golden_copy", input, output)` |
| `dragon-senate-saas-v2/api_key_manager.py` | 多Key管理（创建/吊销/轮换/用量） | 在 `app.py` 加 `app.add_middleware(make_api_key_middleware())` |
| `dragon-senate-saas-v2/quota_middleware.py` | 配额拦截（Free/Pro/Enterprise + 429） | 在 `app.py` 加 `app.add_middleware(make_quota_middleware())` |

---

## app.py 集成接入指引

在 `dragon-senate-saas-v2/app.py` 的中间件配置段加入以下代码：

```python
# ── Langfuse 借鉴：API Key 验证 + 配额拦截 ──
from api_key_manager import make_api_key_middleware
from quota_middleware import make_quota_middleware

# 注意：中间件加载顺序是反的（后加的先执行）
# 执行顺序：ApiKeyMiddleware → QuotaMiddleware → 业务逻辑
app.add_middleware(make_quota_middleware())
app.add_middleware(make_api_key_middleware())
```

在 `dragon-senate-saas-v2/app.py` 的启动事件中初始化种子 Prompt：

```python
from prompt_registry import seed_default_prompts

@app.on_event("startup")
async def startup():
    seed_default_prompts()  # 初始化 inkwriter/catcher/abacus 的种子 Prompt
```

---

## lobster_runner.py 集成接入指引

在龙虾执行 LLM 调用时，启动 Trace → Span → Generation 记录：

```python
from llm_call_logger import get_llm_call_logger, GenerationStatus
from prompt_registry import get_prompt_registry

logger = get_llm_call_logger()
reg = get_prompt_registry()

# 1. 工作流启动时创建 Trace
trace_id = logger.start_trace(
    workflow_run_id=run_id,
    workflow_name="content-campaign-14step",
    tenant_id=tenant_id,
)

# 2. 龙虾步骤开始时创建 Span
span_id = logger.start_span(trace_id, lobster="inkwriter",
                             skill="inkwriter_industry_vertical_copy", step_index=5)

# 3. 从 Prompt 注册表拉取生产版本 Prompt（不再硬编码）
prompt_content = reg.render("inkwriter_copy_generate", {
    "industry": industry,
    "customer_name": customer_name,
    "pain_point": pain_point,
    "platform": platform,
    "word_count": "500",
})

# 4. 调用 LLM，记录 Generation
import time
t0 = time.time()
response = await llm_client.chat(prompt=prompt_content)
gen_id = logger.record_generation(
    trace_id=trace_id,
    span_id=span_id,
    model=model_name,
    input_text=prompt_content,
    output_text=response.content,
    prompt_tokens=response.usage.prompt_tokens,
    completion_tokens=response.usage.completion_tokens,
    latency_ms=int((time.time()-t0)*1000),
    tenant_id=tenant_id,
    meta={"lobster": "inkwriter", "skill": "inkwriter_industry_vertical_copy"},
)

# 5. 记录 Prompt 使用
reg.record_usage("inkwriter_copy_generate", version=1,
                  tenant_id=tenant_id, gen_id=gen_id)

# 6. 结束 Span
logger.end_span(span_id, status="completed")
```

---

## 定时 EvalRunner 接入指引（后台评估）

在 `app.py` 或独立 Worker 中：

```python
import asyncio
from llm_quality_judge import EvalRunner

async def run_eval_job():
    """每小时对未评估的 inkwriter Generation 自动打分"""
    runner = EvalRunner()
    result = runner.run_batch(lobster="inkwriter", eval_template="copy_quality", limit=20)
    print(f"评估完成：{result['evaluated']} 条，平均质量分：{result['avg_quality']}")

# 注册定时任务（每小时执行）
from apscheduler.schedulers.asyncio import AsyncIOScheduler
scheduler = AsyncIOScheduler()
scheduler.add_job(run_eval_job, "interval", hours=1)
scheduler.start()
```

---

## P2 待做事项（下一个迭代）

| # | 任务 | 说明 |
|---|------|------|
| P2-1 | 异步任务队列（task_queue.py）| BullMQ 思想，Python `rq` 实现，处理视频合成/eval批量 |
| P2-2 | 成本趋势 Dashboard（前端）| 调用 `llm_call_logger.get_cost_summary()` 渲染折线图 |
| P2-3 | Trace 树状可视化（前端）| 调用 `llm_call_logger.get_trace_detail()` 渲染嵌套时间轴 |
| P2-4 | 多维过滤组件（前端）| 工作流列表/Trace列表加时间范围+模型+龙虾过滤器 |
| P2-5 | 批量数据导出（CSV/Excel）| 调用 `dataset_store` 异步导出到 OSS |
| P2-6 | 轻量 Python SDK | 封装 `llm_call_logger` + `prompt_registry` 供外部集成 |

---

## 配额计划对照表

| 计划 | 工作流/月 | Token/月 | API 调用/分钟 | 边缘节点 |
|------|----------|----------|--------------|----------|
| free | 50 | 10万 | 30 | 1 |
| starter | 500 | 100万 | 120 | 3 |
| pro | 5000 | 1000万 | 600 | 10 |
| enterprise | 无限 | 无限 | 无限 | 无限 |

---

*完成时间：2026-04-01 | 落地文件：6个新 Python 模块*
