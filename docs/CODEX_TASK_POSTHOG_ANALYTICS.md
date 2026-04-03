# CODEX TASK: PostHog 分析能力落地包（P1-3 ～ P1-6）

**优先级：P1**  
**来源：POSTHOG_BORROWING_ANALYSIS.md P1-3 + P1-4 + P1-5 + P1-6**  
**借鉴自**：PostHog `scenes/marketing-analytics/` + `scenes/funnels/` + `scenes/surveys/` + `scenes/agentic/`

---

## P1-3: 营销渠道 ROI 归因面板

**落地路径**：前端 `/analytics/attribution` + 后端 `dragon-senate-saas-v2/attribution_engine.py`

### 功能说明

PostHog `scenes/marketing-analytics/` 提供渠道分析/归因/ROI。  
我们对应：**哪个渠道/哪只龙虾带来了最多高意向线索和最终转化**。

**归因模型（参考 PostHog）**：
- **首次接触**（First Touch）：线索第一次出现在哪个渠道
- **末次接触**（Last Touch）：转化前最后一个接触点
- **线性归因**（Linear）：所有接触点平均分配
- **U型归因**（U-Shape）：首次+末次各40%，中间20%

```python
# dragon-senate-saas-v2/attribution_engine.py
from enum import Enum

class AttributionModel(str, Enum):
    FIRST_TOUCH = "first_touch"
    LAST_TOUCH = "last_touch"
    LINEAR = "linear"
    U_SHAPE = "u_shape"

class AttributionEngine:
    """营销渠道 ROI 归因引擎"""

    def attribute(
        self,
        touchpoints: list[dict],   # [{"channel": "feishu", "lobster": "radar", "timestamp": ...}]
        conversion_value: float,
        model: AttributionModel = AttributionModel.U_SHAPE
    ) -> dict[str, float]:
        """计算每个接触点的归因价值"""
        if not touchpoints:
            return {}
        n = len(touchpoints)
        weights = self._get_weights(n, model)
        result = {}
        for i, tp in enumerate(touchpoints):
            key = f"{tp['channel']}:{tp.get('lobster', 'unknown')}"
            result[key] = result.get(key, 0) + conversion_value * weights[i]
        return result

    def _get_weights(self, n: int, model: AttributionModel) -> list[float]:
        if n == 1:
            return [1.0]
        if model == AttributionModel.FIRST_TOUCH:
            return [1.0] + [0.0] * (n - 1)
        if model == AttributionModel.LAST_TOUCH:
            return [0.0] * (n - 1) + [1.0]
        if model == AttributionModel.LINEAR:
            return [1.0 / n] * n
        # U_SHAPE
        if n == 2:
            return [0.5, 0.5]
        mid = [0.2 / (n - 2)] * (n - 2)
        return [0.4] + mid + [0.4]
```

### 前端面板指标
- 渠道对比：曝光/线索数/高意向率/转化率/ROI
- 龙虾归因：哪只龙虾在哪个阶段贡献最大
- 时间趋势：各渠道日/周/月趋势折线图
- 归因模型切换（下拉选择不同模型，图表实时更新）

### 验收标准
- [ ] `AttributionEngine` 支持4种归因模型
- [ ] `GET /api/v1/analytics/attribution?model=u_shape&start=&end=` 返回归因结果
- [ ] 前端渠道对比表格（按 ROI 排序，支持钻取）
- [ ] 归因模型切换不刷页（客户端重算权重）

---

## P1-4: 龙虾工作流漏斗分析

**落地路径**：前端 `/analytics/funnel` + 后端 `dragon-senate-saas-v2/funnel_analyzer.py`

### 功能说明

PostHog `scenes/funnels/` 做用户行为漏斗。我们对应：**龙虾工作流每步完成率/流失点**。

```
信号采集(radar) → 策略制定(strategist) → 内容生成(inkwriter)
    → 首次触达(echoer) → 线索识别(catcher) → 持续跟进(followup) → 转化
```

```python
# dragon-senate-saas-v2/funnel_analyzer.py
from dataclasses import dataclass
from typing import Optional

@dataclass
class FunnelStep:
    step_name: str
    lobster_id: str
    count: int = 0
    drop_off: int = 0

    @property
    def conversion_rate(self) -> float:
        total = self.count + self.drop_off
        return self.count / total if total > 0 else 0.0

class FunnelAnalyzer:
    """工作流漏斗分析器"""

    def build_funnel(
        self,
        task_events: list[dict],   # 任务执行事件列表
        steps: list[str]           # 步骤顺序（lobster_id 列表）
    ) -> list[FunnelStep]:
        """从任务事件构建漏斗数据"""
        step_counts = {s: 0 for s in steps}
        for event in task_events:
            if event.get("lobster_id") in step_counts:
                step_counts[event["lobster_id"]] += 1

        result = []
        prev_count = None
        for s in steps:
            count = step_counts[s]
            drop = (prev_count - count) if prev_count is not None and prev_count > count else 0
            result.append(FunnelStep(step_name=s, lobster_id=s, count=count, drop_off=drop))
            prev_count = count
        return result
```

### 验收标准
- [ ] `GET /api/v1/analytics/funnel?start=&end=&tenant_id=` 返回各步骤数据
- [ ] 前端漏斗图（竖向条形，显示各步完成数/流失率）
- [ ] 点击某步骤 → 展示该步骤流失的任务列表
- [ ] 支持按时间范围/渠道/行业过滤

---

## P1-5: 用户调查系统（SurveyEngine）

