# CODEX TASK: 告警规则引擎（Alert Engine）— 龙虾质量/执行异常/边缘节点告警

**优先级：P1**  
**来源：GRAFANA_SIGNOZ_BORROWING_ANALYSIS.md P1-#1（Grafana Unified Alerting + SigNoz Alert Builder）**

---

## 背景

龙虾监控目前完全无告警能力——质量分下降、执行失败率升高、边缘节点离线，均需人工发现。生产级 SaaS 必须有自动告警。

参考 Grafana Unified Alerting 的状态机（Normal→Pending→Firing→Silenced）和 SigNoz 的简化 Alert Builder UI，实现我们自己的告警规则引擎。

---

## 一、数据模型

```python
# dragon-senate-saas-v2/alert_engine.py

from dataclasses import dataclass, field
from typing import Optional, Literal, List, Dict
from datetime import datetime
from enum import Enum

class AlertSeverity(str, Enum):
    CRITICAL = "critical"
    WARNING = "warning"
    INFO = "info"

class AlertState(str, Enum):
    NORMAL = "normal"
    PENDING = "pending"    # 超阈值但未超持续时间
    FIRING = "firing"      # 正在告警
    SILENCED = "silenced"  # 手动静默

@dataclass
class AlertRule:
    """告警规则"""
    rule_id: str
    name: str
    description: str
    
    # 条件定义（SigNoz Alert Builder 简化模式）
    metric: str               # "quality_score" | "error_rate" | "run_count" | "heartbeat_missing"
    aggregation: str          # "avg" | "sum" | "count" | "rate" | "p90" | "p99"
    condition: str            # "<" | ">" | ">=" | "<="
    threshold: float          # 阈值
    window_seconds: int       # 聚合窗口（秒）如 300 = 5分钟
    
    # 触发配置
    pending_seconds: int      # Pending 多久后 Firing（秒）
    silence_seconds: int      # Firing 后静默多久（秒，避免重复告警）
    
    severity: AlertSeverity
    
    # 过滤条件（可选）
    lobster_filter: Optional[str] = None   # 只监控此龙虾
    tenant_filter: Optional[str] = None   # 只监控此租户
    edge_node_filter: Optional[str] = None
    
    # 通知渠道
    notification_channel_ids: List[str] = field(default_factory=list)
    
    # 状态（运行时）
    state: AlertState = AlertState.NORMAL
    pending_since: Optional[datetime] = None
    last_fired_at: Optional[datetime] = None
    last_resolved_at: Optional[datetime] = None
    
    # 元数据
    enabled: bool = True
    tenant_id: Optional[str] = None   # None = 平台级规则
    created_by: str = "system"

@dataclass
class NotificationChannel:
    """通知渠道"""
    channel_id: str
    name: str
    channel_type: Literal["wechat_work", "feishu", "dingtalk", "email", "webhook", "sms"]
    config: Dict               # Webhook URL / 手机号等
    severity_filter: Literal["critical", "warning", "all"] = "all"
    enabled: bool = True
    tenant_id: Optional[str] = None

@dataclass
class AlertFiringEvent:
    """告警触发事件（写入历史记录）"""
    event_id: str
    rule_id: str
    rule_name: str
    state: AlertState          # firing / resolved
    severity: AlertSeverity
    message: str               # 告警消息
    current_value: float       # 触发时的实际值
    threshold: float
    fired_at: datetime
    resolved_at: Optional[datetime] = None
    tenant_id: Optional[str] = None
    lobster_id: Optional[str] = None
```

---

## 二、告警规则引擎（AlertEngine）

