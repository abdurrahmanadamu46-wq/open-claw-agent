# Ragas 借鉴分析报告
## https://github.com/vibrantlabsai/ragas

**分析日期：2026-04-02**  
**规则：生成过 Codex Task 的任务默认已落地 | 我们更好的默认略过**

---

## 一、Ragas 项目定性

```
Ragas（Python，8k+ Star，RAG 评估框架）：
  定位：专门评估 RAG（检索增强生成）系统质量的评估框架
  核心能力：
    Context Precision   — 检索上下文精确率（有多少上下文是相关的）
    Context Recall      — 检索上下文召回率（答案需要的上下文是否被召回）
    Faithfulness        — 忠实度（答案是否基于上下文，无幻觉）
    Answer Relevance    — 答案相关性（答案是否回答了问题）
    Context Relevance   — 上下文相关性（整体检索质量）
    BLEU/ROUGE          — 文本相似度指标（有参考答案时）
    TestSet Generator   — 自动生成 RAG 评估测试集（从文档库提问）
    批量评估             — 对整个数据集批量打分
    多LLM支持           — OpenAI / Anthropic / 本地模型
```

---

## 二、已落地的能力（略过）

```
CODEX_TASK_HALLUCINATION_METRIC.md 已落地（Opik 分析中生成）：
  ✅ 幻觉检测（Faithfulness）— 本轮刚生成

CODEX_TASK_SEMANTIC_MEMORY_SEARCH.md 已落地：
  ✅ 向量语义搜索（RAG 检索基础）

CODEX_TASK_HYBRID_MEMORY_SEARCH.md 已落地（Qdrant 分析中生成）：
  ✅ 混合搜索（检索质量升级）

dragon-senate-saas-v2/llm_quality_judge.py 已存在：
  ✅ LLM 质量评判（通用评估能力）

CODEX_TASK_EXPERIMENT_REGISTRY.md 已落地（Opik 分析中生成）：
  ✅ 实验对比框架

CODEX_TASK_PER_STEP_REWARD.md 已落地：
  ✅ 每步奖励评分
```

---

## 三、Ragas 对我们的真实价值

### 核心判断

Ragas 是 RAG 专项评估框架。我们的系统有典型的 RAG 流程：**龙虾从 enterprise_memory 召回记忆 → 拼入 prompt → 生成内容**。Ragas 的价值在于：**评估"检索这一步"的质量**——召回了多少无关记忆？遗漏了多少关键记忆？这是我们目前完全缺失的评估维度。

---

### 3.1 龙虾层 — 记忆检索质量评估（Context Precision + Recall）

**Ragas 检索评估：**
```python
from ragas.metrics import ContextPrecision, ContextRecall

# Context Precision：召回的上下文有多少是相关的（去噪）
# question: 用户问题
# contexts: 从 enterprise_memory 召回的记忆片段列表
# ground_truth: 正确答案
cp = ContextPrecision()
score = cp.score({
    "question": "王老板上次提到的合同金额是多少？",
    "contexts": retrieved_memory_chunks,   # 召回了哪些记忆
    "answer": lobster_output,
    "ground_truth": "150万元",
})
# 如果召回了10条记忆，只有3条相关 → precision = 0.3

# Context Recall：需要的上下文是否都被召回了
cr = ContextRecall()
score = cr.score({...})
# 如果正确回答需要5条记忆，只召回了4条 → recall = 0.8
```

**对我们的价值：**
```
我们的龙虾从 enterprise_memory 召回记忆，存在两种典型问题：
  问题1：召回了不相关的记忆（噪声，占用 token，干扰生成）
    → 需要 Context Precision 评估检索精确率
    
  问题2：遗漏了关键记忆（龙虾信息不完整，回答缺失）
    → 需要 Context Recall 评估检索召回率

借鉴 Ragas：
  在 ExperimentRegistry（已落地）中新增检索质量指标：
    "context_precision": 0.73  ← 检索精确率
    "context_recall": 0.81     ← 检索召回率
  
  当 precision 低 → 说明记忆匹配阈值太松，需要调高
  当 recall 低 → 说明记忆搜索深度不够，需要增加 top_k
  
  实现位置：dragon-senate-saas-v2/retrieval_quality_metric.py
  工程量：1.5天（需要构建 golden RAG 评估集）
```

**优先级：P1**（龙虾记忆 RAG 质量的核心盲区）

---

### 3.2 龙虾层 — Answer Relevance（答案相关性评估）

**Ragas Answer Relevance：**
```python
from ragas.metrics import AnswerRelevancy

# 评估答案是否切实回答了问题（而非答非所问）
ar = AnswerRelevancy(llm=judge_llm)
score = ar.score({
    "question": "帮我分析这个月的销售数据",
    "answer": lobster_output,
    # 通过反向问题生成评估：从答案中提取N个问题，
    # 看这些问题与原问题的语义相似度
})
# score: 0.0（完全不相关）~ 1.0（完全切题）
```

