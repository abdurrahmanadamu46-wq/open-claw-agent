# CODEX TASK: 龙虾行为规则引擎 + 自动响应框架

**优先级：P1**  
**来源：WAZUH_BORROWING_ANALYSIS.md P1-1 + P1-2**  
**借鉴自**：Wazuh `src/engine/`（规则引擎）+ `src/active-response/`（自动响应）

---

## 背景

当前所有龙虾行为判断都依赖 LLM 调用（每次调用有成本+延迟）。  
借鉴 Wazuh 的**规则引擎 + 主动响应**架构，建立**条件触发规则层**：

```
信号/事件 → 规则匹配 → 触发动作（无需 LLM）
                ↓
         不满足任何规则 → 交给 LLM 判断
```

典型场景：
- `catcher` 收到线索，评分 ≥ 80 → **自动触发** `followup` 发第一条跟进消息
- `radar` 发现竞品负面舆情 → **自动触发** `strategist` 生成应对策略
- `echoer` 对话超过 5 轮 → **自动触发** `catcher` 进入获客流程
- 边缘节点心跳超时 30s → **自动触发** 告警通知

---

## A. 规则引擎实现

### `dragon-senate-saas-v2/lobster_rule_engine.py`

```python
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Any, Callable, Optional
from enum import Enum
import operator
import json


class RuleOperator(str, Enum):
    GT = "gt"          # >
    GTE = "gte"        # >=
    LT = "lt"          # <
    LTE = "lte"        # <=
    EQ = "eq"          # ==
    NEQ = "neq"        # !=
    CONTAINS = "contains"
    STARTSWITH = "startswith"
    REGEX = "regex"


@dataclass
class RuleCondition:
    """单个条件：field operator value"""
    field: str          # 点分路径，如 "lead.score" 或 "event.type"
    op: RuleOperator
    value: Any

    def match(self, event: dict) -> bool:
        """从 event 中取 field 值，与 value 比较"""
        val = self._get_field(event, self.field)
        if val is None:
            return False
        ops = {
            RuleOperator.GT: operator.gt,
            RuleOperator.GTE: operator.ge,
            RuleOperator.LT: operator.lt,
            RuleOperator.LTE: operator.le,
            RuleOperator.EQ: operator.eq,
            RuleOperator.NEQ: operator.ne,
            RuleOperator.CONTAINS: lambda a, b: b in str(a),
            RuleOperator.STARTSWITH: lambda a, b: str(a).startswith(str(b)),
        }
        return ops.get(self.op, lambda a, b: False)(val, self.value)

    def _get_field(self, obj: dict, path: str) -> Any:
        parts = path.split(".")
        for p in parts:
            if not isinstance(obj, dict):
                return None
            obj = obj.get(p)
        return obj


@dataclass
class RuleAction:
    """规则命中后执行的动作"""
    action_type: str    # "dispatch_lobster" | "send_alert" | "update_field" | "webhook"
    params: dict = field(default_factory=dict)


@dataclass
class LobsterRule:
    """完整规则定义"""
    rule_id: str
    name: str
    description: str = ""
    tenant_id: str = "*"               # "*" 表示全租户
    conditions: list[RuleCondition] = field(default_factory=list)
    condition_logic: str = "AND"       # "AND" | "OR"
    actions: list[RuleAction] = field(default_factory=list)
    priority: int = 100                # 优先级，数字越小越优先
    enabled: bool = True
    tags: list[str] = field(default_factory=list)

    def match(self, event: dict) -> bool:
        if not self.enabled:
            return False
        if not self.conditions:
            return False
        if self.condition_logic == "AND":
            return all(c.match(event) for c in self.conditions)
        return any(c.match(event) for c in self.conditions)


class LobsterRuleEngine:
    """
    龙虾行为规则引擎
    借鉴 Wazuh engine 的 规则集→条件匹配→动作触发 模式
    """

    def __init__(self):
        self._rules: list[LobsterRule] = []
        self._action_handlers: dict[str, Callable] = {}

    def load_rules(self, rules: list[LobsterRule]):
        self._rules = sorted(rules, key=lambda r: r.priority)

    def register_action(self, action_type: str, handler: Callable):
        self._action_handlers[action_type] = handler

    async def process(self, event: dict, tenant_id: str) -> list[dict]:
        """处理事件，返回触发的动作列表"""
        triggered = []
        for rule in self._rules:
            if rule.tenant_id not in ("*", tenant_id):
                continue
            if rule.match(event):
                for action in rule.actions:
                    handler = self._action_handlers.get(action.action_type)
                    if handler:
                        result = await handler(event, action.params, tenant_id)
                        triggered.append({
                            "rule_id": rule.rule_id,
                            "rule_name": rule.name,
                            "action": action.action_type,
                            "result": result,
                        })
        return triggered

    @classmethod
    def from_yaml_dict(cls, data: dict) -> "LobsterRuleEngine":
        """从 YAML/JSON 配置加载规则集"""
        engine = cls()
        rules = []
        for r in data.get("rules", []):
            conditions = [
                RuleCondition(field=c["field"], op=RuleOperator(c["op"]), value=c["value"])
                for c in r.get("conditions", [])
            ]
            actions = [RuleAction(action_type=a["type"], params=a.get("params", {}))
                       for a in r.get("actions", [])]
            rules.append(LobsterRule(
                rule_id=r["id"],
                name=r["name"],
                description=r.get("description", ""),
                tenant_id=r.get("tenant_id", "*"),
                conditions=conditions,
                condition_logic=r.get("logic", "AND"),
                actions=actions,
                priority=r.get("priority", 100),
                enabled=r.get("enabled", True),
                tags=r.get("tags", []),
            ))
        engine.load_rules(rules)
        return engine
```

