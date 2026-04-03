# CODEX-HC-01: Commander HEARTBEAT 升级为 7 步管理例会

> **优先级**: P0 | **算力**: 中 | **来源**: `docs/HICLAW_BORROWING_ANALYSIS.md`
> **依赖**: CODEX-AA-01（heartbeat.json 基础结构）、CODEX-MC-01（BaseLobster 生命周期字段）
> **整合**: 本任务**升级**以下已有 Codex 任务的 heartbeat 部分：
>   - CODEX-AA-01 的 `heartbeat.json` 从简单 on_wake/periodic/stand_down → **7 步管理例会**
>   - CODEX-MC-01 的心跳检测循环 → 合入第 2/6 步

---

## 背景

HiClaw (3469⭐) 的 HEARTBEAT.md 不是简单的"还活着吗"检查，而是一个**完整的管理例会**——每个心跳周期，Manager 就像一个尽责的项目经理，逐项检查所有在途任务、团队状态、容量瓶颈，然后给老板一份简报。

我们在 CODEX-AA-01 中规划的 `heartbeat.json` 太简单了——只有 `on_wake`（醒来检查什么）、`periodic`（定时做什么）、`stand_down`（何时待机）。这种设计适合**单只龙虾**，但 Commander 需要的是**全局管理视角**。

## 目标

为 Commander 创建一个 **7 步管理例会** HEARTBEAT 检查清单，并在 `lobster_runner.py` 中实现 heartbeat 循环执行逻辑。

## 交付物

### 1. `packages/lobsters/lobster-commander/HEARTBEAT.md`

这是 Commander 的心跳检查清单，**不是代码文件**，而是 Commander 的 LLM 在每个心跳周期读取并执行的指令文档：

```markdown
# Commander 管理例会 — 心跳检查清单

> 每次心跳唤醒时，按顺序执行以下 7 步。如果某步骤没有异常，跳过进入下一步。

---

## 第 1 步：读取全局运行时状态

1. 读取 Commander 自身的 `working.json`
2. 读取 `lobsters-registry.json`（龙虾注册表，见 CODEX-HC-02）
3. 读取所有龙虾的 `working.json`
4. 确保管理员通知渠道可用

如果 `lobsters-registry.json` 不存在，先初始化。

---

## 第 2 步：有限任务跟进

遍历所有 `working.json` 中 `current_task` 不为 null 且 `task_type == "finite"` 的龙虾：

- 检查龙虾的 `last_seen_at`（来自 CODEX-MC-01 的生命周期字段）
- 如果龙虾超过 2 个心跳周期未响应，标记为 `stale`，通知 Commander
- 如果龙虾报告 `blocked_by` 不为空，检查阻塞项是否可解决
- 如果龙虾已完成但 `working.json` 未更新，主动更新状态
- 记录每只龙虾的进度到心跳报告

---

## 第 3 步：定时任务调度

遍历所有龙虾 `heartbeat.json` 中的 `periodic` 条目：

- 检查上次执行时间 (`last_executed_at`) 与当前时间的差
- 如果到期且未执行，触发对应龙虾执行该定时任务
- **防重入**：如果龙虾当前正在执行同类任务，跳过本次触发
- 更新 `last_executed_at` 和 `next_scheduled_at`

典型定时任务：
| 龙虾 | 定时任务 | 间隔 |
|------|---------|------|
| 触须虾 | scan_competitor_feeds | 30 分钟 |
| 触须虾 | check_trending_topics | 60 分钟 |
| 回访虾 | check_followup_schedule | 120 分钟 |
| 金算虾 | generate_daily_report | 24 小时 |

---

## 第 4 步：项目进度监控

如果当前有活跃的增长项目（MissionPlan 状态为 active）：

- 检查各阶段（信号→策略→内容→分发→互动→线索→复盘）的龙虾进度
- 如果某个阶段的龙虾已完成但下游龙虾未启动，主动触发下游
- 如果某个阶段的龙虾阻塞超过预设时间，升级告警
- 计算整体项目完成百分比

---

## 第 5 步：容量评估

统计当前龙虾池的工作状态：

| 状态 | 含义 |
|------|------|
| busy | 正在执行任务 |
| online | 空闲可用 |
| error | 出错 |
| offline | 离线 |

- 如果所有龙虾都 busy，评估是否有任务可以延后
- 如果有龙虾持续 error，建议人类管理员干预
- 检查每只龙虾的 token 使用量是否接近 dailyLimit（来自 role-card）

---

## 第 6 步：边缘执行端状态

检查边缘执行端（BBP/提线木偶）的连接状态：

- 通过 `ws_connection_manager` 检查 WebSocket 连接是否存活
- 如果边缘端超过 5 分钟无响应，标记为 `disconnected`
- 如果有待执行的分发任务但边缘端离线，通知点兵虾暂停发布
- 记录边缘端的执行成功率和错误率

---

## 第 7 步：向管理员报告

汇总前 6 步的发现：

- **全部正常**：`HEARTBEAT_OK`（不打扰管理员）
- **有异常**：生成简报，通过 `lobster_webhook` 推送到管理员

报告格式：
```
📋 龙虾元老院心跳报告 ({时间})

