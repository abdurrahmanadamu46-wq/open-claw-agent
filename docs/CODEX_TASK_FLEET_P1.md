# CODEX TASK: Fleet 借鉴 P1 — 结构化活动流 + 动态标签 + Job注册中心 + 边缘Token轮换

**优先级：P1**  
**来源：FLEET_BORROWING_ANALYSIS.md P1-1 ~ P1-5**  
**借鉴自**：https://github.com/fleetdm/fleet（⭐6.2k）`server/activity/` + `server/fleet/labels.go` + `server/worker/` + `orbit/pkg/token/`

---

## A. 结构化活动流（ActivityStream）

**借鉴自**：Fleet `server/activity/` — 所有操作产生类型化活动记录，可推送 Webhook

### 背景
我们的 `tenant_audit_log.py` 是自由文本日志，Fleet 的设计是**类型化结构化活动**：每种操作是独立注册的类型，details 是 JSON，支持 Webhook 推送。

### `dragon-senate-saas-v2/activity_stream.py`

```python
"""
结构化活动流（借鉴 Fleet server/activity/ 设计）

核心设计理念：
  - 每种活动是独立类型（非自由文本）
  - 每个活动包含 actor（谁）+ activity_type（做了什么）+ details（结构化详情）
  - 活动可以推送到外部 Webhook（集成钉钉/飞书/企微通知）
"""
from __future__ import annotations
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Optional, Any
import json
import uuid


class ActivityType(str, Enum):
    # 龙虾相关
    LOBSTER_EXECUTED = "lobster_executed"           # 龙虾执行了一次任务
    LOBSTER_DISPATCHED = "lobster_dispatched"       # 线索被派发给龙虾
    LOBSTER_CONFIG_CHANGED = "lobster_config_changed"  # 龙虾配置变更
    LOBSTER_PAUSED = "lobster_paused"               # 龙虾暂停
    LOBSTER_RESUMED = "lobster_resumed"             # 龙虾恢复

    # 线索相关
    LEAD_CREATED = "lead_created"                   # 新线索进入
    LEAD_STATUS_CHANGED = "lead_status_changed"     # 线索状态变更
    LEAD_ASSIGNED = "lead_assigned"                 # 线索重新分配
    LEAD_CONVERTED = "lead_converted"               # 线索转化

    # 规则/策略相关
    RULE_CREATED = "rule_created"                   # 创建规则
    RULE_UPDATED = "rule_updated"                   # 修改规则
    RULE_DELETED = "rule_deleted"                   # 删除规则

    # 边缘节点相关
    EDGE_NODE_ENROLLED = "edge_node_enrolled"       # 边缘节点注册
    EDGE_NODE_OFFLINE = "edge_node_offline"         # 边缘节点下线
    EDGE_NODE_UPDATED = "edge_node_updated"         # 边缘节点更新

    # 系统相关
    EXPORT_COMPLETED = "export_completed"           # 导出完成
    WEBHOOK_DELIVERED = "webhook_delivered"         # Webhook 推送成功
    WEBHOOK_FAILED = "webhook_failed"               # Webhook 推送失败


@dataclass
class Activity:
    """结构化活动记录（借鉴 Fleet Activity 模型）"""
    activity_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    tenant_id: str = ""
    activity_type: ActivityType = ActivityType.LOBSTER_EXECUTED
    
    # Actor（谁做的）
    actor_type: str = "lobster"     # "lobster" | "operator" | "system" | "api"
    actor_id: str = ""              # 龙虾 ID / 操作员 ID
    actor_name: str = ""            # 龙虾名称 / 操作员姓名
    
    # Target（对谁做的）
    target_type: str = ""           # "lead" | "edge_node" | "rule" | "lobster"
    target_id: str = ""
    target_name: str = ""
    
    # 结构化详情
    details: dict = field(default_factory=dict)
    
    created_at: datetime = field(default_factory=datetime.utcnow)

    def to_dict(self) -> dict:
        return {
            "activity_id": self.activity_id,
            "tenant_id": self.tenant_id,
            "activity_type": self.activity_type.value,
            "actor_type": self.actor_type,
            "actor_id": self.actor_id,
            "actor_name": self.actor_name,
            "target_type": self.target_type,
            "target_id": self.target_id,
            "target_name": self.target_name,
            "details": self.details,
            "created_at": self.created_at.isoformat(),
        }

    def to_readable(self) -> str:
        """人类可读的活动描述"""
        templates = {
            ActivityType.LOBSTER_EXECUTED: "{actor_name} 执行了任务，线索：{target_name}",
            ActivityType.LOBSTER_DISPATCHED: "线索 {target_name} 被派发给 {actor_name}",
            ActivityType.RULE_CREATED: "{actor_name} 创建了规则：{target_name}",
            ActivityType.RULE_UPDATED: "{actor_name} 修改了规则：{target_name}",
            ActivityType.EDGE_NODE_ENROLLED: "边缘节点 {target_name} 完成注册",
            ActivityType.LEAD_CONVERTED: "线索 {target_name} 成功转化！",
        }
        template = templates.get(self.activity_type, "{actor_name} 执行了 {activity_type}")
        return template.format(
            actor_name=self.actor_name,
            target_name=self.target_name,
            activity_type=self.activity_type.value,
        )


class ActivityStream:
    """
    活动流管理器
    负责：记录活动 + 持久化 + 推送 Webhook
    """

    def __init__(self, store, webhook_bus=None):
        """
        Args:
            store: 活动存储接口（需有 save/list 方法）
            webhook_bus: Webhook 推送接口（webhook_event_bus.py）
        """
        self.store = store
        self.webhook_bus = webhook_bus

    async def record(
        self,
        tenant_id: str,
        activity_type: ActivityType,
        actor_type: str,
        actor_id: str,
        actor_name: str,
        target_type: str = "",
        target_id: str = "",
        target_name: str = "",
        details: dict = None,
    ) -> Activity:
        """记录一条活动（持久化 + 推送 Webhook）"""
        activity = Activity(
            tenant_id=tenant_id,
            activity_type=activity_type,
            actor_type=actor_type,
            actor_id=actor_id,
            actor_name=actor_name,
            target_type=target_type,
            target_id=target_id,
            target_name=target_name,
            details=details or {},
        )
        
        await self.store.save(activity)
        
        # 推送到 Webhook（非阻塞）
        if self.webhook_bus:
            await self.webhook_bus.publish(
                event_type=f"activity.{activity_type.value}",
                payload=activity.to_dict(),
                tenant_id=tenant_id,
            )
        
        return activity

    async def list_activities(
        self,
        tenant_id: str,
        activity_types: list[ActivityType] = None,
        actor_id: str = None,
        target_id: str = None,
        page: int = 1,
        per_page: int = 20,
    ) -> list[Activity]:
        """查询活动列表"""
        return await self.store.list(
            tenant_id=tenant_id,
            activity_types=[t.value for t in activity_types] if activity_types else None,
            actor_id=actor_id,
            target_id=target_id,
            offset=(page - 1) * per_page,
            limit=per_page,
        )


# 快捷方法（让龙虾代码更易用）
async def record_lobster_executed(stream: ActivityStream, tenant_id: str, lobster_id: str, lobster_name: str, lead_id: str, lead_name: str, details: dict = None):
    await stream.record(
        tenant_id=tenant_id,
        activity_type=ActivityType.LOBSTER_EXECUTED,
        actor_type="lobster", actor_id=lobster_id, actor_name=lobster_name,
        target_type="lead", target_id=lead_id, target_name=lead_name,
        details=details,
    )

async def record_rule_changed(stream: ActivityStream, tenant_id: str, operator_id: str, operator_name: str, rule_id: str, rule_name: str, change_type: str, details: dict = None):
    activity_type = ActivityType.RULE_UPDATED if change_type == "update" else (
        ActivityType.RULE_CREATED if change_type == "create" else ActivityType.RULE_DELETED
    )
    await stream.record(
        tenant_id=tenant_id,
        activity_type=activity_type,
        actor_type="operator", actor_id=operator_id, actor_name=operator_name,
        target_type="rule", target_id=rule_id, target_name=rule_name,
        details=details,
    )
```