```python
# dragon-senate-saas-v2/alert_engine.py （续）

import asyncio
import logging
from datetime import datetime, timedelta
import uuid

logger = logging.getLogger(__name__)

class AlertEngine:
    """
    告警规则引擎
    - 定期评估所有启用的告警规则
    - 维护 Normal → Pending → Firing → Resolved 状态机
    - 触发时调用 NotificationDispatcher 发送告警
    """

    def __init__(self, db, metrics_calculator, notification_dispatcher):
        self.db = db
        self.metrics = metrics_calculator
        self.notifier = notification_dispatcher
        self._running = False

    async def start(self, eval_interval: int = 60):
        """启动告警评估循环（每 eval_interval 秒评估一次）"""
        self._running = True
        logger.info(f"[AlertEngine] 启动，评估间隔 {eval_interval}s")
        while self._running:
            await asyncio.sleep(eval_interval)
            await self.evaluate_all()

    async def evaluate_all(self):
        """评估所有启用的告警规则"""
        rules = self.db.query(AlertRule).filter(AlertRule.enabled == True).all()
        for rule in rules:
            try:
                await self._evaluate_rule(rule)
            except Exception as e:
                logger.error(f"[AlertEngine] 规则 {rule.rule_id} 评估失败: {e}")

    async def _evaluate_rule(self, rule: AlertRule):
        """评估单条规则，更新状态机"""
        # 1. 计算当前指标值
        current_value = await self.metrics.calculate(
            metric=rule.metric,
            aggregation=rule.aggregation,
            window_seconds=rule.window_seconds,
            lobster_filter=rule.lobster_filter,
            tenant_filter=rule.tenant_filter or rule.tenant_id,
        )

        # 2. 判断是否超阈值
        is_breaching = self._check_threshold(current_value, rule.condition, rule.threshold)

        now = datetime.utcnow()

        # 3. 状态机转换
        if rule.state == AlertState.NORMAL:
            if is_breaching:
                rule.state = AlertState.PENDING
                rule.pending_since = now
                logger.info(f"[AlertEngine] {rule.name} → PENDING（值:{current_value:.2f} {rule.condition} {rule.threshold}）")

        elif rule.state == AlertState.PENDING:
            if not is_breaching:
                # 恢复正常，退回 Normal
                rule.state = AlertState.NORMAL
                rule.pending_since = None
            elif (now - rule.pending_since).total_seconds() >= rule.pending_seconds:
                # 超过 Pending 时间 → 触发告警
                rule.state = AlertState.FIRING
                rule.last_fired_at = now
                await self._fire_alert(rule, current_value, now)

        elif rule.state == AlertState.FIRING:
            if not is_breaching:
                # 恢复正常
                rule.state = AlertState.NORMAL
                rule.last_resolved_at = now
                await self._resolve_alert(rule, current_value, now)
            elif rule.silence_seconds > 0:
                # 检查是否在静默期内
                silence_end = rule.last_fired_at + timedelta(seconds=rule.silence_seconds)
                if now >= silence_end:
                    # 静默期结束，重新发送告警
                    rule.last_fired_at = now
                    await self._fire_alert(rule, current_value, now)

        elif rule.state == AlertState.SILENCED:
            if not is_breaching:
                rule.state = AlertState.NORMAL
                rule.last_resolved_at = now

        # 4. 持久化状态
        self.db.add(rule)
        self.db.commit()

    def _check_threshold(self, value: float, condition: str, threshold: float) -> bool:
        ops = {"<": value < threshold, ">": value > threshold,
               "<=": value <= threshold, ">=": value >= threshold, "==": value == threshold}
        return ops.get(condition, False)

    async def _fire_alert(self, rule: AlertRule, current_value: float, now: datetime):
        """触发告警：写历史 + 发通知"""
        message = self._build_message(rule, current_value, is_firing=True)
        
        event = AlertFiringEvent(
            event_id=str(uuid.uuid4()),
            rule_id=rule.rule_id,
            rule_name=rule.name,
            state=AlertState.FIRING,
            severity=rule.severity,
            message=message,
            current_value=current_value,
            threshold=rule.threshold,
            fired_at=now,
            tenant_id=rule.tenant_id,
            lobster_id=rule.lobster_filter,
        )
        self.db.add(event)
        self.db.commit()
        
        await self.notifier.dispatch(rule, event)
        logger.warning(f"[AlertEngine] 🚨 FIRING: {rule.name} | 值:{current_value:.2f} | {message}")

    async def _resolve_alert(self, rule: AlertRule, current_value: float, now: datetime):
        """告警恢复：更新历史 + 发恢复通知"""
        message = self._build_message(rule, current_value, is_firing=False)
        
        # 更新最近的 firing 事件
        last_event = self.db.query(AlertFiringEvent)\
            .filter(AlertFiringEvent.rule_id == rule.rule_id, AlertFiringEvent.resolved_at == None)\
            .order_by(AlertFiringEvent.fired_at.desc()).first()
        if last_event:
            last_event.resolved_at = now
            last_event.state = AlertState.NORMAL
            self.db.commit()
        
        await self.notifier.dispatch_resolved(rule, current_value, message)
        logger.info(f"[AlertEngine] ✅ RESOLVED: {rule.name} | 值:{current_value:.2f}")

    def _build_message(self, rule: AlertRule, value: float, is_firing: bool) -> str:
        verb = "超阈值" if is_firing else "已恢复"
        scope = f"龙虾[{rule.lobster_filter}]" if rule.lobster_filter else "全局"
        return (f"{'🚨' if is_firing else '✅'} [{rule.severity.value.upper()}] "
                f"{scope} {rule.name} {verb}｜"
                f"当前值:{value:.2f} {'(阈值: ' + rule.condition + ' ' + str(rule.threshold) + ')' if is_firing else ''}")
```

