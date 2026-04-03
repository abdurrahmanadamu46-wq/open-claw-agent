# CODEX TASK: PostHog 借鉴 P2 合并任务包

**优先级：P2**  
**来源：POSTHOG_BORROWING_ANALYSIS.md P2-1 ～ P2-6**  
**借鉴自**：PostHog ⭐32.3k（产品分析/行为录制/特性标志/AI助手）

---

## P2-1: 线索 Cohort 自动分群（LeadCohort）

**借鉴自**：PostHog `scenes/cohorts/` — 按行为/属性自动维护用户群  
**落地路径**：`dragon-senate-saas-v2/lead_cohort.py`

### 功能说明
PostHog Cohort 按行为/属性自动维护用户分群，实时更新成员。  
我们落地：**线索自动分群**，让各龙虾针对性处理不同群体。

```python
# dragon-senate-saas-v2/lead_cohort.py
from dataclasses import dataclass, field
from enum import Enum

class CohortType(str, Enum):
    STATIC = "static"       # 手动维护
    DYNAMIC = "dynamic"     # 按规则自动更新

@dataclass
class CohortRule:
    """Cohort 匹配规则（参考 PostHog cohort filter）"""
    field: str          # "lead.score" | "lead.industry" | "lead.source"
    op: str             # "gte" | "eq" | "contains"
    value: object

@dataclass
class LeadCohort:
    cohort_id: str
    name: str
    cohort_type: CohortType = CohortType.DYNAMIC
    rules: list[CohortRule] = field(default_factory=list)
    member_ids: list[str] = field(default_factory=list)
    description: str = ""

# 内置预设 Cohort
PRESET_COHORTS = [
    LeadCohort("high_intent", "高意向线索", rules=[CohortRule("lead.score", "gte", 80)]),
    LeadCohort("churn_risk", "流失风险", rules=[CohortRule("last_contact_days", "gte", 14)]),
    LeadCohort("new_leads", "新线索（7天内）", rules=[CohortRule("created_days_ago", "lte", 7)]),
    LeadCohort("enterprise", "企业客户", rules=[CohortRule("lead.company_size", "gte", 100)]),
]
```

### 验收标准
- [ ] `LeadCohort` + 规则匹配引擎
- [ ] 4个内置预设 Cohort 自动计算成员
- [ ] `GET /api/v1/cohorts/{id}/members` 返回成员列表
- [ ] dispatcher 虾支持"按 Cohort 派发任务"
- [ ] 前端 Cohort 管理页（列表 + 成员数 + 规则配置）

---

## P2-2: 营销洞察 Notebook

**借鉴自**：PostHog `scenes/notebooks/` — 分析+文字混合的协作文档  
**落地路径**：前端 `/insights/notebooks` 页面

### 功能说明
PostHog Notebook 支持在一个文档里混合：图表/数据表格/Markdown 文字/内联洞察。  
我们落地：**营销洞察 Notebook** — 运营人员边看数据边写分析备注。

**Notebook 块类型（借鉴 PostHog）**：
```
- text_block:     Markdown 富文本（结论/备注/行动项）
- chart_block:    内嵌图表（漏斗/趋势/归因，引用 /analytics API）
- table_block:    数据表（线索列表/龙虾指标）
- lobster_block:  龙虾实时任务输出（直接内嵌到 Notebook）
- divider_block:  分割线
```

**API**：
```
GET  /api/v1/notebooks              # 列表
POST /api/v1/notebooks              # 创建
PUT  /api/v1/notebooks/{id}         # 更新（块级）
POST /api/v1/notebooks/{id}/share   # 生成分享链接
```

### 验收标准
- [ ] 支持5种块类型（text/chart/table/lobster/divider）
- [ ] 块拖拽排序（DnD）
- [ ] 自动保存（debounce 2s）
- [ ] 分享链接生成（只读访问）
- [ ] 导出为 Markdown / PDF

---

