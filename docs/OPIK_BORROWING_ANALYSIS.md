# Opik 借鉴分析报告
## https://github.com/comet-ml/opik

**分析日期：2026-04-02**  
**规则：生成过 Codex Task 的任务默认已落地 | 我们更好的默认略过**

---

## 一、Opik 项目定性

```
Opik（Python+TypeScript，Comet ML 出品，4k+ Star）：
  定位：LLM 应用可观测性平台（traces + evaluations + datasets + prompts）
  核心能力：
    Trace 追踪        — 完整 LLM 调用链路记录（span 树）
    Span 属性         — input/output/tokens/latency/cost 逐步记录
    Experiment        — A/B 测试评估框架（多版本对比）
    Dataset           — 评估数据集管理（golden set）
    Prompt 版本管理   — prompt 历史记录 + 版本对比
    在线评估          — 生产流量实时评分（LLM-as-Judge）
    离线评估          — 批量评估数据集
    Python SDK        — @track 装饰器自动追踪
    前端 Dashboard    — Trace 浏览器 + Experiment 对比 + Dataset 管理
    多租户            — Workspace 隔离
```

---

## 二、已落地的能力（略过）

```
CODEX_TASK_LANGFUSE_OBSERVABILITY.md 已落地：
  ✅ LLM 调用追踪（traces/spans）— Langfuse 已覆盖

CODEX_TASK_LLM_CALL_LOGGER.md 已落地：
  ✅ LLM 调用日志（llm_call_logger.py）

CODEX_TASK_PER_STEP_REWARD.md 已落地：
  ✅ 每步奖励评分

dragon-senate-saas-v2/dataset_store.py 已存在：
  ✅ 数据集存储

dragon-senate-saas-v2/llm_quality_judge.py 已存在：
  ✅ LLM 质量评判

dragon-senate-saas-v2/prompt_registry.py 已存在：
  ✅ Prompt 注册表（版本管理已覆盖）

CODEX_TASK_LOBSTER_FINETUNE_PIPELINE.md 已落地：
  ✅ 龙虾微调流水线（含评估）
```

---

## 三、Opik 对我们的真实价值

### 核心判断

Opik 与 Langfuse 高度重叠（Trace/Span/Evaluation），我们已通过 `CODEX_TASK_LANGFUSE_OBSERVABILITY` 落地了 LLM 追踪。**真正的差距在于 Opik 的 Experiment 对比框架设计**——多版本 prompt/模型并行评估、结果可视化对比，这比我们目前的点评估更系统化。

---

### 3.1 云端大脑/龙虾层 — Experiment 多版本对比评估

**Opik Experiment 框架：**
```python
# Opik 的 Experiment 设计
import opik

# 定义评估数据集
dataset = opik.get_dataset("lobster_eval_golden_set")

# 定义评估指标
@opik.metric
def task_completion_rate(input, output):
    # LLM-as-Judge：判断龙虾是否完成了任务
    score = llm_judge(prompt=JUDGE_PROMPT, input=input, output=output)
    return score  # 0.0 - 1.0

# 并行运行多个实验版本
opik.evaluate(
    dataset=dataset,
    task=my_lobster_task,
    scoring_metrics=[task_completion_rate, hallucination_check],
    experiment_config={
        "model": "gpt-4o",
        "prompt_version": "v2.3",
        "lobster": "strategist",
    }
)
# → 前端展示：Experiment A vs B vs C 的指标对比表格
```

**对我们的价值：**
```
我们的龙虾评估目前是点评估（单次评分），缺少：
  ① 多版本 prompt 并行对比（A/B Testing）
  ② 在同一个 golden dataset 上评估多个龙虾版本
  ③ 实验结果历史积累（每次版本迭代的指标对比）
  
  借鉴 Opik Experiment 设计：
    建立 ExperimentRegistry（实验注册表）
    每次龙虾 prompt 更新 → 跑 Experiment
    记录：lobster_name + prompt_version + metrics + scores
    前端：实验结果对比表格（当前版本 vs 历史版本）
    
  与已落地的 dataset_store.py + llm_quality_judge.py 集成
  工程量：中等（2天），价值：直接驱动龙虾版本迭代决策
```

**优先级：P1**（龙虾持续优化的核心基础设施）

---

### 3.2 云端大脑/龙虾层 — 在线评估（Online Evaluation）

**Opik 在线评估：**
```python
# 生产流量中实时评分（采样评估）
@opik.track
async def run_lobster_task(input: str) -> str:
    output = await strategist.run(input)
    
    # 自动触发：Opik 实时评分（每N条采样）
    # → 检测 hallucination / 任务完成率 / 安全性
    return output

# 规则配置：每100条采样10条做在线评估
opik.configure_online_eval(
    sampling_rate=0.1,
    metrics=["hallucination", "task_completion"],
)
```

**对我们的价值：**
```
我们的 llm_quality_judge.py 已有质量评判能力，
但缺少自动采样触发机制（Online Eval）

借鉴：在 lobster_runner.py 中：
  每 N 次龙虾任务结束 → 抽样 → 自动触发 llm_quality_judge
  结果写入 Experiment 记录（与 ExperimentRegistry 联动）
  → 持续监控生产质量，无需人工触发评估
  
  实现成本：低（装饰器模式，< 1天）
```

