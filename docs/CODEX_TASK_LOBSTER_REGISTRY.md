# CODEX-HC-02: 龙虾注册表 (lobsters-registry.json)

> **优先级**: P0 | **算力**: 低 | **来源**: `docs/HICLAW_BORROWING_ANALYSIS.md`
> **依赖**: CODEX-MC-01（BaseLobster 生命周期字段）
> **被依赖**: CODEX-HC-01（HeartbeatEngine 读取注册表）

---

## 背景

HiClaw 的 `workers-registry.json` 是 Manager 管理所有 Worker 的**单一真相源**——记录每个 Worker 的 ID、通信通道、技能列表、MCP 权限、运行状态、最后心跳等。

我们当前龙虾信息散落在多个位置：
- `lobster_pool_manager.py` 的 `LOBSTER_REGISTRY`（硬编码字典，仅含中文名/显示名）
- `lobster_skill_registry.py` 的技能绑定
- `base_lobster.py` 的运行时实例属性
- 各 `role-card.json` 的静态配置

没有一个统一的、Commander 可直接读取的"龙虾花名册"。

## 目标

创建 `lobsters-registry.json` 作为 Commander 管理龙虾池的单一真相源，并在启动时从现有配置自动生成。

## 交付物

### 1. `dragon-senate-saas-v2/lobsters-registry.json`（初始化模板）

```json
{
  "$schema": "lobsters-registry-v1",
  "updated_at": null,
  "lobsters": {
    "radar": {
      "display_name": "Radar",
      "zh_name": "触须虾",
      "status": "idle",
      "phase": "① 信号发现",
      "skills": ["radar_web_search", "radar_trend_analysis", "radar_competitor_tracking", "radar_hot_topic_monitor", "radar_sentiment_alert", "radar_user_profiling", "radar_industry_report", "radar_social_listening"],
      "upstream": [],
      "downstream": ["strategist"],
      "last_heartbeat": null,
      "last_task_id": null,
      "error_count": 0,
      "run_count": 0,
      "token_usage_today": 0,
      "created_at": null
    },
    "strategist": {
      "display_name": "Strategist",
      "zh_name": "脑虫虾",
      "status": "idle",
      "phase": "② 策略制定",
      "skills": ["strategist_goal_decompose", "strategist_calendar_plan", "strategist_adaptive_route", "strategist_budget_allocate", "strategist_ab_test_design", "strategist_risk_assess", "strategist_milestone_track"],
      "upstream": ["radar"],
      "downstream": ["inkwriter", "visualizer"],
      "last_heartbeat": null,
      "last_task_id": null,
      "error_count": 0,
      "run_count": 0,
      "token_usage_today": 0,
      "created_at": null
    },
    "inkwriter": {
      "display_name": "InkWriter",
      "zh_name": "吐墨虾",
      "status": "idle",
      "phase": "③-A 文案",
      "skills": ["inkwriter_copy_generate", "inkwriter_platform_adapt", "inkwriter_compliance_check", "inkwriter_dm_script", "inkwriter_headline_optimize"],
      "upstream": ["strategist"],
      "downstream": ["visualizer", "dispatcher"],
      "last_heartbeat": null,
      "last_task_id": null,
      "error_count": 0,
      "run_count": 0,
      "token_usage_today": 0,
      "created_at": null
    },
    "visualizer": {
      "display_name": "Visualizer",
      "zh_name": "幻影虾",
      "status": "idle",
      "phase": "③-B 视觉",
      "skills": ["visualizer_storyboard", "visualizer_ai_image", "visualizer_digital_human", "visualizer_video_edit", "visualizer_subtitle", "visualizer_cover_optimize", "visualizer_template_manage", "visualizer_brand_kit"],
      "upstream": ["strategist", "inkwriter"],
      "downstream": ["dispatcher"],
      "last_heartbeat": null,
      "last_task_id": null,
      "error_count": 0,
      "run_count": 0,
      "token_usage_today": 0,
      "created_at": null
    },
    "dispatcher": {
      "display_name": "Dispatcher",
      "zh_name": "点兵虾",
      "status": "idle",
      "phase": "④ 分发",
      "skills": ["dispatcher_task_split", "dispatcher_schedule_publish", "dispatcher_account_rotate", "dispatcher_emergency_recall"],
      "upstream": ["inkwriter", "visualizer"],
      "downstream": ["echoer"],
      "last_heartbeat": null,
      "last_task_id": null,
      "error_count": 0,
      "run_count": 0,
      "token_usage_today": 0,
      "created_at": null
    },
    "echoer": {
      "display_name": "Echoer",
      "zh_name": "回声虾",
      "status": "idle",
      "phase": "⑤-A 互动",
      "skills": ["echoer_reply_generate", "echoer_comment_manage", "echoer_dm_reply", "echoer_wechat_funnel"],
      "upstream": ["dispatcher"],
      "downstream": ["catcher"],
      "last_heartbeat": null,
      "last_task_id": null,
      "error_count": 0,
      "run_count": 0,
      "token_usage_today": 0,
      "created_at": null
    },
    "catcher": {
      "display_name": "Catcher",
      "zh_name": "铁网虾",
      "status": "idle",
      "phase": "⑤-B 线索",
      "skills": ["catcher_lead_score", "catcher_crm_sync", "catcher_dedup"],
      "upstream": ["echoer"],
      "downstream": ["followup", "abacus"],
      "last_heartbeat": null,
      "last_task_id": null,
      "error_count": 0,
      "run_count": 0,
      "token_usage_today": 0,
      "created_at": null
    },
    "abacus": {
      "display_name": "Abacus",
      "zh_name": "金算虾",
      "status": "idle",
      "phase": "⑦ 复盘",
      "skills": ["abacus_roi_calc", "abacus_attribution", "abacus_report_generate", "abacus_feedback_loop"],
      "upstream": ["catcher", "followup"],
      "downstream": ["radar"],
      "last_heartbeat": null,
      "last_task_id": null,
      "error_count": 0,
      "run_count": 0,
      "token_usage_today": 0,
      "created_at": null
    },
    "followup": {
      "display_name": "FollowUp",
      "zh_name": "回访虾",
      "status": "idle",
      "phase": "⑥ 跟进",
      "skills": ["followup_sop_generate", "followup_multi_touch", "followup_reactivate"],
      "upstream": ["catcher"],
      "downstream": ["abacus"],
      "last_heartbeat": null,
      "last_task_id": null,
      "error_count": 0,
      "run_count": 0,
      "token_usage_today": 0,
      "created_at": null
    }
  }
}
```

