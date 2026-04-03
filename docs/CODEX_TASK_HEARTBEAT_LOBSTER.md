# CODEX TASK: 主动心跳巡查龙虾（30分钟主动告警）

> **任务来源**：G07 — IronClaw 借鉴分析差距报告 2026-04-01  
> **参考文档**：docs/IRONCLAW_BORROWING_ANALYSIS.md / docs/BORROWING_GAP_ANALYSIS_2026-04-01.md  
> **优先级**：🟠 P1 重要（被动式心跳无法主动发现问题）  
> **预估工作量**：2 天  
> **负责人**：Codex  

---

## ⚠️ 开始前：冲突检查（必须执行）

```bash
# 1. 检查现有 heartbeat_engine.py
grep -n "def.*heartbeat\|schedule\|interval\|active_check\|proactive" \
  dragon-senate-saas-v2/heartbeat_engine.py 2>/dev/null | head -20

# 2. 检查现有 cron_scheduler.py（心跳任务是否已注册）
grep -n "heartbeat\|health_check\|30.*min\|1800" \
  dragon-senate-saas-v2/cron_scheduler.py 2>/dev/null | head -10

# 3. 检查现有 lobster_registry_manager.py 的 heartbeat 接口
grep -n "def.*heartbeat\|last_heartbeat\|status" \
  dragon-senate-saas-v2/lobster_registry_manager.py 2>/dev/null | head -15

# 4. 确认通知渠道已就绪
grep -n "send_notification\|send_alert" \
  dragon-senate-saas-v2/notification_center.py 2>/dev/null | head -5
```

**冲突解决原则**：
- 若 `heartbeat_engine.py` 已有被动式心跳：在其基础上新增 `active_check()` 方法，不重建
- 主动巡查任务注册到现有 `cron_scheduler.py`，不新建调度器
- 告警通知复用现有 `notification_center.py`

---

## 一、任务目标

实现 IronClaw 风格的主动后台巡查机制：
1. **每30分钟主动巡查**：检查边缘节点/任务队列/发布计划，不等用户反馈
2. **边缘节点离线告警**：节点超过5分钟无心跳 → 主动推送告警
3. **任务队列积压告警**：积压超过50条 → 主动推送告警
4. **未执行计划提醒**：今日发布计划超时未执行 → 主动提醒

---

## 二、实施方案

### 2.1 在 heartbeat_engine.py 中新增主动巡查模块

**目标文件**：`dragon-senate-saas-v2/heartbeat_engine.py`  
**修改方式**：在现有代码末尾追加 `ActiveHeartbeatChecker` 类

