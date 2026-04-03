# CODEX TASK: Instructor 结构化输出护卫 + 损耗率降低指南
**任务ID**: CODEX-INSTRUCTOR-001  
**优先级**: 🟠 P1（降低 AI 成本，每席节省 ¥274/月）  
**依赖文件**: `dragon-senate-saas-v2/lobster_runner.py`, `llm_quality_judge.py`, `base_lobster.py`  
**参考项目**: Instructor（https://github.com/instructor-ai/instructor）  
**预计工期**: 2天

---

## 一、任务背景

V7 成本模型中，内容损耗缓冲是 **¥100/席/月**（从 ¥784 直接成本中分出）：
- 视频成本：¥15/条 × 2x 损耗 = ¥30/条（20条/席 = ¥600/席）
- 图片成本：¥0.29/张 × 2x 损耗 = ¥0.58/张（30张/席 = ¥17.4/席）
- 损耗主要原因：龙虾 LLM 输出格式不合规 → 重做/跳过

**Instructor 可以解决的问题**：
- 强制 LLM 输出 Pydantic 结构（100% 合法 JSON）
- 内置自动重试（最多3次，直到输出合规）
- 告别手写正则解析（`_parse_tool_calls` 的脆弱正则）

**财务影响**：
- 损耗率从 2x 降到 1.3x（视频成本从 ¥600 降到 ¥390/席）
- 每席节省 ≈ ¥274/月
- 1000席时 = **每月节省 ¥274,000**

---

## 二、架构改造

### 改造前（当前状态）

```python
# 当前 base_lobster.py 的输出解析（脆弱正则）
def _parse_tool_calls(self, response_text: str) -> list:
    # 正则匹配 JSON 块
    pattern = r'\{[^{}]*"tool"[^{}]*\}'
    matches = re.findall(pattern, response_text)
    results = []
    for m in matches:
        try:
            results.append(json.loads(m))
        except json.JSONDecodeError:
            pass  # 静默失败 → 导致损耗
    return results
```

**问题**：LLM 偶尔输出格式错误 → 解析失败 → 任务重做 → 损耗翻倍

### 改造后（Instructor 方案）

```python
# 使用 Instructor 强制结构化输出
import instructor
from anthropic import Anthropic
from pydantic import BaseModel, Field

# Instructor 包装 Anthropic 客户端（一行代码）
client = instructor.from_anthropic(Anthropic())

# LLM 调用直接返回 Pydantic 对象，保证 100% 合法
response = client.messages.create(
    model="claude-sonnet-4-5",
    max_tokens=4096,
    messages=[{"role": "user", "content": prompt}],
    response_model=CopyPack,  # Pydantic 模型
)
# response 直接是 CopyPack 实例，不需要任何解析
```

---

## 三、龙虾输出格式 Pydantic 化

### Step 1：定义各龙虾的输出 Pydantic 模型