## P2-3: 边缘操作回放（OperationRecorder）

**借鉴自**：PostHog `scenes/session-recordings/` — 用户操作回放  
**落地路径**：`edge-runtime/operation_recorder.py`

### 功能说明
PostHog 录制用户在浏览器的每个操作（点击/输入/滚动）用于回放。  
我们落地：**边缘节点 Playwright 操作序列录制**，用于调试和审计。

```python
# edge-runtime/operation_recorder.py
import json
import time
from dataclasses import dataclass, field
from typing import Optional

@dataclass
class OperationEvent:
    """单次操作事件"""
    event_type: str         # "click" | "type" | "navigate" | "screenshot"
    timestamp: float = field(default_factory=time.time)
    selector: Optional[str] = None
    value: Optional[str] = None
    url: Optional[str] = None
    screenshot_b64: Optional[str] = None  # 截图（可选）
    duration_ms: Optional[float] = None

@dataclass
class OperationRecording:
    """完整操作录制"""
    recording_id: str
    task_id: str
    node_id: str
    tenant_id: str
    events: list[OperationEvent] = field(default_factory=list)
    started_at: float = field(default_factory=time.time)
    ended_at: Optional[float] = None

    def add_event(self, event: OperationEvent):
        self.events.append(event)

    def finish(self):
        self.ended_at = time.time()

    def to_dict(self) -> dict:
        return {
            "recording_id": self.recording_id,
            "task_id": self.task_id,
            "node_id": self.node_id,
            "duration_s": (self.ended_at or time.time()) - self.started_at,
            "event_count": len(self.events),
            "events": [vars(e) for e in self.events],
        }
```

### 验收标准
- [ ] `OperationRecorder` 在 `marionette_executor` 中自动录制
- [ ] 录制结果上传云端（压缩 JSON）
- [ ] 前端回放 UI：时间轴 + 操作列表（点击高亮）
- [ ] 支持按任务 ID 查询录制

---

## P2-4: 高流量事件采样（EventSampler）

**借鉴自**：PostHog `posthog/sampling.py`  
**落地路径**：`dragon-senate-saas-v2/event_sampler.py`

### 功能说明
PostHog 在高流量下对事件采样（保留统计代表性，丢弃部分原始数据）。  
我们在边缘节点高频信号涌入时，自动降频采样，保护后端。

```python
# dragon-senate-saas-v2/event_sampler.py
import hashlib
from typing import Optional

class EventSampler:
    """
    基于 hash 的确定性采样（同一事件 ID 始终得到相同结果）
    借鉴 PostHog sampling.py 设计
    """

    def __init__(self, sample_rate: float = 1.0):
        """sample_rate: 0.0-1.0，1.0=100%保留"""
        self.sample_rate = max(0.0, min(1.0, sample_rate))

    def should_sample(self, event_id: str) -> bool:
        if self.sample_rate >= 1.0:
            return True
        if self.sample_rate <= 0.0:
            return False
        hash_val = int(hashlib.md5(event_id.encode()).hexdigest()[:8], 16)
        return (hash_val / 0xFFFFFFFF) < self.sample_rate

    def get_sample_weight(self) -> float:
        """采样权重，用于统计推算（采样率25% → 权重4x）"""
        return 1.0 / self.sample_rate if self.sample_rate > 0 else 1.0
```

### 验收标准
- [ ] `EventSampler` 支持0-100%任意采样率
- [ ] 基于 hash 的确定性采样（同事件 ID 结果稳定）
- [ ] 采样权重计算（统计推算时补偿）
- [ ] 动态调整采样率（高负载时自动降至50%）

---

## P2-5: 边缘错误聚合（ErrorAggregator）

**借鉴自**：PostHog Error Tracking — 自动捕获异常，同类错误聚合  
**落地路径**：`dragon-senate-saas-v2/error_aggregator.py`