**API 端点**：
```
GET  /api/v1/activities?type=&actor_id=&target_id=&page=   # 活动列表
GET  /api/v1/activities/{id}                                # 单条活动详情
```

**验收标准**：
- [ ] `ActivityStream.record()` 保存活动并推送 Webhook
- [ ] 至少支持 12 种 ActivityType（见 Enum）
- [ ] `lobster_runner.py` 中每次执行自动调用 `record_lobster_executed()`
- [ ] 规则 CRUD API 自动调用 `record_rule_changed()`
- [ ] 前端活动页：时间线展示（按 `created_at` 倒序）

---

## B. 动态标签系统（DynamicLabel）

**借鉴自**：Fleet `server/fleet/labels.go` — 动态查询条件自动维护成员

### `dragon-senate-saas-v2/dynamic_label.py`

```python
"""
动态标签系统（借鉴 Fleet Labels 设计）

核心设计：
  - 标签分两种：手动标签（人工添加成员）+ 动态标签（条件自动计算成员）
  - 动态标签条件每 N 分钟重新评估，成员自动更新
  - 标签可用于：龙虾筛选、规则触发条件、批量操作对象
"""
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Optional


class LabelType(str, Enum):
    MANUAL = "manual"       # 手动维护成员
    DYNAMIC = "dynamic"     # 条件动态计算成员


class LabelTargetType(str, Enum):
    LOBSTER = "lobster"     # 龙虾标签
    LEAD = "lead"           # 线索标签
    EDGE_NODE = "edge_node" # 边缘节点标签


@dataclass
class Label:
    """动态标签（借鉴 Fleet Label 模型）"""
    label_id: str
    tenant_id: str
    name: str                           # "高意向线索"
    description: str = ""
    label_type: LabelType = LabelType.DYNAMIC
    target_type: LabelTargetType = LabelTargetType.LEAD
    
    # 动态标签条件（JSON 描述的过滤条件）
    query_conditions: list[dict] = field(default_factory=list)
    # 例：[{"field": "score", "op": "gte", "value": 80}]
    
    # 成员列表（定期更新）
    member_ids: list[str] = field(default_factory=list)
    member_count: int = 0
    last_evaluated_at: Optional[datetime] = None
    
    created_by: str = ""
    created_at: datetime = field(default_factory=datetime.utcnow)

    def matches(self, obj: dict) -> bool:
        """判断对象是否符合标签条件（简化版）"""
        for cond in self.query_conditions:
            field_val = obj.get(cond["field"])
            op = cond["op"]
            val = cond["value"]
            if op == "eq" and field_val != val:
                return False
            elif op == "gte" and (field_val is None or field_val < val):
                return False
            elif op == "lte" and (field_val is None or field_val > val):
                return False
            elif op == "contains" and (field_val is None or val not in str(field_val)):
                return False
            elif op == "in" and field_val not in val:
                return False
        return True


class DynamicLabelManager:
    """动态标签管理器"""

    def __init__(self, store):
        self.store = store

    async def evaluate_label(self, label: Label, all_objects: list[dict]) -> Label:
        """重新评估标签成员（定期由 Cron 调用）"""
        if label.label_type != LabelType.DYNAMIC:
            return label
        
        new_members = [
            obj["id"] for obj in all_objects
            if label.matches(obj)
        ]
        label.member_ids = new_members
        label.member_count = len(new_members)
        label.last_evaluated_at = datetime.utcnow()
        
        await self.store.update_label_members(label.label_id, new_members)
        return label

    async def get_label_members(self, label_id: str, tenant_id: str) -> list[str]:
        """获取标签成员 ID 列表"""
        return await self.store.get_label_members(label_id, tenant_id)

    async def get_labels_for_object(self, obj_id: str, tenant_id: str) -> list[Label]:
        """获取某对象属于的所有标签"""
        return await self.store.get_labels_for_member(obj_id, tenant_id)
```