**优先级：P2**（与 P1 ExperimentRegistry 配合，单独价值中等）

---

### 3.3 前端 — Experiment 对比 UI（多版本并排对比）

**Opik 前端 Experiment 对比：**
```
实验列表页：
  Experiment Name | Model | Prompt Version | Avg Score | Date | Status
  ─────────────────────────────────────────────────────────────────────
  strategist-v2.3 | gpt-4o | v2.3         | 0.87      | 今天 | ✅
  strategist-v2.2 | gpt-4o | v2.2         | 0.79      | 昨天 | ✅
  strategist-v2.1 | gpt-3.5 | v2.1        | 0.71      | 上周 | ✅
  
实验详情页（点击对比）：
  并排展示两个实验的：
    - 相同输入 → 不同输出（高亮差异）
    - 各项指标得分（雷达图 / 柱状图）
    - Token 用量 / 延迟 / 成本对比
```

**对我们的价值：**
```
我们有 llm_quality_judge.py 评估数据，但无前端展示
借鉴 Opik 实验对比 UI：
  ExperimentList + ExperimentDetail 两个页面
  龙虾进化决策可视化（哪个版本更好，一目了然）
  
  实现位置：web/src/app/experiments/
  工程量：1.5天（与 P1 ExperimentRegistry 后端配合）
```

**优先级：P1**（与 ExperimentRegistry 打包，工程量合并计算）

---

### 3.4 SaaS 系统 — Prompt 版本对比（diff view）

**Opik Prompt 版本管理：**
```
Prompt 历史页：
  版本号 | 内容摘要 | 创建时间 | 关联实验
  
Prompt Diff View：
  v2.3 vs v2.2 并排 diff（高亮新增/删除的指令行）
  → 快速理解 prompt 变更的内容
```

**对我们的价值：**
```
我们的 prompt_registry.py 已有版本管理，
但缺少 Prompt Diff View（前端对比展示）

借鉴：在已有 Prompt 管理页面新增"对比版本"功能
  选择两个版本 → 展示 diff（unified diff 格式）
  与实验结果联动（哪次 prompt 改动带来了分数提升）
  
  工程量：前端 0.5天 + 后端 diff API 0.3天
```

**优先级：P2**（辅助功能，配合 ExperimentRegistry）

---

### 3.5 龙虾层 — Hallucination 检测评估指标

**Opik 内置 Hallucination 指标：**
```python
from opik.evaluation.metrics import Hallucination, AnswerRelevance

# 检测龙虾输出是否包含幻觉
hallucination = Hallucination()
score = hallucination.score(
    input="给王老板写一封感谢信",
    output=lobster_output,
    context=retrieved_memory,  # 龙虾的记忆上下文
)
# score.value: 0.0（无幻觉）~ 1.0（严重幻觉）
```

**对我们的价值：**
```
我们的 llm_quality_judge.py 已有自定义评判，
但没有标准化的 Hallucination 检测（基于 context）

借鉴：新增 HallucinationMetric 评估指标：
  input: 用户指令
  output: 龙虾生成内容
  context: 从 enterprise_memory 召回的记忆
  
  检测龙虾是否"凭空捏造"了不在 context 中的信息
  与 SLOWMIST 安全红线（已落地）配合
  
  工程量：< 0.5天（借用 LLM-as-Judge 模式）
```

**优先级：P2**（安全+质量双保险）

---

## 四、对比总结

| 维度 | Opik | 我们 | 胜负 | 行动 |
|-----|------|------|------|------|
| **Experiment 多版本对比** | ✅ 完整框架 | 点评估 | Opik 胜 | **P1** |
| **前端 Experiment 对比 UI** | ✅ | 无 | Opik 胜 | **P1** |
| **在线采样评估** | ✅ | 手动触发 | Opik 胜 | **P2** |
| **Prompt Diff View** | ✅ | 无 diff | Opik 胜 | **P2** |
| **Hallucination 检测** | ✅ | 无标准化 | Opik 胜 | **P2** |
| Trace/Span 追踪 | ✅ | ✅ Langfuse 已落地 | 平 | — |
| LLM 日志 | ✅ | ✅ llm_call_logger 已落地 | 平 | — |
| 龙虾角色体系 | ❌ | ✅ 深度定制 | 我们胜 | — |
| 边缘执行 | ❌ | ✅ | 我们胜 | — |

---

## 五、借鉴清单

### P1（1个，含前端）
| # | 借鉴点 | 工时 |
|---|--------|------|
| 1 | **ExperimentRegistry + 前端对比 UI**（实验注册表 + 多版本并排对比页面）| 3天 |

### P2（3个）
| # | 借鉴点 | 工时 |
|---|--------|------|
| 2 | **在线采样评估**（lobster_runner 每N次自动触发质量评判）| 0.5天 |
| 3 | **Prompt Diff View**（prompt_registry 版本对比前端）| 0.8天 |
| 4 | **Hallucination 检测指标**（基于 context 的幻觉评分）| 0.5天 |

---

*分析基于 Opik v0.3.x（2026-04-02）*
