# CODEX TASK: 龙虾条件触发规则（LobsterTriggerRule）

**优先级：P1**  
**来源：OPENREMOTE_BORROWING_ANALYSIS.md P1-#2（Flow Rule Engine）**

---

## 背景

龙虾触发方式单一（手动/定时），缺少**条件触发规则**：当某个业务指标满足条件时，自动唤醒对应龙虾执行任务。借鉴 OpenRemote Flow Rules 的 When/If/Then 模型，新增 `LobsterTriggerRule` 后台规则评估器。

---

## 核心数据结构 + 评估引擎

```python
# dragon-senate-saas-v2/lobster_trigger_rules.py

from dataclasses import dataclass, field
from typing import Any, Optional
import asyncio
import logging
import time

logger = logging.getLogger(__name__)


# ── 规则数据结构 ────────────────────────────────────────

@dataclass
class RuleCondition:
    """单个条件"""
    metric: str           # 指标名：task_fail_count / daily_task_count / error_rate 等
    op: str               # 操作符：>= / <= / == / > / < / !=
    value: Any            # 阈值
    lobster_name: str = ""  # 指定龙虾（空=全局）


@dataclass
class RuleAction:
    """触发动作"""
    action_type: str      # "invoke_lobster" / "send_alert" / "log_event"
    lobster_name: str = ""     # 要触发的龙虾
    message: str = ""          # 发给龙虾的消息
    tenant_id: str = ""
    alert_level: str = "warn"  # 告警级别


@dataclass
class LobsterTriggerRule:
    """
    龙虾条件触发规则（借鉴 OpenRemote When/If/Then）
    
    示例：
      rule = LobsterTriggerRule(
          rule_id="rule-001",
          tenant_id="t-123",
          name="catcher失败告警",
          conditions=[RuleCondition("task_fail_count", ">=", 3, "catcher")],
          condition_logic="AND",
          action=RuleAction("invoke_lobster", "commander", "catcher连续失败3次"),
          cooldown_seconds=300,  # 5分钟内不重复触发
      )
    """
    rule_id: str
    tenant_id: str
    name: str
    conditions: list[RuleCondition]
    action: RuleAction
    condition_logic: str = "AND"      # AND / OR
    is_active: bool = True
    cooldown_seconds: int = 300       # 冷却时间（避免频繁触发）
    created_at: float = field(default_factory=time.time)
    last_triggered_at: float = 0.0   # 上次触发时间


# ── 内置指标采集 ────────────────────────────────────────

class MetricCollector:
    """从 llm_call_logger / mcp_tool_monitor 等采集指标"""

    def __init__(self, db):
        self.db = db

    def get_metric(self, metric: str, lobster_name: str, tenant_id: str) -> float:
        """获取指标当前值"""
        if metric == "task_fail_count":
            # 过去60分钟失败次数
            rows = self.db.query_raw(
                "SELECT COUNT(*) as cnt FROM llm_call_logs "
                "WHERE tenant_id=? AND lobster_name=? AND status='error' "
                "AND created_at > ?",
                [tenant_id, lobster_name, time.time() - 3600],
            )
            return rows[0]["cnt"] if rows else 0

        elif metric == "daily_task_count":
            rows = self.db.query_raw(
                "SELECT COUNT(*) as cnt FROM llm_call_logs "
                "WHERE tenant_id=? AND DATE(created_at)=CURRENT_DATE",
                [tenant_id],
            )
            return rows[0]["cnt"] if rows else 0

        elif metric == "error_rate":
            rows = self.db.query_raw(
                "SELECT COUNT(*) as total, "
                "SUM(CASE WHEN status='error' THEN 1 ELSE 0 END) as errors "
                "FROM llm_call_logs "
                "WHERE tenant_id=? AND lobster_name=? AND created_at > ?",
                [tenant_id, lobster_name, time.time() - 3600],
            )
            if rows and rows[0]["total"] > 0:
                return rows[0]["errors"] / rows[0]["total"]
            return 0.0

        return 0.0


# ── 条件评估 ────────────────────────────────────────────

def evaluate_condition(cond: RuleCondition, value: float) -> bool:
    ops = {
        ">=": lambda a, b: a >= b,
        "<=": lambda a, b: a <= b,
        ">":  lambda a, b: a > b,
        "<":  lambda a, b: a < b,
        "==": lambda a, b: a == b,
        "!=": lambda a, b: a != b,
    }
    fn = ops.get(cond.op)
    return fn(value, cond.value) if fn else False


# ── 规则评估引擎 ────────────────────────────────────────

class LobsterTriggerEngine:
    """
    后台规则评估引擎（每60秒运行一次）
    
    集成方式：
      engine = LobsterTriggerEngine(db, lobster_runner)
      asyncio.create_task(engine.run_loop())  # 启动时注册
    """

    EVAL_INTERVAL = 60  # 秒

    def __init__(self, db, lobster_runner):
        self.db = db
        self.lobster_runner = lobster_runner
        self.collector = MetricCollector(db)
        self._rules: list[LobsterTriggerRule] = []

    def load_rules(self):
        """从 DB 加载所有激活规则"""
        rows = self.db.query("lobster_trigger_rules", where={"is_active": True})
        self._rules = [self._deserialize(r) for r in rows]
        logger.info(f"[TriggerEngine] 加载规则 {len(self._rules)} 条")

    async def run_loop(self):
        """后台评估循环（无限运行）"""
        while True:
            try:
                self.load_rules()
                await self._evaluate_all()
            except Exception as e:
                logger.error(f"[TriggerEngine] 评估循环异常: {e}")
            await asyncio.sleep(self.EVAL_INTERVAL)

    async def _evaluate_all(self):
        """评估所有规则"""
        now = time.time()
        for rule in self._rules:
            # 检查冷却时间
            if now - rule.last_triggered_at < rule.cooldown_seconds:
                continue
            # 评估条件
            if self._check_conditions(rule):
                await self._execute_action(rule)
                rule.last_triggered_at = now
                self.db.update(
                    "lobster_trigger_rules",
                    {"last_triggered_at": now},
                    where={"rule_id": rule.rule_id},
                )

    def _check_conditions(self, rule: LobsterTriggerRule) -> bool:
        results = []
        for cond in rule.conditions:
            value = self.collector.get_metric(
                cond.metric, cond.lobster_name, rule.tenant_id
            )
            result = evaluate_condition(cond, value)
            results.append(result)
            logger.debug(
                f"[TriggerEngine] rule={rule.rule_id} "
                f"metric={cond.metric}={value} {cond.op} {cond.value} → {result}"
            )

        if rule.condition_logic == "AND":
            return all(results)
        return any(results)

    async def _execute_action(self, rule: LobsterTriggerRule):
        action = rule.action
        logger.info(
            f"[TriggerEngine] 触发规则: {rule.name} "
            f"action={action.action_type} lobster={action.lobster_name}"
        )

        if action.action_type == "invoke_lobster" and action.lobster_name:
            try:
                await self.lobster_runner.run(
                    lobster_name=action.lobster_name,
                    input=action.message,
                    tenant_id=rule.tenant_id,
                    source="trigger_rule",
                    rule_id=rule.rule_id,
                )
            except Exception as e:
                logger.warning(f"[TriggerEngine] 龙虾调用失败: {e}")

        elif action.action_type == "send_alert":
            # 复用已有的 alert_engine
            logger.warning(
                f"[TriggerAlert] rule={rule.name} level={action.alert_level} "
                f"msg={action.message}"
            )

    def _deserialize(self, row: dict) -> LobsterTriggerRule:
        import json
        conds_raw = json.loads(row.get("conditions", "[]"))
        action_raw = json.loads(row.get("action", "{}"))
        return LobsterTriggerRule(
            rule_id=row["rule_id"],
            tenant_id=row["tenant_id"],
            name=row["name"],
            conditions=[RuleCondition(**c) for c in conds_raw],
            action=RuleAction(**action_raw),
            condition_logic=row.get("condition_logic", "AND"),
            is_active=row.get("is_active", True),
            cooldown_seconds=row.get("cooldown_seconds", 300),
            last_triggered_at=row.get("last_triggered_at", 0.0),
        )


# 全局单例（app.py 启动时初始化）
# engine = LobsterTriggerEngine(db, lobster_runner)
# asyncio.create_task(engine.run_loop())
```