```python
# dragon-senate-saas-v2/lobster_output_schemas.py
"""
10只龙虾的结构化输出 Schema（Pydantic v2）
配合 Instructor 使用，保证 LLM 输出 100% 合规

V7 成本影响：
  损耗率 2x → 1.3x，视频成本每席 ¥600 → ¥390
  每席每月节省 ¥274
"""

from pydantic import BaseModel, Field
from typing import Optional, List, Literal
from enum import Enum


# ─── 通用基础 Schema ──────────────────────────────────────

class OutputQuality(str, Enum):
    HIGH = "high"
    MEDIUM = "medium"  
    LOW = "low"
    NEEDS_REVISION = "needs_revision"


# ─── Commander（陈指挥）— 任务调度 ─────────────────────────

class RoutePlan(BaseModel):
    """Commander 输出：任务路由计划"""
    lobster_sequence: List[str] = Field(
        description="龙虾执行顺序，如 ['radar', 'strategist', 'inkwriter']",
        min_length=1,
        max_length=10,
    )
    parallel_groups: Optional[List[List[str]]] = Field(
        default=None,
        description="可并行执行的龙虾组，如 [['radar', 'abacus'], ['inkwriter']]",
    )
    priority: Literal["urgent", "normal", "batch"] = "normal"
    estimated_duration_minutes: int = Field(ge=1, le=120)
    reason: str = Field(description="路由决策理由（1-2句话）", max_length=500)


# ─── Radar（林涛）— 市场情报 ───────────────────────────────

class MarketSignal(BaseModel):
    """单条市场信号"""
    signal_type: Literal["trending_topic", "competitor_move", "user_sentiment", "platform_rule_change"]
    title: str = Field(max_length=100)
    content: str = Field(max_length=500)
    urgency: Literal["urgent", "normal", "low"] = "normal"
    source: Optional[str] = Field(default=None, max_length=200)
    action_required: bool = False

class SignalBrief(BaseModel):
    """Radar 输出：市场信号简报"""
    signals: List[MarketSignal] = Field(min_length=1, max_length=10)
    summary: str = Field(description="一句话总结", max_length=200)
    recommended_response: str = Field(
        description="建议的下一步行动（给 commander 看的）",
        max_length=300,
    )
    quality: OutputQuality = OutputQuality.HIGH


# ─── Strategist（苏思）— 增长策略 ──────────────────────────

class ContentStrategy(BaseModel):
    """Strategist 输出：内容策略方案"""
    campaign_theme: str = Field(description="本期内容主题", max_length=100)
    target_audience: str = Field(description="目标受众画像", max_length=200)
    key_messages: List[str] = Field(
        description="核心传播信息点（3-5条）",
        min_length=1,
        max_length=5,
    )
    content_mix: dict = Field(
        description="内容类型配比，如 {'video': 60, 'image_post': 30, 'text': 10}",
        default={"video": 60, "image_post": 30, "text": 10}
    )
    kpi_targets: dict = Field(
        description="本期 KPI 目标，如 {'views': 10000, 'engagement_rate': 0.05}",
    )
    risk_factors: Optional[List[str]] = Field(
        default=None,
        description="潜在风险点",
        max_length=3,
    )


# ─── InkWriter（墨小雅）— 内容创作 ────────────────────────

class ContentPiece(BaseModel):
    """单条内容"""
    content_type: Literal["video_script", "image_caption", "comment_reply", "dm_message"]
    title: Optional[str] = Field(default=None, max_length=50)
    body: str = Field(description="正文内容", max_length=2000)
    hashtags: List[str] = Field(
        default_factory=list,
        description="话题标签（不含#号）",
        max_length=10,
    )
    cta: Optional[str] = Field(
        default=None,
        description="行动呼吁（点赞/评论/收藏）",
        max_length=50,
    )
    tone: Literal["professional", "casual", "emotional", "humorous"] = "casual"

class CopyPack(BaseModel):
    """InkWriter 输出：文案包"""
    pieces: List[ContentPiece] = Field(min_length=1, max_length=20)
    brand_voice_compliance: float = Field(
        ge=0.0, le=1.0,
        description="品牌调性匹配度（0-1）",
    )
    quality: OutputQuality = OutputQuality.HIGH
    revision_notes: Optional[str] = Field(default=None, max_length=300)


# ─── Visualizer（影子）— 视觉创意 ─────────────────────────

class VisualBrief(BaseModel):
    """Visualizer 输出：视觉创作简报"""
    video_concept: Optional[str] = Field(
        default=None,
        description="视频概念描述（给 Seedance 的 prompt）",
        max_length=500,
    )
    image_prompts: List[str] = Field(
        default_factory=list,
        description="图片生成 prompt 列表（给 Imagen 4 的）",
        max_length=10,
    )
    cover_style: Optional[str] = Field(
        default=None,
        description="封面风格描述",
        max_length=200,
    )
    color_palette: List[str] = Field(
        default_factory=list,
        description="推荐色调（十六进制颜色码）",
        max_length=5,
    )
    reference_urls: Optional[List[str]] = Field(default=None, max_length=3)


# ─── Dispatcher（老坚）— 任务协调 ─────────────────────────

class ExecutionPlan(BaseModel):
    """Dispatcher 输出：边缘执行计划"""
    platform: Literal["xiaohongshu", "douyin", "weixin_video", "weixin_gzh"]
    content_type: Literal["video", "image_post", "text_post"]
    publish_time: str = Field(description="发布时间 ISO 格式，如 2026-04-05T18:30:00")
    steps: List[str] = Field(
        description="执行步骤（自然语言，边缘执行器按步骤操作）",
        min_length=1,
        max_length=20,
    )
    media_asset_ids: List[str] = Field(
        description="需要的媒体资产 ID（从 artifact_store 获取）",
    )
    fallback_action: Literal["retry", "skip", "notify"] = "retry"
    priority: int = Field(ge=1, le=10, default=5)


# ─── Echoer（阿声）— 客服互动 ─────────────────────────────

class InteractionResponse(BaseModel):
    """Echoer 输出：互动回复"""
    target_id: str = Field(description="目标用户ID或评论ID")
    interaction_type: Literal["comment_reply", "dm_reply", "dm_proactive"]
    reply_text: str = Field(max_length=500)
    sentiment: Literal["warm", "professional", "empathetic", "enthusiastic"] = "warm"
    include_cta: bool = Field(default=False, description="是否包含引导购买/询价的话术")
    follow_up_needed: bool = Field(default=False)


# ─── Catcher（铁钩）— 商机捕获 ────────────────────────────

class LeadCapture(BaseModel):
    """Catcher 输出：商机捕获结果"""
    user_id: str
    platform: str
    lead_quality: Literal["hot", "warm", "cold"] = "warm"
    intent_signals: List[str] = Field(
        description="意向信号（如'问价格'、'问规格'）",
        max_length=5,
    )
    recommended_action: Literal["dm_immediately", "dm_within_1h", "add_to_followup", "skip"]
    dm_script: Optional[str] = Field(default=None, max_length=300)


# ─── Followup（小锤）— 客户跟进 ──────────────────────────

class FollowupPlan(BaseModel):
    """Followup 输出：跟进计划"""
    customer_id: str
    followup_reason: str = Field(max_length=200)
    contact_method: Literal["dm", "phone_heygen", "wechat"]
    script: str = Field(description="跟进话术", max_length=500)
    optimal_time: str = Field(description="建议联系时间，如 '明天上午10点'", max_length=50)
    expected_outcome: Literal["close_deal", "nurture", "collect_info", "schedule_demo"]


# ─── Abacus（算无遗策）— 数据复盘 ────────────────────────

class PerformanceReport(BaseModel):
    """Abacus 输出：效果复盘报告"""
    period: str = Field(description="复盘周期，如 '2026-04 周一至周五'")
    kpi_actuals: dict = Field(description="实际 KPI 数据")
    kpi_targets: dict = Field(description="目标 KPI 数据")
    achievement_rate: float = Field(ge=0.0, description="综合达成率")
    top_content: List[str] = Field(description="表现最好的内容 ID", max_length=3)
    insights: List[str] = Field(description="关键洞察（3-5条）", min_length=1, max_length=5)
    next_period_recommendations: List[str] = Field(max_length=3)
    quality: OutputQuality = OutputQuality.HIGH
```