### 功能说明
PostHog Error Tracking 将同类错误（相同 stacktrace）聚合为一个 Issue，避免刷屏。  
我们落地：**边缘节点错误聚合**，同类 Playwright 错误聚合为一个 Issue。

```python
# dragon-senate-saas-v2/error_aggregator.py
import hashlib
from dataclasses import dataclass, field
from datetime import datetime

@dataclass
class ErrorIssue:
    """聚合后的错误 Issue"""
    issue_id: str               # hash(error_type + message[:100])
    error_type: str             # "PlaywrightTimeoutError"
    message: str
    first_seen: datetime = field(default_factory=datetime.utcnow)
    last_seen: datetime = field(default_factory=datetime.utcnow)
    occurrence_count: int = 1
    affected_nodes: set = field(default_factory=set)
    status: str = "open"        # "open" | "resolved" | "ignored"

class ErrorAggregator:
    def __init__(self):
        self._issues: dict[str, ErrorIssue] = {}

    def ingest(self, error_type: str, message: str, node_id: str) -> ErrorIssue:
        """摄取错误，聚合相同类型"""
        issue_id = hashlib.md5(f"{error_type}:{message[:100]}".encode()).hexdigest()[:16]
        if issue_id in self._issues:
            issue = self._issues[issue_id]
            issue.occurrence_count += 1
            issue.last_seen = datetime.utcnow()
            issue.affected_nodes.add(node_id)
        else:
            issue = ErrorIssue(
                issue_id=issue_id,
                error_type=error_type,
                message=message,
                affected_nodes={node_id}
            )
            self._issues[issue_id] = issue
        return issue

    def get_open_issues(self) -> list[ErrorIssue]:
        return [i for i in self._issues.values() if i.status == "open"]
```

### 验收标准
- [ ] `ErrorAggregator.ingest()` 聚合相同错误类型
- [ ] `GET /api/v1/errors/issues` 返回聚合 Issue 列表（按频次排序）
- [ ] Issue 状态管理（resolve/ignore）
- [ ] 前端错误追踪页（Issue 列表 + 出现次数 + 影响节点）

---

## P2-6: CDP 统一线索档案（LeadIdentityGraph）

**借鉴自**：PostHog `posthog/cdp/` — 跨渠道事件合并到同一用户 profile  
**落地路径**：`dragon-senate-saas-v2/lead_identity_graph.py`

### 功能说明
PostHog CDP 将同一用户在不同渠道/设备的行为合并为一个 profile。  
我们落地：**同一线索在微信/飞书/企微/电话等多渠道的所有接触记录合并**。

```python
# dragon-senate-saas-v2/lead_identity_graph.py
from dataclasses import dataclass, field

@dataclass
class LeadIdentity:
    """线索身份图谱"""
    lead_id: str                # 主 ID
    alias_ids: list[str] = field(default_factory=list)  # 同一人的其他 ID
    properties: dict = field(default_factory=dict)       # 合并后的属性
    touchpoints: list[dict] = field(default_factory=list)  # 所有接触点

class LeadIdentityGraph:
    """跨渠道线索身份合并"""

    async def identify(self, channel_id: str, channel: str, props: dict) -> str:
        """识别/创建线索主 ID"""
        ...

    async def merge(self, lead_id_1: str, lead_id_2: str) -> str:
        """合并两个线索为同一人（人工确认后执行）"""
        ...

    async def get_full_profile(self, lead_id: str) -> LeadIdentity:
        """获取跨渠道完整档案"""
        ...
```

### 验收标准
- [ ] `identify()` 按手机号/微信ID/企微ID识别唯一线索
- [ ] `merge()` 人工确认合并两个线索 ID
- [ ] `get_full_profile()` 返回跨渠道完整接触历史
- [ ] 前端线索详情页显示完整跨渠道时间线

---

*Codex Task | 来源：POSTHOG_BORROWING_ANALYSIS.md P2-1~P2-6 合并 | 2026-04-02*