### 示例规则配置（YAML）

```yaml
# dragon-senate-saas-v2/rules/marketing_rules.yaml
rules:
  - id: RULE_001
    name: 高意向线索自动跟进
    priority: 10
    conditions:
      - field: event.type
        op: eq
        value: lead_scored
      - field: lead.score
        op: gte
        value: 80
    logic: AND
    actions:
      - type: dispatch_lobster
        params:
          lobster_id: followup
          task: send_first_followup
          priority: high

  - id: RULE_002
    name: 对话超5轮转获客
    priority: 20
    conditions:
      - field: event.type
        op: eq
        value: conversation_turn
      - field: conversation.turn_count
        op: gte
        value: 5
    logic: AND
    actions:
      - type: dispatch_lobster
        params:
          lobster_id: catcher
          task: qualify_lead

  - id: RULE_003
    name: 竞品舆情自动应对
    priority: 15
    conditions:
      - field: event.type
        op: eq
        value: signal_detected
      - field: signal.category
        op: eq
        value: competitor_negative
    logic: AND
    actions:
      - type: dispatch_lobster
        params:
          lobster_id: strategist
          task: generate_response_strategy
```

---

## B. 自动响应框架（内置动作处理器）

```python
# dragon-senate-saas-v2/lobster_auto_responder.py

class LobsterAutoResponder:
    """
    龙虾自动响应处理器
    注册到 LobsterRuleEngine 的 action_handlers 中
    """

    def __init__(self, lobster_runner, alert_service, webhook_client):
        self.runner = lobster_runner
        self.alert = alert_service
        self.webhook = webhook_client

    async def handle_dispatch_lobster(self, event: dict, params: dict, tenant_id: str):
        """动作：派发龙虾任务"""
        return await self.runner.dispatch(
            lobster_id=params["lobster_id"],
            task=params["task"],
            context=event,
            tenant_id=tenant_id,
            priority=params.get("priority", "normal"),
        )

    async def handle_send_alert(self, event: dict, params: dict, tenant_id: str):
        """动作：发送告警（飞书/企微/钉钉）"""
        return await self.alert.send(
            channel=params.get("channel", "feishu"),
            message=params.get("message_template", "规则触发告警").format(**event),
            tenant_id=tenant_id,
        )

    async def handle_webhook(self, event: dict, params: dict, tenant_id: str):
        """动作：触发外部 Webhook"""
        return await self.webhook.post(url=params["url"], payload=event)

    def register_all(self, engine: "LobsterRuleEngine"):
        engine.register_action("dispatch_lobster", self.handle_dispatch_lobster)
        engine.register_action("send_alert", self.handle_send_alert)
        engine.register_action("webhook", self.handle_webhook)
```

---

## 验收标准

- [ ] `LobsterRule.match()` 支持 AND/OR 逻辑，8种操作符
- [ ] `LobsterRuleEngine.process()` 按优先级顺序处理规则
- [ ] `from_yaml_dict()` 从 YAML 配置加载规则集
- [ ] `dispatch_lobster` 动作成功触发 `lobster_runner.dispatch()`
- [ ] `send_alert` 动作发送飞书消息
- [ ] 规则热加载（无需重启，PUT API 更新规则集）
- [ ] API：`GET /api/v1/rules` / `POST /api/v1/rules` / `PUT /api/v1/rules/{id}`
- [ ] 前端规则管理页：列表 + 条件可视化配置 + 动作配置

---

*Codex Task | 来源：WAZUH_BORROWING_ANALYSIS.md P1-1+P1-2 | 2026-04-02*