### Step 2：改造 `lobster_runner.py` — 接入 Instructor

```python
# dragon-senate-saas-v2/lobster_runner.py — 核心改造

import instructor
from anthropic import Anthropic
from pydantic import BaseModel, ValidationError
from typing import Type, TypeVar
from lobster_output_schemas import (
    RoutePlan, SignalBrief, ContentStrategy, CopyPack,
    VisualBrief, ExecutionPlan, InteractionResponse,
    LeadCapture, FollowupPlan, PerformanceReport
)

T = TypeVar("T", bound=BaseModel)

# 龙虾名称 → 输出 Schema 映射
LOBSTER_OUTPUT_SCHEMAS = {
    "commander":  RoutePlan,
    "radar":      SignalBrief,
    "strategist": ContentStrategy,
    "inkwriter":  CopyPack,
    "visualizer": VisualBrief,
    "dispatcher": ExecutionPlan,
    "echoer":     InteractionResponse,
    "catcher":    LeadCapture,
    "followup":   FollowupPlan,
    "abacus":     PerformanceReport,
}

class LobsterRunner:
    
    def __init__(self):
        # Instructor 包装 Anthropic 客户端
        raw_client = Anthropic()
        self.client = instructor.from_anthropic(raw_client)
    
    async def run_lobster(
        self,
        lobster_name: str,
        system_prompt: str,
        user_prompt: str,
        model: str = "claude-sonnet-4-5",
        max_retries: int = 3,  # Instructor 自动重试
    ) -> BaseModel:
        """
        执行龙虾调用，返回结构化输出（Pydantic 对象）
        
        Instructor 特性：
        - 自动检测输出是否符合 Schema
        - 不符合则自动重试（携带上次错误信息）
        - 最多重试 max_retries 次
        - 超出重试次数才抛出 InstructorRetryException
        
        V7 成本影响：
          重试在同一次 API 调用链内完成，比人工重做节省：
          - 重做视频：¥30/条 × 损耗率 0.7 = 节省 ¥21/条
          - 20条/席 → 每席节省 ¥420（从损耗2x到1.3x）
        """
        output_schema = LOBSTER_OUTPUT_SCHEMAS.get(lobster_name)
        if not output_schema:
            raise ValueError(f"未知龙虾：{lobster_name}")
        
        try:
            result = self.client.messages.create(
                model=model,
                max_tokens=4096,
                max_retries=max_retries,  # Instructor 内置重试
                system=system_prompt,
                messages=[{"role": "user", "content": user_prompt}],
                response_model=output_schema,
            )
            
            # 记录到 llm_call_logger（已有）
            await self._log_call(lobster_name, user_prompt, result, success=True)
            
            return result
            
        except instructor.exceptions.InstructorRetryException as e:
            # 重试 max_retries 次后仍失败
            await self._log_call(lobster_name, user_prompt, None, success=False, error=str(e))
            raise
    
    async def run_lobster_batch(
        self,
        lobster_name: str,
        system_prompt: str,
        user_prompts: list[str],
        concurrency: int = 3,
    ) -> list[BaseModel]:
        """
        批量执行龙虾（并发控制）
        场景：一次为100个席位的inkwriter生成文案
        """
        import asyncio
        semaphore = asyncio.Semaphore(concurrency)
        
        async def run_one(prompt: str) -> BaseModel:
            async with semaphore:
                return await self.run_lobster(lobster_name, system_prompt, prompt)
        
        results = await asyncio.gather(
            *[run_one(p) for p in user_prompts],
            return_exceptions=True,
        )
        
        # 统计成功率
        successes = [r for r in results if not isinstance(r, Exception)]
        failures = [r for r in results if isinstance(r, Exception)]
        
        await self._log_batch_stats(lobster_name, len(successes), len(failures))
        
        return successes
    
    async def _log_call(self, lobster: str, prompt: str, result, success: bool, error: str = None):
        """记录到 llm_call_logger（已有模块）"""
        from llm_call_logger import LLMCallLogger
        logger = LLMCallLogger()
        await logger.log(
            lobster=lobster,
            prompt_preview=prompt[:200],
            output_schema=LOBSTER_OUTPUT_SCHEMAS[lobster].__name__,
            success=success,
            error=error,
            instructor_enabled=True,
        )
    
    async def _log_batch_stats(self, lobster: str, successes: int, failures: int):
        """记录批量执行统计"""
        pass  # 接入 observability_api
```