**落地路径**：`dragon-senate-saas-v2/survey_engine.py`

### 功能说明

PostHog `scenes/surveys/` 支持 NPS/CSAT/开放题调查，按行为触发展示。  
我们落地：**龙虾产出评价 + 平台满意度调查**。

```python
# dragon-senate-saas-v2/survey_engine.py
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional

class SurveyType(str, Enum):
    NPS = "nps"             # 0-10 评分
    CSAT = "csat"           # 1-5 满意度
    OPEN = "open"           # 开放文本

@dataclass
class Survey:
    survey_id: str
    title: str
    survey_type: SurveyType
    trigger_event: str      # 触发事件："lobster_task_completed" | "followup_sent"
    trigger_conditions: dict = field(default_factory=dict)
    questions: list[dict] = field(default_factory=list)
    enabled: bool = True

@dataclass
class SurveyResponse:
    survey_id: str
    tenant_id: str
    respondent_id: str
    answers: dict           # {question_id: answer}
    lobster_task_id: Optional[str] = None
    score: Optional[float] = None   # NPS/CSAT 分数

class SurveyEngine:
    async def should_trigger(self, event: dict, survey: Survey) -> bool:
        """判断是否应触发调查"""
        if not survey.enabled:
            return False
        if event.get("event_type") != survey.trigger_event:
            return False
        for k, v in survey.trigger_conditions.items():
            if event.get(k) != v:
                return False
        return True

    async def record_response(self, response: SurveyResponse) -> dict:
        """记录调查回答，计算 NPS/CSAT 得分"""
        if response.answers:
            score_val = list(response.answers.values())[0]
            if isinstance(score_val, (int, float)):
                response.score = float(score_val)
        # 存储到数据库...
        return {"survey_id": response.survey_id, "score": response.score}

    async def get_nps_score(self, tenant_id: str, survey_id: str) -> dict:
        """计算 NPS = 推荐者% - 批评者%"""
        # 从数据库查询所有回答...
        # promoters = score >= 9, detractors = score <= 6
        return {"nps": 0, "promoters_pct": 0, "detractors_pct": 0}
```

**内置调查场景**：
- 龙虾任务完成后 → "这次内容产出满意吗？" (CSAT 1-5)
- followup 发送后 → "这条跟进消息适合你的情况吗？" (CSAT)
- 用户使用30天 → NPS 调查 "你会把我们推荐给同行吗？"

### 验收标准
- [ ] `Survey` 定义 + `SurveyEngine` 触发逻辑
- [ ] NPS / CSAT 分数自动计算
- [ ] `GET /api/v1/surveys/{id}/results` 返回汇总结果
- [ ] 前端调查弹窗组件（任务完成后触发，不打扰主流程）
- [ ] 调查回答写入 `tenant_audit_log` 供分析

---

## P1-6: 对话式数据查询（Max 模式）

**落地路径**：前端 AI 助手悬浮框 + `dragon-senate-saas-v2/nl_query_engine.py`

### 功能说明

PostHog `scenes/agentic/` 的 Max AI 助手：自然语言 → SQL 查询 → 可视化结果。  
我们落地：**自然语言查询龙虾运营数据**。

```
用户输入："本周哪只龙虾产出最多高意向线索？"
  → NL→Query 解析
  → 查询 task_events + lead_scores
  → 返回表格/图表 + 文字摘要
```

```python
# dragon-senate-saas-v2/nl_query_engine.py
QUERY_SYSTEM_PROMPT = """你是龙虾运营数据分析助手。
可查询的数据：龙虾任务/线索评分/渠道信号/工作流漏斗/A/B实验结果。
将用户问题转为结构化查询参数（JSON格式），不要编造数据。

输出格式：
{"query_type": "lobster_stats|lead_funnel|channel_attribution|experiment_results",
 "filters": {"tenant_id": "...", "start_date": "...", "end_date": "...", "lobster_id": "..."},
 "metrics": ["task_count", "lead_score_avg", "conversion_rate"],
 "group_by": ["lobster_id", "channel", "date"]}
"""

class NLQueryEngine:
    def __init__(self, llm_client, data_service):
        self.llm = llm_client
        self.data = data_service

    async def query(self, natural_language: str, tenant_id: str) -> dict:
        # 1. NL → 结构化参数
        parsed = await self.llm.complete(
            system=QUERY_SYSTEM_PROMPT,
            user=natural_language
        )
        # 2. 执行查询
        results = await self.data.execute_query(parsed, tenant_id)
        # 3. 生成摘要
        summary = await self.llm.complete(
            system="根据查询结果，用一两句话回答用户问题。",
            user=f"问题：{natural_language}\n数据：{results}"
        )
        return {"query": parsed, "data": results, "summary": summary}
```

**支持的问题类型**：
- "今天有多少新线索？" → 实时线索统计
- "followup 虾本周回复率多少？" → 龙虾指标
- "哪个行业的转化率最高？" → 行业分析
- "A/B 实验 EXP-001 结果如何？" → 实验结果

### 验收标准
- [ ] `NLQueryEngine.query()` NL→参数→数据→摘要完整链路
- [ ] 前端 AI 助手悬浮框（输入框 + 结果展示）
- [ ] 支持5种查询类型（龙虾/线索/渠道/漏斗/实验）
- [ ] 结果自动选择展示方式（表格/折线图/数字卡片）
- [ ] 查询历史记录（可重复执行）

---

*Codex Task | 来源：POSTHOG_BORROWING_ANALYSIS.md P1-3~P1-6 | 2026-04-02*
