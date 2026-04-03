# CODEX TASK: DSPy 龙虾提示词自优化引擎
**任务ID**: CODEX-DSPY-P2-001  
**优先级**: 🟡 P2（龙虾提示词从"人工调参"→"数据驱动自动优化"）  
**依赖文件**: `dragon-senate-saas-v2/prompt_registry.py`, `docs/lobster-kb/*/skills.json`  
**参考项目**: DSPy（https://github.com/stanfordnlp/dspy）  
**预计工期**: 2天

---

## 一、当前痛点

**现状**：每只龙虾的提示词由人手写，调优靠经验+反复试跑：
```python
# prompt_registry.py 现状
PROMPTS = {
    "inkwriter": "你是墨小鸦，一位精通小红书文案的撰稿人..."  # 手工编写
}
```

**问题**：
- 提示词质量取决于人类工程师的经验
- 改一句 prompt 需要跑全量测试验证，周期长
- 没有量化指标衡量"这版 prompt 比上一版好多少"
- 10只龙虾×多种任务类型 = 100+ prompt 组合，人工调参不可持续

**DSPy 解决**：
- **声明式**：定义输入/输出 Signature，不写 prompt 模板
- **自动优化**：基于标注数据集 + 评估指标，自动搜索最优 prompt
- **模块化**：龙虾技能 = DSPy Module，可组合、可复用
- **实验追踪**：每次优化有量化 score，可对比历史版本

---

## 二、龙虾技能 → DSPy Module

```python
# dragon-senate-saas-v2/dspy_lobster_modules.py（新建）
"""
将龙虾技能封装为 DSPy Module
每只龙虾的核心技能 = 一个 DSPy Signature + Module

DSPy 会自动优化这些 Module 的内部 prompt
"""

import dspy


# ═══ 龙虾技能 Signature（声明式输入输出） ═══

class XiaohongshuCopywriting(dspy.Signature):
    """为小红书平台撰写高互动率的种草文案"""
    
    product_info: str = dspy.InputField(desc="产品信息和卖点")
    target_audience: str = dspy.InputField(desc="目标人群画像")
    tone: str = dspy.InputField(desc="语气风格：种草/测评/分享/教程")
    
    title: str = dspy.OutputField(desc="标题（15-20字，含emoji，引发好奇）")
    content: str = dspy.OutputField(desc="正文（200-500字，分段，含emoji和话题标签）")
    hashtags: list[str] = dspy.OutputField(desc="话题标签列表（3-5个）")


class MarketAnalysis(dspy.Signature):
    """分析市场竞品和热点趋势"""
    
    industry: str = dspy.InputField(desc="行业领域")
    competitor_data: str = dspy.InputField(desc="竞品数据摘要")
    
    trends: list[str] = dspy.OutputField(desc="当前热点趋势（3-5条）")
    opportunities: list[str] = dspy.OutputField(desc="差异化机会点")
    risk_factors: list[str] = dspy.OutputField(desc="潜在风险")


class ContentStrategy(dspy.Signature):
    """制定内容营销策略"""
    
    brand_info: str = dspy.InputField(desc="品牌信息")
    market_intel: str = dspy.InputField(desc="市场情报")
    budget: str = dspy.InputField(desc="预算范围")
    
    strategy: str = dspy.OutputField(desc="策略方案（含目标、渠道、时间表）")
    kpi_targets: dict = dspy.OutputField(desc="KPI 目标数值")


class ReplyGeneration(dspy.Signature):
    """生成评论区互动回复"""
    
    original_comment: str = dspy.InputField(desc="原始评论内容")
    brand_voice: str = dspy.InputField(desc="品牌语气风格")
    context: str = dspy.InputField(desc="帖子上下文")
    
    reply: str = dspy.OutputField(desc="回复文本（自然、有温度、不超过100字）")


# ═══ 龙虾 Module（可被 DSPy 优化） ═══

class InkwriterModule(dspy.Module):
    """墨小鸦 Module：小红书文案撰写"""
    
    def __init__(self):
        self.generate = dspy.ChainOfThought(XiaohongshuCopywriting)
    
    def forward(self, product_info, target_audience, tone="种草"):
        return self.generate(
            product_info=product_info,
            target_audience=target_audience,
            tone=tone,
        )


class RadarModule(dspy.Module):
    """林涛 Module：市场分析"""
    
    def __init__(self):
        self.analyze = dspy.ChainOfThought(MarketAnalysis)
    
    def forward(self, industry, competitor_data):
        return self.analyze(
            industry=industry,
            competitor_data=competitor_data,
        )


class StrategistModule(dspy.Module):
    """苏丝 Module：内容策略"""
    
    def __init__(self):
        self.strategize = dspy.ChainOfThought(ContentStrategy)
    
    def forward(self, brand_info, market_intel, budget):
        return self.strategize(
            brand_info=brand_info,
            market_intel=market_intel,
            budget=budget,
        )


class EchoerModule(dspy.Module):
    """阿声 Module：评论回复"""
    
    def __init__(self):
        self.reply = dspy.ChainOfThought(ReplyGeneration)
    
    def forward(self, original_comment, brand_voice, context):
        return self.reply(
            original_comment=original_comment,
            brand_voice=brand_voice,
            context=context,
        )
```