### Step 3：改造 `base_lobster.py` — 替换正则解析

```python
# dragon-senate-saas-v2/lobsters/base_lobster.py — 修改 _invoke_llm 方法

class BaseLobster:
    
    def __init__(self, lobster_name: str):
        self.lobster_name = lobster_name
        self._runner = None  # 懒加载
    
    @property
    def runner(self):
        if self._runner is None:
            from lobster_runner import LobsterRunner
            self._runner = LobsterRunner()
        return self._runner
    
    async def invoke(self, user_input: str) -> dict:
        """统一入口，返回结构化输出字典"""
        system_prompt = self._build_system_prompt()
        user_prompt = self._build_user_prompt(user_input)
        
        try:
            # Instructor 强制结构化输出
            result = await self.runner.run_lobster(
                lobster_name=self.lobster_name,
                system_prompt=system_prompt,
                user_prompt=user_prompt,
            )
            # Pydantic 对象转字典
            return result.model_dump()
        
        except Exception as e:
            # 降级：返回空结构（不崩溃，记录失败）
            return self._empty_output(error=str(e))
    
    # ── 以下方法保留用于 backward compatibility ──────────────
    
    def _build_system_prompt(self) -> str:
        """子类实现：构建 system prompt"""
        raise NotImplementedError
    
    def _build_user_prompt(self, user_input: str) -> str:
        """子类实现：构建 user prompt"""
        return user_input
    
    def _empty_output(self, error: str = None) -> dict:
        """失败时返回空输出结构"""
        from lobster_output_schemas import LOBSTER_OUTPUT_SCHEMAS, OutputQuality
        schema = LOBSTER_OUTPUT_SCHEMAS.get(self.lobster_name)
        if schema:
            try:
                return {"_error": error, "_fallback": True}
            except Exception:
                pass
        return {"_error": error, "_fallback": True}
```