```python
# ════════════════════════════════════════════════════════════════
# 主动巡查模块（新增，不修改现有被动式心跳逻辑）
# ════════════════════════════════════════════════════════════════

import asyncio
import logging
import os
import time
from datetime import datetime, timezone, timedelta
from typing import Any

active_logger = logging.getLogger("heartbeat.active")

# 告警阈值配置（可通过环境变量覆盖）
EDGE_OFFLINE_THRESHOLD_SECONDS = int(os.getenv("EDGE_OFFLINE_THRESHOLD", "300"))   # 5分钟
TASK_QUEUE_BACKLOG_LIMIT = int(os.getenv("TASK_QUEUE_BACKLOG_LIMIT", "50"))         # 50条
PUBLISH_PLAN_OVERDUE_MINUTES = int(os.getenv("PUBLISH_PLAN_OVERDUE_MINUTES", "30")) # 30分钟

class ActiveHeartbeatChecker:
    """
    主动心跳巡查器
    
    IronClaw HeartbeatSystem 的龙虾版实现：
    每30分钟主动检查系统健康状态，发现问题主动推送告警
    """
    
    def __init__(self, tenant_id: str = "tenant_main") -> None:
        self.tenant_id = tenant_id
        self._last_check_at: float = 0.0
        self._alert_cooldowns: dict[str, float] = {}  # 防止重复告警

    async def run_active_checks(self) -> list[dict[str, Any]]:
        """
        执行所有主动巡查项
        返回：发现的问题列表（每项含 severity / message / action_required）
        """
        issues: list[dict[str, Any]] = []
        
        # Check 1: 边缘节点离线检查
        issues.extend(await self._check_edge_nodes_offline())
        
        # Check 2: 任务队列积压检查
        issues.extend(await self._check_task_queue_backlog())
        
        # Check 3: 今日发布计划未执行检查
        issues.extend(await self._check_overdue_publish_plans())
        
        # Check 4: 龙虾状态异常检查（连续错误）
        issues.extend(await self._check_lobster_error_rates())
        
        # Check 5: 备份状态检查
        issues.extend(await self._check_backup_status())
        
        self._last_check_at = time.monotonic()
        
        # 发送告警
        if issues:
            await self._send_active_alerts(issues)
        
        active_logger.info(
            "[ActiveCheck] tenant=%s checks=5 issues=%d",
            self.tenant_id, len(issues),
        )
        return issues

    async def _check_edge_nodes_offline(self) -> list[dict[str, Any]]:
        """检查边缘节点是否离线（超过 EDGE_OFFLINE_THRESHOLD_SECONDS 无心跳）"""
        issues = []
        try:
            from lobster_registry_manager import list_edge_nodes
            nodes = list_edge_nodes(self.tenant_id)
            now = datetime.now(timezone.utc)
            for node in nodes:
                last_hb = node.get("last_heartbeat")
                if not last_hb:
                    continue
                try:
                    hb_dt = datetime.fromisoformat(last_hb.replace("Z", "+00:00"))
                    elapsed = (now - hb_dt).total_seconds()
                    if elapsed > EDGE_OFFLINE_THRESHOLD_SECONDS:
                        issues.append({
                            "check": "edge_offline",
                            "severity": "critical",
                            "node_id": node.get("node_id", "unknown"),
                            "message": f"边缘节点 {node.get('node_id')} 已离线 {elapsed:.0f}秒",
                            "elapsed_seconds": elapsed,
                            "action_required": "检查节点网络连接，或手动重启边缘代理",
                        })
                except (ValueError, TypeError):
                    pass
        except Exception as e:
            active_logger.warning("[ActiveCheck] edge_offline check failed: %s", e)
        return issues

    async def _check_task_queue_backlog(self) -> list[dict[str, Any]]:
        """检查任务队列积压"""
        issues = []
        try:
            from task_scheduler import get_pending_count
            count = get_pending_count(self.tenant_id)
            if count > TASK_QUEUE_BACKLOG_LIMIT:
                issues.append({
                    "check": "queue_backlog",
                    "severity": "warning",
                    "message": f"任务队列积压 {count} 条（阈值 {TASK_QUEUE_BACKLOG_LIMIT}）",
                    "pending_count": count,
                    "action_required": "检查 dispatcher/echoer 龙虾是否正常运行",
                })
        except Exception as e:
            active_logger.warning("[ActiveCheck] queue_backlog check failed: %s", e)
        return issues

    async def _check_overdue_publish_plans(self) -> list[dict[str, Any]]:
        """检查今日发布计划是否超时未执行"""
        issues = []
        try:
            from campaign_graph import get_overdue_plans
            overdue = get_overdue_plans(
                self.tenant_id,
                overdue_minutes=PUBLISH_PLAN_OVERDUE_MINUTES,
            )
            for plan in overdue:
                issues.append({
                    "check": "overdue_publish_plan",
                    "severity": "warning",
                    "plan_id": plan.get("plan_id"),
                    "message": f"发布计划 {plan.get('plan_id')} 已超时 {plan.get('overdue_minutes', 0)} 分钟未执行",
                    "action_required": "检查 dispatcher 龙虾状态，或手动触发发布",
                })
        except Exception as e:
            active_logger.warning("[ActiveCheck] overdue_publish check failed: %s", e)
        return issues

    async def _check_lobster_error_rates(self) -> list[dict[str, Any]]:
        """检查龙虾最近1小时错误率"""
        issues = []
        try:
            from lobster_pool_manager import pool_overview
            overview = pool_overview(self.tenant_id)
            for lobster in overview.get("lobsters", []):
                error_count = lobster.get("error_count_24h", 0)
                run_count = lobster.get("run_count_24h", 0)
                if run_count >= 5 and error_count / run_count > 0.5:
                    issues.append({
                        "check": "lobster_high_error_rate",
                        "severity": "warning",
                        "lobster_id": lobster.get("id"),
                        "message": f"龙虾 {lobster.get('id')} 错误率 {error_count}/{run_count}",
                        "action_required": "查看龙虾运行日志，检查 LLM Provider 状态",
                    })
        except Exception as e:
            active_logger.warning("[ActiveCheck] lobster_error_rate check failed: %s", e)
        return issues

    async def _check_backup_status(self) -> list[dict[str, Any]]:
        """检查备份状态（24小时内必须有成功备份）"""
        issues = []
        try:
            import os
            backup_dir = os.getenv("BACKUP_DIR", "./data/backups")
            from pathlib import Path
            backup_path = Path(backup_dir)
            if not backup_path.exists():
                issues.append({
                    "check": "backup_missing",
                    "severity": "warning",
                    "message": "备份目录不存在，请检查备份配置",
                    "action_required": "执行 scripts/backup.sh 手动备份",
                })
            else:
                # 检查最新备份文件时间
                backup_files = sorted(backup_path.glob("*.tar.gz"), key=lambda f: f.stat().st_mtime, reverse=True)
                if not backup_files:
                    issues.append({
                        "check": "backup_no_files",
                        "severity": "warning",
                        "message": "备份目录为空，24小时内没有备份",
                        "action_required": "执行 scripts/backup.sh 手动备份",
                    })
                else:
                    latest_age_hours = (time.time() - backup_files[0].stat().st_mtime) / 3600
                    if latest_age_hours > 25:
                        issues.append({
                            "check": "backup_stale",
                            "severity": "warning",
                            "message": f"最新备份已过期（{latest_age_hours:.1f}小时前）",
                            "action_required": "执行 scripts/backup.sh 更新备份",
                        })
        except Exception as e:
            active_logger.warning("[ActiveCheck] backup_status check failed: %s", e)
        return issues

    async def _send_active_alerts(self, issues: list[dict[str, Any]]) -> None:
        """发送主动巡查告警"""
        critical = [i for i in issues if i.get("severity") == "critical"]
        warnings = [i for i in issues if i.get("severity") == "warning"]
        
        message_parts = ["🔍 **主动巡查告警**\n"]
        if critical:
            message_parts.append("🔴 **严重问题**：")
            for issue in critical:
                message_parts.append(f"  - {issue['message']}")
                message_parts.append(f"    👉 {issue.get('action_required', '')}")
        if warnings:
            message_parts.append("⚠️ **警告**：")
            for issue in warnings:
                message_parts.append(f"  - {issue['message']}")
        
        message = "\n".join(message_parts)
        try:
            from notification_center import send_notification
            await send_notification(
                tenant_id=self.tenant_id,
                message=message,
                level="warning" if not critical else "critical",
                category="active_heartbeat",
            )
        except Exception as e:
            active_logger.warning("[ActiveCheck] Failed to send alert: %s", e)


# ── 全局实例（单例）──────────────────────────────────────────────

_active_checkers: dict[str, ActiveHeartbeatChecker] = {}

def get_active_checker(tenant_id: str = "tenant_main") -> ActiveHeartbeatChecker:
    if tenant_id not in _active_checkers:
        _active_checkers[tenant_id] = ActiveHeartbeatChecker(tenant_id)
    return _active_checkers[tenant_id]
```