🟢 正常: {N}只龙虾正常运行
🟡 关注: {列出需要关注的项}
🔴 异常: {列出需要干预的项}

📊 任务概览:
- 进行中: {数量}
- 已完成: {数量}
- 阻塞: {数量}

💡 建议:
- {具体建议}
```
```

### 2. `dragon-senate-saas-v2/heartbeat_engine.py` — 心跳引擎

```python
"""
heartbeat_engine.py — Commander 心跳引擎

实现 7 步管理例会的自动化执行循环。
"""
import asyncio
import time
import json
import logging
from typing import Any, Optional
from pathlib import Path
from datetime import datetime, timezone

logger = logging.getLogger("heartbeat_engine")

# 心跳间隔（秒）
HEARTBEAT_INTERVAL_SEC = 300  # 5 分钟

# 定时任务追踪
_periodic_last_executed: dict[str, float] = {}


class HeartbeatEngine:
    """Commander 的 7 步心跳引擎"""

    def __init__(
        self,
        lobster_registry_path: Path | str = "lobsters-registry.json",
        working_dir: Path | str = "packages/lobsters",
    ):
        self.registry_path = Path(lobster_registry_path)
        self.working_dir = Path(working_dir)
        self._task: asyncio.Task[None] | None = None
        self._running = False

    # ── 生命周期 ──

    def start(self) -> None:
        """Start the heartbeat loop (call once at app startup)."""
        if self._task is None or self._task.done():
            self._running = True
            loop = asyncio.get_event_loop()
            self._task = loop.create_task(self._heartbeat_loop())
            logger.info("HeartbeatEngine started (interval=%ds)", HEARTBEAT_INTERVAL_SEC)

    def stop(self) -> None:
        """Stop the heartbeat loop."""
        self._running = False
        if self._task and not self._task.done():
            self._task.cancel()
            self._task = None
            logger.info("HeartbeatEngine stopped")

    async def _heartbeat_loop(self) -> None:
        while self._running:
            try:
                report = await self.run_heartbeat()
                if report["status"] != "HEARTBEAT_OK":
                    await self._notify_admin(report)
            except Exception as exc:
                logger.error("Heartbeat error: %s", exc, exc_info=True)
            await asyncio.sleep(HEARTBEAT_INTERVAL_SEC)

    # ── 7 步管理例会 ──

    async def run_heartbeat(self) -> dict[str, Any]:
        """Execute the 7-step management meeting."""
        report: dict[str, Any] = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "status": "HEARTBEAT_OK",
            "findings": [],
            "metrics": {},
        }

        # Step 1: 读取全局状态
        registry = self._load_registry()
        all_working = self._load_all_working(registry)

        # Step 2: 有限任务跟进
        finite_findings = self._check_finite_tasks(registry, all_working)
        report["findings"].extend(finite_findings)

        # Step 3: 定时任务调度
        periodic_findings = self._check_periodic_tasks(registry)
        report["findings"].extend(periodic_findings)

        # Step 4: 项目进度监控
        project_findings = self._check_project_progress(all_working)
        report["findings"].extend(project_findings)

        # Step 5: 容量评估
        capacity = self._assess_capacity(registry, all_working)
        report["metrics"]["capacity"] = capacity

        # Step 6: 边缘执行端状态
        edge_findings = self._check_edge_runtime()
        report["findings"].extend(edge_findings)

        # Step 7: 汇总判定
        if any(f["severity"] == "error" for f in report["findings"]):
            report["status"] = "HEARTBEAT_ALERT"
        elif any(f["severity"] == "warning" for f in report["findings"]):
            report["status"] = "HEARTBEAT_WARN"

        return report

    # ── Step 实现 ──

    def _load_registry(self) -> dict[str, Any]:
        if self.registry_path.exists():
            return json.loads(self.registry_path.read_text(encoding="utf-8"))
        return {}

    def _load_all_working(self, registry: dict) -> dict[str, dict]:
        result = {}
        for role_id in registry:
            working_path = self.working_dir / f"lobster-{role_id}" / "working.json"
            if working_path.exists():
                result[role_id] = json.loads(working_path.read_text(encoding="utf-8"))
            else:
                result[role_id] = {"current_task": None}
        return result

    def _check_finite_tasks(self, registry: dict, all_working: dict) -> list[dict]:
        findings = []
        for role_id, working in all_working.items():
            task = working.get("current_task")
            if task is None:
                continue
            # 检查是否超时
            started_at = task.get("started_at")
            if started_at:
                try:
                    start_time = datetime.fromisoformat(started_at.replace("Z", "+00:00"))
                    elapsed = (datetime.now(timezone.utc) - start_time).total_seconds()
                    if elapsed > 3600:  # 超过 1 小时
                        findings.append({
                            "severity": "warning",
                            "lobster": role_id,
                            "message": f"任务 {task.get('task_id', '?')} 已运行 {elapsed/60:.0f} 分钟",
                        })
                except (ValueError, TypeError):
                    pass
            # 检查阻塞
            blocked = working.get("blocked_by", [])
            if blocked:
                findings.append({
                    "severity": "warning",
                    "lobster": role_id,
                    "message": f"龙虾被阻塞: {', '.join(blocked)}",
                })
        return findings

    def _check_periodic_tasks(self, registry: dict) -> list[dict]:
        findings = []
        now = time.monotonic()
        for role_id in registry:
            hb_path = self.working_dir / f"lobster-{role_id}" / "heartbeat.json"
            if not hb_path.exists():
                continue
            hb = json.loads(hb_path.read_text(encoding="utf-8"))
            for periodic in hb.get("periodic", []):
                interval_sec = periodic.get("interval_minutes", 60) * 60
                task_key = f"{role_id}:{periodic['action']}"
                last = _periodic_last_executed.get(task_key, 0)
                if now - last >= interval_sec:
                    findings.append({
                        "severity": "info",
                        "lobster": role_id,
                        "message": f"定时任务 {periodic['action']} 到期，需触发执行",
                        "action": "trigger_periodic",
                        "task_key": task_key,
                    })
                    _periodic_last_executed[task_key] = now
        return findings

    def _check_project_progress(self, all_working: dict) -> list[dict]:
        findings = []
        # 检查龙虾链路是否有断裂
        pipeline = ["radar", "strategist", "inkwriter", "visualizer",
                     "dispatcher", "echoer", "catcher", "abacus", "followup"]
        for i, role_id in enumerate(pipeline[:-1]):
            current = all_working.get(role_id, {})
            next_role = pipeline[i + 1]
            next_w = all_working.get(next_role, {})
            # 如果当前龙虾已完成但下游未开始
            if (current.get("last_completed") and
                    not next_w.get("current_task") and
                    not next_w.get("last_completed")):
                findings.append({
                    "severity": "info",
                    "lobster": next_role,
                    "message": f"上游 {role_id} 已完成，但 {next_role} 尚未启动",
                    "action": "trigger_downstream",
                })
        return findings

    def _assess_capacity(self, registry: dict, all_working: dict) -> dict:
        busy = sum(1 for w in all_working.values() if w.get("current_task"))
        total = len(registry) or 9
        return {
            "total_lobsters": total,
            "busy": busy,
            "idle": total - busy,
            "utilization_pct": round(busy / max(total, 1) * 100, 1),
        }

    def _check_edge_runtime(self) -> list[dict]:
        findings = []
        # 检查 WebSocket 连接状态
        # 这里只做基础检查，具体实现取决于 ws_connection_manager 的 API
        try:
            from ws_connection_manager import get_active_connections
            connections = get_active_connections()
            if not connections:
                findings.append({
                    "severity": "warning",
                    "lobster": "dispatcher",
                    "message": "边缘执行端无活跃 WebSocket 连接",
                })
        except (ImportError, Exception):
            pass  # 模块不可用时静默跳过
        return findings

    async def _notify_admin(self, report: dict) -> None:
        """通过 webhook 通知管理员"""
        try:
            from lobster_webhook import send_webhook
            summary = self._format_report(report)
            await send_webhook("heartbeat_report", {"summary": summary, "report": report})
        except (ImportError, Exception) as exc:
            logger.warning("Failed to send heartbeat notification: %s", exc)

    def _format_report(self, report: dict) -> str:
        errors = [f for f in report["findings"] if f["severity"] == "error"]
        warnings = [f for f in report["findings"] if f["severity"] == "warning"]
        infos = [f for f in report["findings"] if f["severity"] == "info"]
        cap = report.get("metrics", {}).get("capacity", {})

        lines = [f"📋 龙虾元老院心跳报告 ({report['timestamp'][:19]})", ""]
        if not errors and not warnings:
            lines.append("🟢 全部正常")
        if errors:
            lines.append(f"🔴 异常 ({len(errors)}):")
            for e in errors:
                lines.append(f"  - [{e['lobster']}] {e['message']}")
        if warnings:
            lines.append(f"🟡 关注 ({len(warnings)}):")
            for w in warnings:
                lines.append(f"  - [{w['lobster']}] {w['message']}")
        lines.append(f"\n📊 容量: {cap.get('busy',0)}/{cap.get('total_lobsters',9)} 忙碌 ({cap.get('utilization_pct',0)}%)")
        return "\n".join(lines)
```