**预置动态标签示例**：
```python
PRESET_LABELS = [
    Label(label_id="preset-high-intent", name="高意向线索",
          query_conditions=[{"field": "score", "op": "gte", "value": 80}]),
    Label(label_id="preset-active-lobster", name="活跃龙虾",
          target_type=LabelTargetType.LOBSTER,
          query_conditions=[{"field": "status", "op": "eq", "value": "active"}]),
    Label(label_id="preset-offline-edge", name="离线边缘节点",
          target_type=LabelTargetType.EDGE_NODE,
          query_conditions=[{"field": "status", "op": "eq", "value": "offline"}]),
]
```

**验收标准**：
- [ ] `DynamicLabel` 支持手动/动态两种类型
- [ ] `evaluate_label()` 由 Cron 每 5 分钟执行一次
- [ ] 支持 3 种目标类型（龙虾/线索/边缘节点）
- [ ] API: `GET /api/v1/labels/{id}/members` 返回成员列表
- [ ] 前端标签页：列表 + 创建条件编辑器

---

## C. Job 注册中心（JobRegistry）

**借鉴自**：Fleet `server/worker/` — Job 注册模式，每种 job 是独立注册的类

### `dragon-senate-saas-v2/job_registry.py`

```python
"""
Job 注册中心（借鉴 Fleet server/worker/ 注册模式）

替换现有 task_queue.py 的字符串分发方式：
  现在：if task_type == "send_message": ...（硬编码 if/else）
  升级后：每种 job 是独立的类，注册到 JobRegistry，类型安全
"""
from __future__ import annotations
import json
import asyncio
import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime
from typing import Optional, Type

logger = logging.getLogger(__name__)


@dataclass
class JobResult:
    success: bool
    message: str = ""
    output: dict = None


class BaseJob(ABC):
    """所有后台 Job 的基类（借鉴 Fleet Job interface）"""

    @classmethod
    @abstractmethod
    def job_name(cls) -> str:
        """Job 唯一名称（用于注册和分发）"""
        ...

    @classmethod
    def max_retries(cls) -> int:
        """最大重试次数"""
        return 3

    @classmethod
    def retry_delay_seconds(cls) -> float:
        """重试间隔（秒）"""
        return 60.0

    @abstractmethod
    async def run(self, payload: dict) -> JobResult:
        """执行 Job 逻辑"""
        ...


# ===== 具体 Job 实现 =====

class SendMessageJob(BaseJob):
    """发送消息 Job"""
    
    @classmethod
    def job_name(cls) -> str:
        return "send_message"

    async def run(self, payload: dict) -> JobResult:
        # payload: {"lead_id": ..., "channel": ..., "content": ...}
        # 实际发送逻辑...
        return JobResult(success=True, message="消息已发送")


class ExtractMemoryJob(BaseJob):
    """记忆提取 Job（集成 MemoryExtractor）"""
    
    @classmethod
    def job_name(cls) -> str:
        return "extract_memory"

    @classmethod
    def max_retries(cls) -> int:
        return 1  # 记忆提取失败不重试（避免重复计费）

    async def run(self, payload: dict) -> JobResult:
        # payload: {"messages": [...], "lead_id": ..., "lobster_id": ...}
        return JobResult(success=True)


class EvaluateLabelsJob(BaseJob):
    """动态标签评估 Job"""
    
    @classmethod
    def job_name(cls) -> str:
        return "evaluate_labels"

    async def run(self, payload: dict) -> JobResult:
        # 重新评估所有动态标签的成员
        return JobResult(success=True)


class WebhookDeliveryJob(BaseJob):
    """Webhook 推送 Job（含重试）"""
    
    @classmethod
    def job_name(cls) -> str:
        return "webhook_delivery"

    @classmethod
    def max_retries(cls) -> int:
        return 5

    @classmethod
    def retry_delay_seconds(cls) -> float:
        return 30.0

    async def run(self, payload: dict) -> JobResult:
        # payload: {"url": ..., "event_type": ..., "data": ...}
        return JobResult(success=True)


# ===== Job 注册中心 =====

class JobRegistry:
    """
    Job 注册中心（借鉴 Fleet worker 注册模式）
    """
    
    _jobs: dict[str, Type[BaseJob]] = {}

    @classmethod
    def register(cls, job_class: Type[BaseJob]):
        """注册 Job 类型"""
        cls._jobs[job_class.job_name()] = job_class
        logger.info(f"[JobRegistry] 注册 Job: {job_class.job_name()}")

    @classmethod
    def get(cls, job_name: str) -> Optional[Type[BaseJob]]:
        """按名称获取 Job 类型"""
        return cls._jobs.get(job_name)

    @classmethod
    def list_jobs(cls) -> list[str]:
        return list(cls._jobs.keys())

    @classmethod
    async def dispatch(cls, job_name: str, payload: dict, queue=None) -> bool:
        """分发 Job 到队列"""
        job_class = cls.get(job_name)
        if not job_class:
            logger.error(f"[JobRegistry] 未知 Job 类型: {job_name}")
            return False
        # 推入队列（实际使用 Redis / task_queue.py）
        if queue:
            await queue.enqueue(job_name=job_name, payload=payload)
        return True


# 注册所有 Job（启动时执行一次）
def register_all_jobs():
    JobRegistry.register(SendMessageJob)
    JobRegistry.register(ExtractMemoryJob)
    JobRegistry.register(EvaluateLabelsJob)
    JobRegistry.register(WebhookDeliveryJob)
```