### 2. `dragon-senate-saas-v2/lobster_registry_manager.py`

```python
"""
lobster_registry_manager.py — 龙虾注册表管理器

维护 lobsters-registry.json 作为 Commander 管理龙虾池的单一真相源。
借鉴 HiClaw 的 workers-registry.json 模式。
"""
import json
import time
from pathlib import Path
from typing import Any, Optional
from datetime import datetime, timezone

REGISTRY_PATH = Path("lobsters-registry.json")


def load_registry(path: Path = REGISTRY_PATH) -> dict[str, Any]:
    """Load the lobsters registry from disk."""
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return {"$schema": "lobsters-registry-v1", "updated_at": None, "lobsters": {}}


def save_registry(registry: dict[str, Any], path: Path = REGISTRY_PATH) -> None:
    """Persist the registry to disk."""
    registry["updated_at"] = datetime.now(timezone.utc).isoformat()
    path.write_text(json.dumps(registry, ensure_ascii=False, indent=2), encoding="utf-8")


def update_lobster_status(role_id: str, status: str, path: Path = REGISTRY_PATH) -> bool:
    """Update a lobster's status field."""
    reg = load_registry(path)
    lobster = reg.get("lobsters", {}).get(role_id)
    if lobster is None:
        return False
    lobster["status"] = status
    save_registry(reg, path)
    return True


def record_heartbeat(role_id: str, path: Path = REGISTRY_PATH) -> bool:
    """Record a heartbeat timestamp for a lobster."""
    reg = load_registry(path)
    lobster = reg.get("lobsters", {}).get(role_id)
    if lobster is None:
        return False
    lobster["last_heartbeat"] = datetime.now(timezone.utc).isoformat()
    save_registry(reg, path)
    return True


def record_task_complete(role_id: str, task_id: str, path: Path = REGISTRY_PATH) -> bool:
    """Record that a lobster completed a task."""
    reg = load_registry(path)
    lobster = reg.get("lobsters", {}).get(role_id)
    if lobster is None:
        return False
    lobster["last_task_id"] = task_id
    lobster["run_count"] = lobster.get("run_count", 0) + 1
    lobster["status"] = "idle"
    save_registry(reg, path)
    return True


def record_error(role_id: str, path: Path = REGISTRY_PATH) -> bool:
    """Increment error count for a lobster."""
    reg = load_registry(path)
    lobster = reg.get("lobsters", {}).get(role_id)
    if lobster is None:
        return False
    lobster["error_count"] = lobster.get("error_count", 0) + 1
    lobster["status"] = "error"
    save_registry(reg, path)
    return True


def increment_token_usage(role_id: str, tokens: int, path: Path = REGISTRY_PATH) -> bool:
    """Add token usage for a lobster."""
    reg = load_registry(path)
    lobster = reg.get("lobsters", {}).get(role_id)
    if lobster is None:
        return False
    lobster["token_usage_today"] = lobster.get("token_usage_today", 0) + tokens
    save_registry(reg, path)
    return True


def reset_daily_token_usage(path: Path = REGISTRY_PATH) -> None:
    """Reset all lobsters' daily token usage (call at midnight)."""
    reg = load_registry(path)
    for lobster in reg.get("lobsters", {}).values():
        lobster["token_usage_today"] = 0
    save_registry(reg, path)


def get_lobster_summary(path: Path = REGISTRY_PATH) -> list[dict[str, Any]]:
    """Return a summary list for dashboard display."""
    reg = load_registry(path)
    return [
        {
            "role_id": role_id,
            "zh_name": data.get("zh_name"),
            "display_name": data.get("display_name"),
            "status": data.get("status"),
            "phase": data.get("phase"),
            "last_heartbeat": data.get("last_heartbeat"),
            "error_count": data.get("error_count", 0),
            "run_count": data.get("run_count", 0),
            "token_usage_today": data.get("token_usage_today", 0),
        }
        for role_id, data in reg.get("lobsters", {}).items()
    ]
```