### 3. 测试文件 `dragon-senate-saas-v2/tests/test_heartbeat_engine.py`

```python
"""Tests for HeartbeatEngine 7-step management meeting."""
import json
import pytest
from pathlib import Path
from heartbeat_engine import HeartbeatEngine


@pytest.fixture
def tmp_env(tmp_path):
    """Set up a temporary working environment."""
    # 创建注册表
    registry = {"radar": {}, "strategist": {}, "inkwriter": {}}
    reg_path = tmp_path / "lobsters-registry.json"
    reg_path.write_text(json.dumps(registry), encoding="utf-8")

    # 创建 working 目录
    working_dir = tmp_path / "lobsters"
    for role in registry:
        d = working_dir / f"lobster-{role}"
        d.mkdir(parents=True)
        (d / "working.json").write_text(json.dumps({
            "current_task": None,
            "blocked_by": [],
        }), encoding="utf-8")
        (d / "heartbeat.json").write_text(json.dumps({
            "periodic": [
                {"action": "test_action", "interval_minutes": 60}
            ]
        }), encoding="utf-8")

    return HeartbeatEngine(
        lobster_registry_path=reg_path,
        working_dir=working_dir,
    )


class TestHeartbeatEngine:
    @pytest.mark.asyncio
    async def test_heartbeat_ok_when_all_idle(self, tmp_env):
        report = await tmp_env.run_heartbeat()
        assert report["status"] == "HEARTBEAT_OK"

    @pytest.mark.asyncio
    async def test_detects_blocked_lobster(self, tmp_env):
        # 设置 radar 为阻塞状态
        working_path = tmp_env.working_dir / "lobster-radar" / "working.json"
        working_path.write_text(json.dumps({
            "current_task": {"task_id": "t1", "started_at": "2026-03-31T00:00:00Z"},
            "blocked_by": ["waiting_for_api_key"],
        }), encoding="utf-8")
        report = await tmp_env.run_heartbeat()
        warnings = [f for f in report["findings"] if f["severity"] == "warning"]
        assert any("阻塞" in w["message"] for w in warnings)

    @pytest.mark.asyncio
    async def test_capacity_assessment(self, tmp_env):
        report = await tmp_env.run_heartbeat()
        cap = report["metrics"]["capacity"]
        assert cap["total_lobsters"] == 3
        assert cap["idle"] == 3
        assert cap["busy"] == 0

    @pytest.mark.asyncio
    async def test_periodic_task_detection(self, tmp_env):
        report = await tmp_env.run_heartbeat()
        periodic_findings = [f for f in report["findings"]
                           if f.get("action") == "trigger_periodic"]
        assert len(periodic_findings) >= 1

    def test_format_report_ok(self, tmp_env):
        report = {
            "timestamp": "2026-03-31T08:00:00Z",
            "status": "HEARTBEAT_OK",
            "findings": [],
            "metrics": {"capacity": {"total_lobsters": 9, "busy": 0, "idle": 9, "utilization_pct": 0}},
        }
        text = tmp_env._format_report(report)
        assert "全部正常" in text

    def test_format_report_with_errors(self, tmp_env):
        report = {
            "timestamp": "2026-03-31T08:00:00Z",
            "status": "HEARTBEAT_ALERT",
            "findings": [{"severity": "error", "lobster": "radar", "message": "超时"}],
            "metrics": {"capacity": {"total_lobsters": 9, "busy": 1, "idle": 8, "utilization_pct": 11.1}},
        }
        text = tmp_env._format_report(report)
        assert "异常" in text
        assert "radar" in text
```