**验收标准**：
- [ ] `BaseJob` 基类定义 `job_name/max_retries/retry_delay/run`
- [ ] 4 种 Job 类型已注册（SendMessage/ExtractMemory/EvaluateLabels/WebhookDelivery）
- [ ] `task_queue.py` 的 if/else 分发替换为 `JobRegistry.dispatch()`
- [ ] Job 执行结果记录到 `ActivityStream`

---

## D. 边缘 Token 轮换（TokenRotator）

**借鉴自**：Fleet `orbit/pkg/token/` — 边缘节点 Token 自动轮换机制

### `edge-runtime/token_rotator.py`

```python
"""
边缘 Token 自动轮换（借鉴 Fleet orbit/pkg/token/ 设计）

安全要求：
  - 每个边缘节点有唯一 Token
  - Token 定期轮换（默认 24 小时）
  - 旧 Token 在轮换后立即吊销
  - Token 本地加密存储（防止明文泄露）
"""
import hashlib
import hmac
import json
import os
import secrets
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

TOKEN_FILE = "/opt/openclaw/edge/token.json"
TOKEN_ROTATION_INTERVAL = 86400  # 24 小时


@dataclass
class EdgeToken:
    node_id: str
    token: str
    issued_at: float
    expires_at: float

    def is_expired(self) -> bool:
        return time.time() > self.expires_at

    def should_rotate(self, threshold: float = 0.8) -> bool:
        """当 token 使用了 80% 的有效期时触发轮换"""
        elapsed = time.time() - self.issued_at
        total = self.expires_at - self.issued_at
        return elapsed / total >= threshold

    def to_dict(self) -> dict:
        return {
            "node_id": self.node_id,
            "token": self.token,
            "issued_at": self.issued_at,
            "expires_at": self.expires_at,
        }


class TokenRotator:
    """边缘节点 Token 轮换管理器"""

    def __init__(
        self,
        node_id: str,
        cloud_api_base: str,
        token_file: str = TOKEN_FILE,
        rotation_interval: int = TOKEN_ROTATION_INTERVAL,
    ):
        self.node_id = node_id
        self.cloud_api_base = cloud_api_base
        self.token_file = Path(token_file)
        self.rotation_interval = rotation_interval
        self._current_token: Optional[EdgeToken] = None

    def load_token(self) -> Optional[EdgeToken]:
        """从本地文件加载 Token"""
        if not self.token_file.exists():
            return None
        try:
            data = json.loads(self.token_file.read_text())
            token = EdgeToken(**data)
            self._current_token = token
            return token
        except Exception:
            return None

    def save_token(self, token: EdgeToken):
        """保存 Token 到本地文件（文件权限 600）"""
        self.token_file.parent.mkdir(parents=True, exist_ok=True)
        self.token_file.write_text(json.dumps(token.to_dict()))
        os.chmod(self.token_file, 0o600)
        self._current_token = token

    def get_current_token(self) -> Optional[str]:
        """获取当前有效 Token"""
        if self._current_token and not self._current_token.is_expired():
            return self._current_token.token
        token = self.load_token()
        if token and not token.is_expired():
            return token.token
        return None

    async def rotate_if_needed(self, http_client) -> bool:
        """检查并触发 Token 轮换"""
        token = self._current_token or self.load_token()
        if token is None or token.should_rotate() or token.is_expired():
            return await self._do_rotate(http_client)
        return True

    async def _do_rotate(self, http_client) -> bool:
        """执行 Token 轮换（向云端申请新 Token）"""
        try:
            old_token = self.get_current_token()
            headers = {"Authorization": f"Bearer {old_token}"} if old_token else {}
            
            resp = await http_client.post(
                f"{self.cloud_api_base}/api/v1/edge/token/rotate",
                json={"node_id": self.node_id},
                headers=headers,
            )
            
            if resp.status_code == 200:
                data = resp.json()
                new_token = EdgeToken(
                    node_id=self.node_id,
                    token=data["token"],
                    issued_at=time.time(),
                    expires_at=time.time() + self.rotation_interval,
                )
                self.save_token(new_token)
                return True
            return False
        except Exception:
            return False
```

**云端 API**：
```
POST /api/v1/edge/token/rotate
  body: {"node_id": "..."}
  headers: Authorization: Bearer <old_token>
  → 验证 old_token → 生成新 Token → 吊销旧 Token → 返回新 Token

GET  /api/v1/edge/token/verify
  → 验证 Token 是否有效（心跳时调用）
```

**验收标准**：
- [ ] Token 存储在本地文件（权限 600）
- [ ] `should_rotate()` 在有效期 80% 时触发
- [ ] `rotate_if_needed()` 在心跳循环中自动调用
- [ ] 轮换成功后旧 Token 立即在云端吊销
- [ ] Token 轮换记录到 `ActivityStream`

---

*Codex Task | 来源：FLEET_BORROWING_ANALYSIS.md P1-1~5 | 2026-04-02*