---

### 2.2 注册到 cron_scheduler.py

**目标文件**：`dragon-senate-saas-v2/cron_scheduler.py`  
**修改方式**：新增30分钟主动巡查 Cron 任务

```python
# 在现有 Cron 任务列表中新增（不修改现有任务）

from heartbeat_engine import get_active_checker

async def _run_active_heartbeat_check(tenant_id: str = "tenant_main"):
    """主动巡查 Cron 任务"""
    checker = get_active_checker(tenant_id)
    issues = await checker.run_active_checks()
    return {"issues_found": len(issues), "tenant_id": tenant_id}

# 注册为每30分钟执行一次（在现有调度器注册逻辑中添加）
# cron_scheduler.register(
#     task_id="active_heartbeat_check",
#     coro_factory=_run_active_heartbeat_check,
#     interval_seconds=1800,  # 30分钟
#     description="主动心跳巡查（边缘节点离线/队列积压/发布计划超时）",
# )
```

---

### 2.3 新增 API 端点

```python
# GET /api/v1/heartbeat/active-check — 手动触发一次主动巡查
# GET /api/v1/heartbeat/active-check/history — 查询近期巡查结果

@app.get("/api/v1/heartbeat/active-check")
async def trigger_active_check(tenant_id: str = "tenant_main"):
    from heartbeat_engine import get_active_checker
    checker = get_active_checker(tenant_id)
    issues = await checker.run_active_checks()
    return {"issues": issues, "issue_count": len(issues), "tenant_id": tenant_id}
```

---

## 三、前端工程师对接说明

### 仪表板新增"主动巡查"卡片

```typescript
// 在 /dashboard 首页新增主动巡查状态卡片
interface ActiveHeartbeatCard {
  last_check_at: string;       // 上次巡查时间
  next_check_in_seconds: number; // 下次巡查倒计时
  current_issues: Array<{
    check: string;
    severity: "critical" | "warning";
    message: string;
    action_required: string;
  }>;
}

// 操作：
// [手动巡查] → GET /api/v1/heartbeat/active-check → 实时展示结果
```

---

## 四、验收标准

- [ ] `get_active_checker().run_active_checks()` 返回 issues 列表（不抛异常）
- [ ] 模拟边缘节点离线6分钟 → `_check_edge_nodes_offline()` 返回 critical issue
- [ ] 模拟队列积压60条 → `_check_task_queue_backlog()` 返回 warning issue
- [ ] cron_scheduler 注册了 `active_heartbeat_check`（30分钟间隔）
- [ ] GET /api/v1/heartbeat/active-check 返回 200 + issues 列表
- [ ] 发现 critical issue 时 notification_center 收到告警
- [ ] 现有被动式心跳 heartbeat_engine.py 不受影响

---

## 五、实施顺序

```
Day 1（4小时）：
  ① 冲突检查（4条 grep）
  ② 在 heartbeat_engine.py 末尾追加 ActiveHeartbeatChecker 类（5个 check 方法）
  ③ 在 cron_scheduler.py 注册30分钟主动巡查任务

Day 2（2小时）：
  ④ 在 app.py 新增 GET /api/v1/heartbeat/active-check 端点
  ⑤ 手动触发一次巡查，验证5个 check 都能正常执行
  ⑥ 更新 PROJECT_CONTROL_CENTER.md（标记 CODEX_IRONCLAW_HEARTBEAT_LOBSTER 为 ✅）
```

---

*创建时间：2026-04-01 | 来源：BORROWING_GAP_ANALYSIS_2026-04-01.md G07*