---

## 约束

- `HEARTBEAT.md` 是给 Commander 的 LLM 读的**指令文档**，不是代码
- `heartbeat_engine.py` 是自动化执行引擎，Commander 可以选择用它或直接读 HEARTBEAT.md
- 心跳间隔默认 5 分钟，可通过环境变量 `HEARTBEAT_INTERVAL_SEC` 配置
- 不破坏 CODEX-AA-01 中每虾的 `heartbeat.json` 格式——那是单虾唤醒清单，本任务是 Commander 的全局管理例会
- 报告推送通过现有 `lobster_webhook.py`，不引入新的通知依赖

## 验收标准

1. `packages/lobsters/lobster-commander/HEARTBEAT.md` 包含完整 7 步检查清单
2. `dragon-senate-saas-v2/heartbeat_engine.py` 实现 7 步自动化逻辑
3. `pytest dragon-senate-saas-v2/tests/test_heartbeat_engine.py` 全部通过
4. HEARTBEAT_OK 时不通知管理员，有异常时自动推送简报
5. 不破坏现有功能

## 前端对齐

```typescript
// 新增 API 端点
GET /api/heartbeat/status     // 返回最新心跳报告
GET /api/heartbeat/history    // 返回历史心跳报告列表

interface HeartbeatReport {
  timestamp: string;
  status: "HEARTBEAT_OK" | "HEARTBEAT_WARN" | "HEARTBEAT_ALERT";
  findings: Array<{
    severity: "info" | "warning" | "error";
    lobster: string;
    message: string;
    action?: string;
  }>;
  metrics: {
    capacity: {
      total_lobsters: number;
      busy: number;
      idle: number;
      utilization_pct: number;
    };
  };
}
```