---

## 三、指标计算器（MetricsCalculator）

```python
# dragon-senate-saas-v2/metrics_calculator.py

class MetricsCalculator:
    """计算各类监控指标"""

    def __init__(self, db):
        self.db = db

    async def calculate(self, metric: str, aggregation: str, window_seconds: int,
                        lobster_filter=None, tenant_filter=None) -> float:
        since = datetime.utcnow() - timedelta(seconds=window_seconds)
        
        handlers = {
            "quality_score": self._quality_score,
            "error_rate": self._error_rate,
            "run_count": self._run_count,
            "duration_ms": self._duration,
            "heartbeat_missing": self._heartbeat_missing,
            "quota_usage_rate": self._quota_usage_rate,
            "edge_queue_depth": self._edge_queue_depth,
        }
        handler = handlers.get(metric)
        if not handler:
            raise ValueError(f"未知指标: {metric}")
        return await handler(aggregation, since, lobster_filter, tenant_filter)

    async def _quality_score(self, aggregation, since, lobster_filter, tenant_filter):
        query = self.db.query(LobsterRun)\
            .filter(LobsterRun.created_at >= since, LobsterRun.quality_score != None)
        if lobster_filter:
            query = query.filter(LobsterRun.lobster_id == lobster_filter)
        if tenant_filter:
            query = query.filter(LobsterRun.tenant_id == tenant_filter)
        scores = [r.quality_score for r in query.all()]
        if not scores:
            return 10.0  # 无数据时不触发告警
        if aggregation == "avg":
            return sum(scores) / len(scores)
        if aggregation == "p90":
            return sorted(scores)[int(len(scores) * 0.9)]
        return min(scores)

    async def _error_rate(self, aggregation, since, lobster_filter, tenant_filter):
        query = self.db.query(LobsterRun).filter(LobsterRun.created_at >= since)
        if lobster_filter:
            query = query.filter(LobsterRun.lobster_id == lobster_filter)
        if tenant_filter:
            query = query.filter(LobsterRun.tenant_id == tenant_filter)
        total = query.count()
        if total == 0:
            return 0.0
        errors = query.filter(LobsterRun.status == "error").count()
        return errors / total * 100  # 百分比

    async def _heartbeat_missing(self, aggregation, since, lobster_filter, tenant_filter):
        """龙虾心跳连续丢失次数"""
        if not lobster_filter:
            return 0.0
        lobster = self.db.query(Lobster).filter(Lobster.id == lobster_filter).first()
        if not lobster:
            return 0.0
        last_heartbeat = lobster.last_heartbeat_at
        if not last_heartbeat:
            return 999.0  # 从未心跳
        delta = (datetime.utcnow() - last_heartbeat).total_seconds()
        return delta / 60  # 转为分钟
```

---

## 四、通知分发器（NotificationDispatcher）