### 3. 测试文件 `dragon-senate-saas-v2/tests/test_lobster_registry_manager.py`

覆盖：
- `load_registry` / `save_registry` 读写
- `update_lobster_status` 状态更新
- `record_heartbeat` 心跳记录
- `record_task_complete` 任务完成
- `record_error` 错误累加
- `increment_token_usage` / `reset_daily_token_usage`
- `get_lobster_summary` 摘要列表

### 4. 与现有代码的整合

在 `lobster_runner.py` 执行前后调用注册表更新：

```python
from lobster_registry_manager import (
    update_lobster_status, record_heartbeat,
    record_task_complete, record_error, increment_token_usage,
)

# 执行前
update_lobster_status(lobster.role_id, "busy")
record_heartbeat(lobster.role_id)

# 执行成功后
record_task_complete(lobster.role_id, task_id)

# 执行失败后
record_error(lobster.role_id)
```

### 5. 重复内容处理

`lobster_pool_manager.py` 中的 `LOBSTER_REGISTRY` 硬编码字典标记为 deprecated，改为从 `lobsters-registry.json` 读取：

```python
# DEPRECATED: Use lobsters-registry.json instead
# LOBSTER_REGISTRY = { ... }

def get_lobster_registry():
    """Read from lobsters-registry.json (single source of truth)."""
    from lobster_registry_manager import load_registry
    return load_registry().get("lobsters", {})
```

---

## 约束

- `lobsters-registry.json` 是 JSON 文件，不是 SQLite
- 每次写入都是全量写入（文件小，性能无问题）
- Commander 只读、LobsterRunner 读写
- 不引入外部依赖

## 验收标准

1. `lobsters-registry.json` 包含 9 只龙虾的完整注册信息
2. `lobster_registry_manager.py` 所有函数测试通过
3. `lobster_runner.py` 在执行前后自动更新注册表
4. `lobster_pool_manager.py` 的 `LOBSTER_REGISTRY` 标记为 deprecated
5. `GET /api/lobsters/registry` 返回注册表摘要

## 前端对齐

```typescript
GET /api/lobsters/registry   // 返回龙虾注册表摘要

interface LobsterRegistryEntry {
  role_id: string;
  zh_name: string;
  display_name: string;
  status: "idle" | "busy" | "error" | "offline";
  phase: string;
  last_heartbeat: string | null;
  error_count: number;
  run_count: number;
  token_usage_today: number;
}
```