**对我们的价值：**
```
Answer Relevance 解决了"龙虾答非所问"问题：
  用户问"分析销售数据"，龙虾可能回答了很多废话，
  但没有真正回答用户的核心问题。
  
  Ragas 的创新：不需要参考答案，
  通过"从输出中生成N个假设问题 → 与原问题计算相似度"来评分
  
  实现方式：在 llm_quality_judge.py 新增 answer_relevance 指标
  与 HallucinationMetric（已落地）互补：
    Hallucination：答案是否"真实"（不捏造）
    AnswerRelevance：答案是否"相关"（切题）
  
  工程量：0.5天（复用 HallucinationMetric 的 LLM-as-Judge 框架）
```

**优先级：P2**（与 HallucinationMetric 配合，评估完整性）

---

### 3.3 支撑微服务 — TestSet Generator（自动生成 RAG 评估数据集）

**Ragas TestSet Generator：**
```python
from ragas.testset import TestsetGenerator

# 从文档库自动生成 RAG 评估问题集
generator = TestsetGenerator.from_langchain(llm, embeddings)

# 输入：我们的企业记忆文档
# 输出：自动生成的"问题-上下文-参考答案"三元组
testset = generator.generate_with_langchain_docs(
    documents=enterprise_docs,
    test_size=50,              # 生成50个测试问题
    distributions={
        "simple": 0.5,         # 简单直接问题
        "reasoning": 0.25,     # 需要推理的问题
        "multi_context": 0.25, # 跨多条记忆的问题
    }
)
# 输出格式：
# [{"question": "...", "contexts": [...], "ground_truth": "..."}]
```

**对我们的价值：**
```
构建 RAG 评估测试集是最大的工程瓶颈（P1 检索评估的前提）
  手动构建50个评估问题：需要 2-3 天人工标注
  TestSet Generator：从企业记忆文档自动生成 → 节省 80% 工时
  
  具体应用：
    从 enterprise_memory 中抽取文档块
    → 自动生成评估问题集（simple/reasoning/multi_context 三类）
    → 保存到 dataset_store.py（已有数据集存储）
    → 作为 ExperimentRegistry 的 golden_eval_set
  
  实现位置：scripts/generate_rag_testset.py
  工程量：1天（一次性工具，后续复用）
```

**优先级：P1**（是 P1 检索评估的前提，需先有测试集）

---

### 3.4 SaaS 系统 — 批量评估 Pipeline（Batch Evaluation）

**Ragas 批量评估：**
```python
from ragas import evaluate
from datasets import Dataset

# 批量评估整个数据集（并行计算）
result = evaluate(
    dataset=Dataset.from_list(eval_data),
    metrics=[context_precision, context_recall, faithfulness, answer_relevancy],
    llm=judge_llm,
    run_config=RunConfig(max_workers=8),  # 并行8路
)
# 返回 DataFrame，包含每条记录的各项评分
df = result.to_pandas()
```

**对我们的价值：**
```
我们的 ExperimentRegistry（已落地）运行评估时是逐条串行的
借鉴 Ragas 批量并行评估：
  max_workers 并行执行 LLM-as-Judge 调用
  在评估大型数据集（100条+）时，速度提升 5-8x
  
  实现位置：dragon-senate-saas-v2/experiment_registry.py
  改造 run_experiment_evaluation() 为并行 asyncio 执行
  工程量：0.5天（asyncio.gather 改造）
```

**优先级：P2**（性能优化，数据集小时不必要）

---

## 四、对比总结

| 维度 | Ragas | 我们 | 胜负 | 行动 |
|-----|-------|------|------|------|
| **Context Precision/Recall** | ✅ RAG专项 | 无 | Ragas 胜 | **P1** |
| **TestSet Generator** | ✅ 自动生成 | 手动 | Ragas 胜 | **P1** |
| **Answer Relevance** | ✅ | 无 | Ragas 胜 | **P2** |
| **批量并行评估** | ✅ | 串行 | Ragas 胜 | **P2** |
| Faithfulness（幻觉检测）| ✅ | ✅ 刚落地 | 平 | — |
| 实验对比框架 | ❌ | ✅ ExperimentRegistry | 我们胜 | — |
| 龙虾角色体系 | ❌ | ✅ | 我们胜 | — |

---

## 五、借鉴清单

### P1（2个）
| # | 借鉴点 | 工时 |
|---|--------|------|
| 1 | **RAG 测试集自动生成**（TestSet Generator → dataset_store.py）| 1天 |
| 2 | **检索质量评估**（Context Precision + Recall → ExperimentRegistry）| 1.5天 |

### P2（2个）
| # | 借鉴点 | 工时 |
|---|--------|------|
| 3 | **Answer Relevance 指标**（答案切题率，反向问题生成法）| 0.5天 |
| 4 | **批量并行评估**（asyncio 并行 ExperimentRegistry 评估）| 0.5天 |

---

*分析基于 Ragas v0.1.x（2026-04-02）*