```python
# dragon-senate-saas-v2/notification_dispatcher.py

import aiohttp

class NotificationDispatcher:
    """将告警发送到各种通知渠道"""

    def __init__(self, db):
        self.db = db

    async def dispatch(self, rule: AlertRule, event: AlertFiringEvent):
        channels = self.db.query(NotificationChannel)\
            .filter(NotificationChannel.channel_id.in_(rule.notification_channel_ids),
                    NotificationChannel.enabled == True).all()
        for channel in channels:
            if channel.severity_filter != "all" and channel.severity_filter != rule.severity.value:
                continue
            await self._send(channel, event.message, is_resolved=False)

    async def dispatch_resolved(self, rule: AlertRule, value: float, message: str):
        channels = self.db.query(NotificationChannel)\
            .filter(NotificationChannel.channel_id.in_(rule.notification_channel_ids),
                    NotificationChannel.enabled == True).all()
        for channel in channels:
            await self._send(channel, message, is_resolved=True)

    async def _send(self, channel: NotificationChannel, message: str, is_resolved: bool):
        try:
            if channel.channel_type == "wechat_work":
                await self._send_wechat_work(channel.config, message)
            elif channel.channel_type == "feishu":
                await self._send_feishu(channel.config, message)
            elif channel.channel_type == "dingtalk":
                await self._send_dingtalk(channel.config, message)
            elif channel.channel_type == "webhook":
                await self._send_webhook(channel.config, message)
        except Exception as e:
            logger.error(f"[Notifier] 发送到 {channel.channel_type} 失败: {e}")

    async def _send_wechat_work(self, config: dict, message: str):
        """企业微信 Webhook"""
        async with aiohttp.ClientSession() as session:
            await session.post(config["webhook_url"], json={
                "msgtype": "text",
                "text": {"content": message},
            })

    async def _send_feishu(self, config: dict, message: str):
        """飞书 Webhook"""
        async with aiohttp.ClientSession() as session:
            await session.post(config["webhook_url"], json={
                "msg_type": "text",
                "content": {"text": message},
            })

    async def _send_dingtalk(self, config: dict, message: str):
        """钉钉 Webhook"""
        async with aiohttp.ClientSession() as session:
            await session.post(config["webhook_url"], json={
                "msgtype": "text",
                "text": {"content": message},
            })
```

---

## 五、内置默认告警规则（系统初始化时创建）

```python
# dragon-senate-saas-v2/default_alert_rules.py

DEFAULT_RULES = [
    AlertRule(
        rule_id="default_quality_warning",
        name="龙虾质量分过低",
        description="任意龙虾30分钟平均质量分低于7.0",
        metric="quality_score", aggregation="avg", condition="<", threshold=7.0,
        window_seconds=1800, pending_seconds=300, silence_seconds=1800,
        severity=AlertSeverity.WARNING,
        notification_channel_ids=["platform_default"],
    ),
    AlertRule(
        rule_id="default_quality_critical",
        name="龙虾质量分严重过低",
        description="任意龙虾30分钟平均质量分低于6.0",
        metric="quality_score", aggregation="avg", condition="<", threshold=6.0,
        window_seconds=1800, pending_seconds=60, silence_seconds=900,
        severity=AlertSeverity.CRITICAL,
        notification_channel_ids=["platform_default"],
    ),
    AlertRule(
        rule_id="default_error_rate",
        name="执行错误率过高",
        description="最近30分钟错误率超过10%",
        metric="error_rate", aggregation="avg", condition=">", threshold=10.0,
        window_seconds=1800, pending_seconds=120, silence_seconds=1800,
        severity=AlertSeverity.WARNING,
        notification_channel_ids=["platform_default"],
    ),
    AlertRule(
        rule_id="default_heartbeat",
        name="龙虾心跳丢失",
        description="龙虾心跳超过5分钟未收到",
        metric="heartbeat_missing", aggregation="avg", condition=">", threshold=5.0,
        window_seconds=300, pending_seconds=0, silence_seconds=600,
        severity=AlertSeverity.CRITICAL,
        notification_channel_ids=["platform_default"],
    ),
]
```

---

## 六、前端 Alert Builder UI（参考 SigNoz）