---

## 三、自动优化流程

```python
# dragon-senate-saas-v2/dspy_optimizer.py（新建）
"""
DSPy 优化器：基于标注数据自动搜索最优 prompt
"""

import dspy
from dspy.teleprompt import MIPROv2
from dspy.evaluate import Evaluate


def optimize_inkwriter():
    """优化墨小鸦的小红书文案提示词"""
    
    # 1. 配置 LLM
    lm = dspy.LM("anthropic/claude-sonnet-4-5")
    dspy.configure(lm=lm)
    
    # 2. 加载训练数据（从 dataset_store.py）
    trainset = load_training_examples("inkwriter", "xiaohongshu_copy")
    # 格式：[dspy.Example(product_info=..., target_audience=..., title=..., content=...)]
    
    # 3. 定义评估指标
    def quality_metric(example, prediction, trace=None):
        """综合评估文案质量"""
        score = 0
        
        # 标题长度（15-20字得满分）
        title_len = len(prediction.title)
        if 15 <= title_len <= 20:
            score += 25
        elif 10 <= title_len <= 25:
            score += 15
        
        # 正文长度（200-500字得满分）
        content_len = len(prediction.content)
        if 200 <= content_len <= 500:
            score += 25
        
        # 含 emoji
        if any(ord(c) > 0x1F600 for c in prediction.title):
            score += 15
        
        # 含话题标签
        if prediction.hashtags and len(prediction.hashtags) >= 3:
            score += 15
        
        # 与参考答案的相似度（如有）
        if hasattr(example, 'content'):
            # 用 LLM 做语义相似度判断
            judge = dspy.ChainOfThought("reference, generated -> score: float")
            result = judge(reference=example.content, generated=prediction.content)
            score += float(result.score) * 20
        
        return score / 100
    
    # 4. 运行优化
    optimizer = MIPROv2(
        metric=quality_metric,
        num_candidates=5,      # 生成5个候选 prompt
        num_threads=3,         # 3线程并行评估
        max_bootstrapped_demos=3,  # 最多3个 few-shot 示例
    )
    
    module = InkwriterModule()
    optimized = optimizer.compile(module, trainset=trainset)
    
    # 5. 保存优化结果
    optimized.save("optimized_inkwriter.json")
    
    return optimized


def load_training_examples(lobster_id: str, skill: str):
    """从 dataset_store 加载训练数据"""
    from .dataset_store import DatasetStore
    
    store = DatasetStore()
    raw = store.get_dataset(f"{lobster_id}_{skill}")
    
    return [
        dspy.Example(**item).with_inputs("product_info", "target_audience", "tone")
        for item in raw
    ]
```

---

## 四、与现有系统集成

```python
# prompt_registry.py — 新增 DSPy 模式
# 启动时检查是否有优化过的 Module，有则使用

async def get_lobster_module(lobster_id: str, skill: str):
    """获取龙虾技能 Module（优先用 DSPy 优化版）"""
    optimized_path = f"optimized_{lobster_id}_{skill}.json"
    
    if Path(optimized_path).exists():
        module = InkwriterModule()
        module.load(optimized_path)
        return module  # 使用优化版
    else:
        return InkwriterModule()  # 使用默认版
```

---

## 五、验收标准

- [ ] `InkwriterModule` 正确实现 DSPy Signature + ChainOfThought
- [ ] `optimize_inkwriter()` 完整执行优化流程（数据加载→评估→优化→保存）
- [ ] 优化后的 prompt 在 `quality_metric` 上比默认版提升 ≥10%
- [ ] 优化结果可持久化（`optimized_inkwriter.json`）并自动加载
- [ ] 至少为墨小鸦、苏丝、阿声 3只龙虾定义 DSPy Module
- [ ] 训练数据从 `dataset_store.py` 正确加载
- [ ] 与 `llm_call_logger.py` 集成：优化过程的 LLM 调用有日志