---

## 预置规则示例（运营可配置）

```python
PRESET_RULES = [
    {
        "name": "catcher连续失败告警",
        "conditions": [{"metric": "task_fail_count", "op": ">=", "value": 3, "lobster_name": "catcher"}],
        "action": {"action_type": "invoke_lobster", "lobster_name": "commander",
                   "message": "⚠️ catcher在过去1小时内失败3次以上，请介入检查"},
        "cooldown_seconds": 1800,
    },
    {
        "name": "错误率超警戒线",
        "conditions": [{"metric": "error_rate", "op": ">=", "value": 0.3, "lobster_name": "inkwriter"}],
        "action": {"action_type": "send_alert", "alert_level": "error",
                   "message": "inkwriter错误率超过30%"},
        "cooldown_seconds": 600,
    },
]
```

---

## 验收标准

- [ ] `LobsterTriggerRule` / `RuleCondition` / `RuleAction` 数据结构
- [ ] `MetricCollector`：支持 `task_fail_count` / `daily_task_count` / `error_rate`
- [ ] `evaluate_condition()`：支持 `>= / <= / > / < / == / !=`
- [ ] `LobsterTriggerEngine.run_loop()`：后台60秒评估循环
- [ ] 冷却时间机制（cooldown_seconds，避免频繁触发）
- [ ] AND/OR 多条件组合
- [ ] `action_type=invoke_lobster`：调用 `lobster_runner.run()`
- [ ] `action_type=send_alert`：写告警日志
- [ ] REST API：CRUD 规则（运营在管理台配置）
- [ ] 预置3条开箱即用规则

---

*Codex Task | 来源：OPENREMOTE_BORROWING_ANALYSIS.md P1-#2 | 2026-04-02*