---

## 四、成本追踪（接入现有 llm_quality_judge）

```python
# dragon-senate-saas-v2/llm_quality_judge.py — 新增损耗率追踪

class LLMQualityJudge:
    
    async def track_instructor_stats(self, period: str = "2026-04") -> dict:
        """
        统计 Instructor 重试次数和节省的成本
        
        用于验证"损耗率从2x降到1.3x"的实际效果
        """
        # 从 llm_call_logger 查询
        logs = await self.db.llm_calls.find({
            "period": period,
            "instructor_enabled": True,
        }).to_list()
        
        total_calls = len(logs)
        retry_calls = len([l for l in logs if l.get("retry_count", 0) > 0])
        failed_calls = len([l for l in logs if not l.get("success")])
        
        # 实际损耗率
        actual_loss_rate = 1 + (retry_calls * 0.3 + failed_calls) / max(total_calls, 1)
        
        # 与 2x 损耗率对比，节省的成本
        baseline_loss_rate = 2.0
        improvement = baseline_loss_rate - actual_loss_rate
        
        # V7 成本计算：每席视频成本
        seats = await self.db.subscriptions.count({"status": "active"})
        video_cost_per_seat_baseline = 20 * 15 * baseline_loss_rate  # 20条 × ¥15 × 2x
        video_cost_per_seat_actual = 20 * 15 * actual_loss_rate
        monthly_savings = (video_cost_per_seat_baseline - video_cost_per_seat_actual) * seats
        
        return {
            "period": period,
            "total_calls": total_calls,
            "retry_calls": retry_calls,
            "failed_calls": failed_calls,
            "success_rate": round((total_calls - failed_calls) / max(total_calls, 1) * 100, 1),
            "actual_loss_rate": round(actual_loss_rate, 2),
            "baseline_loss_rate": baseline_loss_rate,
            "improvement": round(improvement, 2),
            "active_seats": seats,
            "monthly_cost_savings": round(monthly_savings),
            "annual_cost_savings": round(monthly_savings * 12),
        }
```

---

## 五、依赖安装

```bash
# 新增依赖
pip install instructor>=1.0.0
pip install pydantic>=2.0.0  # 确保 v2

# instructor 支持多种 LLM 后端
# 我们使用 Anthropic（已有）
# pip install anthropic>=0.25.0  （已有）
```

---

## 六、迁移路径（渐进式）

```
阶段1（本次）：新建 lobster_output_schemas.py + 改造 lobster_runner.py
              Commander 和 InkWriter 优先接入（影响最大的两个）

阶段2（下周）：其余8只龙虾全部接入 Instructor
              base_lobster.py 全面切换

阶段3（下个月）：用 llm_quality_judge 验证损耗率下降效果
                如实测达到 1.3x，从 waste_buffer ¥100 降到 ¥50（每席节省 ¥50/月额外）
```

---

## 七、验收标准

- [ ] `lobster_output_schemas.py` 定义 10 只龙虾的 Pydantic Schema
- [ ] `lobster_runner.py` 接入 `instructor.from_anthropic()`
- [ ] Commander 调用返回合法 `RoutePlan`（不需要正则解析）
- [ ] InkWriter 调用返回合法 `CopyPack`（所有字段通过 Pydantic 验证）
- [ ] 模拟格式错误输出时 Instructor 自动重试（不超过3次）
- [ ] `llm_quality_judge.track_instructor_stats()` 返回损耗率统计
- [ ] 正式运行1周后，重试率 < 30%（证明 Schema 设计合理）
- [ ] 月度报告显示实际损耗率低于 1.5x（目标 1.3x）