```typescript
// web/src/app/operations/alerts/page.tsx
// 告警规则列表页

// web/src/app/operations/alerts/new/page.tsx
// 参考 SigNoz Alert Builder：无需写 PromQL，表单即规则

export function AlertRuleForm({ rule, onSave }) {
  const form = useForm({ resolver: zodResolver(alertRuleSchema) });
  const metric = form.watch('metric');

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSave)} className="space-y-6">
        <FormField name="name" render={({ field }) => (
          <FormItem><FormLabel>规则名称</FormLabel>
            <FormControl><Input {...field} placeholder="龙虾质量分过低" /></FormControl>
            <FormMessage />
          </FormItem>
        )} />
        
        {/* 条件构建器（SigNoz Builder 模式）*/}
        <div className="rounded-lg border p-4 space-y-4">
          <h3 className="font-medium">告警条件</h3>
          <div className="grid grid-cols-4 gap-2 items-center">
            <FormField name="metric" render={({ field }) => (
              <Select onValueChange={field.onChange} defaultValue={field.value}>
                <SelectTrigger><SelectValue placeholder="选择指标" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="quality_score">质量评分</SelectItem>
                  <SelectItem value="error_rate">错误率 %</SelectItem>
                  <SelectItem value="duration_ms">执行耗时 ms</SelectItem>
                  <SelectItem value="heartbeat_missing">心跳丢失 min</SelectItem>
                  <SelectItem value="quota_usage_rate">配额使用率 %</SelectItem>
                </SelectContent>
              </Select>
            )} />
            <FormField name="condition" render={({ field }) => (
              <Select onValueChange={field.onChange} defaultValue={field.value}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="<">低于 &lt;</SelectItem>
                  <SelectItem value=">">高于 &gt;</SelectItem>
                  <SelectItem value=">=">不低于 ≥</SelectItem>
                </SelectContent>
              </Select>
            )} />
            <FormField name="threshold" render={({ field }) => (
              <Input type="number" {...field} onChange={e => field.onChange(parseFloat(e.target.value))} placeholder="阈值" />
            )} />
            <span className="text-sm text-muted-foreground">
              {metric === 'quality_score' ? '（满分10）' : metric === 'error_rate' ? '（百分比）' : ''}
            </span>
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <FormField name="window_seconds" render={({ field }) => (
              <FormItem><FormLabel>聚合窗口</FormLabel>
                <Select onValueChange={v => field.onChange(parseInt(v))} defaultValue={String(field.value)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="300">5 分钟</SelectItem>
                    <SelectItem value="1800">30 分钟</SelectItem>
                    <SelectItem value="3600">1 小时</SelectItem>
                  </SelectContent>
                </Select>
              </FormItem>
            )} />
            <FormField name="pending_seconds" render={({ field }) => (
              <FormItem><FormLabel>持续时间后触发</FormLabel>
                <Select onValueChange={v => field.onChange(parseInt(v))} defaultValue={String(field.value)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">立即</SelectItem>
                    <SelectItem value="60">1 分钟</SelectItem>
                    <SelectItem value="300">5 分钟</SelectItem>
                  </SelectContent>
                </Select>
              </FormItem>
            )} />
          </div>
        </div>
        
        <Button type="submit" disabled={form.formState.isSubmitting}>保存规则</Button>
      </form>
    </Form>
  );
}
```

---

## 验收标准

**后端：**
- [ ] `AlertRule` / `NotificationChannel` / `AlertFiringEvent` 数据模型
- [ ] `AlertEngine` 状态机：Normal → Pending → Firing → Resolved
- [ ] `MetricsCalculator`：quality_score / error_rate / heartbeat_missing / quota_usage_rate
- [ ] `NotificationDispatcher`：企业微信 / 飞书 / 钉钉 / Webhook 四种渠道
- [ ] 指数退避静默（silence_seconds，避免告警风暴）
- [ ] 5条默认系统内置规则（质量分过低 × 2 / 错误率 / 心跳丢失）
- [ ] `AlertEngine.start()` 在 app.py 启动时以 asyncio.create_task 运行

**前端：**
- [ ] 告警规则列表页（`/operations/alerts`）：规则名/状态/当前值/最近触发
- [ ] Alert Builder 表单（无 PromQL，条件构建器下拉+输入）
- [ ] 告警历史页：按时间倒序列表（规则名/状态/当前值/触发时间）
- [ ] 通知渠道配置页：添加企业微信/飞书 Webhook

---

*Codex Task | 来源：GRAFANA_SIGNOZ_BORROWING_ANALYSIS.md P1-#1 | 2026-04-02*
