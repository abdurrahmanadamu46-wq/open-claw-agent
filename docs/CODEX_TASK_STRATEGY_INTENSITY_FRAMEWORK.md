# CODEX-PC-02: 策略强度递进框架

> **优先级**: P1 | **算力**: 低 | **来源**: `docs/PUACLAW_BORROWING_ANALYSIS.md`
> **关联**: CODEX-HC-06 (YOLO / Autonomy L1-L3) — 本任务为其提供**业务语义层**
> **涉及文件**: `packages/lobsters/strategy-intensity-framework.json`、`dragon-senate-saas-v2/commander_router.py`、`dragon-senate-saas-v2/lobster_runner.py`

---

## 背景

PUAClaw 的 PPE-T 四级体系（温柔劝导→适度施压→高级操控→核武级）本质上是一套**策略强度递进框架**。当前我们的 Commander 路由缺少这种分级机制——所有策略执行用同一强度，无法根据风险等级自动调整龙虾的自主权和资源上限。

CODEX-HC-06 定义的是技术层面的 L1/L2/L3 autonomy 开关，本任务定义的是**业务层面**的策略强度语义。两者结合才能形成完整的分级治理。

## 目标

建立 4 级策略强度递进框架，让 Commander 在编排龙虾任务时，根据策略强度自动调整执行参数。

## 交付物

### 1. `packages/lobsters/strategy-intensity-framework.json`

```json
{
  "version": "1.0.0",
  "description": "策略强度递进框架 — 定义 4 级策略执行参数",
  "levels": [
    {
      "level": 1,
      "name": "L1-观察",
      "label": "🟢 观察期",
      "description": "低风险探索，以收集信号为主，不主动触达用户",
      "autonomy": "auto",
      "approval_required": false,
      "resource_limits": {
        "max_daily_posts": 2,
        "max_daily_replies": 10,
        "max_daily_dms": 0,
        "max_llm_calls_per_task": 5,
        "allowed_channels": ["content_publish"]
      },
      "risk_threshold": 0.3,
      "rollback_policy": "auto",
      "applicable_scenarios": ["新行业首次进入", "新渠道测试", "品牌冷启动"],
      "typical_lobsters": ["radar", "strategist", "inkwriter"],
      "escalation_trigger": "连续 3 天信号质量评分 > 70 → 升级到 L2"
    },
    {
      "level": 2,
      "name": "L2-试探",
      "label": "🟡 试探期",
      "description": "中低风险，开始主动内容投放和互动，执行前通知人类",
      "autonomy": "notify",
      "approval_required": false,
      "resource_limits": {
        "max_daily_posts": 5,
        "max_daily_replies": 50,
        "max_daily_dms": 10,
        "max_llm_calls_per_task": 15,
        "allowed_channels": ["content_publish", "comment_reply"]
      },
      "risk_threshold": 0.5,
      "rollback_policy": "auto_with_alert",
      "applicable_scenarios": ["内容投放验证期", "互动策略试水", "话术 A/B 测试"],
      "typical_lobsters": ["inkwriter", "visualizer", "dispatcher", "echoer"],
      "escalation_trigger": "连续 7 天 ROI > 1.5 → 升级到 L3"
    },
    {
      "level": 3,
      "name": "L3-主攻",
      "label": "🟠 主攻期",
      "description": "中高风险，全链路龙虾协作执行，关键动作需人类审批",
      "autonomy": "approve",
      "approval_required": true,
      "resource_limits": {
        "max_daily_posts": 15,
        "max_daily_replies": 200,
        "max_daily_dms": 50,
        "max_llm_calls_per_task": 50,
        "allowed_channels": ["content_publish", "comment_reply", "dm_outreach", "lead_capture"]
      },
      "risk_threshold": 0.7,
      "rollback_policy": "manual_confirm",
      "applicable_scenarios": ["成熟渠道放量", "促销活动期", "竞品攻防"],
      "typical_lobsters": ["all"],
      "escalation_trigger": "单日预算消耗 > 80% 或负面舆情 > 5% → 人工决策是否升级到 L4"
    },
    {
      "level": 4,
      "name": "L4-极限",
      "label": "🔴 极限模式",
      "description": "高风险，全量资源投入，Commander + 人类双重确认",
      "autonomy": "dual_confirm",
      "approval_required": true,
      "resource_limits": {
        "max_daily_posts": 50,
        "max_daily_replies": 500,
        "max_daily_dms": 200,
        "max_llm_calls_per_task": 100,
        "allowed_channels": ["content_publish", "comment_reply", "dm_outreach", "lead_capture", "paid_promotion"]
      },
      "risk_threshold": 0.9,
      "rollback_policy": "emergency_halt",
      "applicable_scenarios": ["限时大促", "危机公关", "市场抢占窗口"],
      "typical_lobsters": ["all"],
      "escalation_trigger": "N/A — 最高级别，只能降级"
    }
  ],
  "default_level": 1,
  "downgrade_rules": {
    "negative_sentiment_spike": "当前级别 - 1",
    "budget_exhausted": "降至 L1",
    "platform_violation": "降至 L1 + 人工复核",
    "human_override": "任意级别"
  }
}
```

### 2. Commander Router 集成

在 `commander_router.py` 中增加策略强度感知：

```python
import json
from pathlib import Path

class StrategyIntensityManager:
    """策略强度管理器"""
    
    def __init__(self, framework_path: str = "packages/lobsters/strategy-intensity-framework.json"):
        with open(framework_path, "r", encoding="utf-8") as f:
            self._framework = json.load(f)
        self._current_level = self._framework.get("default_level", 1)
    
    @property
    def current_level(self) -> int:
        return self._current_level
    
    @property
    def current_config(self) -> dict:
        for level in self._framework["levels"]:
            if level["level"] == self._current_level:
                return level
        return self._framework["levels"][0]
    
    def get_resource_limits(self) -> dict:
        return self.current_config.get("resource_limits", {})
    
    def requires_approval(self) -> bool:
        return self.current_config.get("approval_required", True)
    
    def escalate(self) -> bool:
        if self._current_level < 4:
            self._current_level += 1
            return True
        return False
    
    def deescalate(self, reason: str = "") -> bool:
        if self._current_level > 1:
            self._current_level -= 1
            return True
        return False
    
    def check_limits(self, action: str, count: int) -> bool:
        limits = self.get_resource_limits()
        limit_key = f"max_daily_{action}"
        max_val = limits.get(limit_key)
        if max_val is not None and count >= max_val:
            return False
        return True
```

### 3. lobster_runner.py 集成

在执行龙虾任务前，检查策略强度限制：

```python
# 在 run_lobster_step() 入口
intensity_mgr = get_strategy_intensity_manager()
if not intensity_mgr.check_limits(action_type, daily_count):
    return {"status": "blocked", "reason": f"策略强度 {intensity_mgr.current_config['name']} 限制: {action_type} 已达上限"}
if intensity_mgr.requires_approval() and not task.get("approved"):
    return {"status": "pending_approval", "level": intensity_mgr.current_config['name']}
```

### 4. 前端对齐

前端需展示当前策略强度级别：

```typescript
// GET /api/strategy/intensity 返回
interface StrategyIntensity {
  current_level: number;     // 1-4
  name: string;              // "L1-观察"
  label: string;             // "🟢 观察期"
  approval_required: boolean;
  resource_limits: Record<string, number>;
  escalation_trigger: string;
}
```

- 在策略面板顶部显示当前强度级别（彩色徽章）
- 支持人工升/降级按钮
- 显示当前日资源消耗 vs 上限进度条

## 约束

- 策略强度是**租户级别**配置，不同客户可以有不同的当前级别
- L4 极限模式只能由人类手动开启，Commander 不能自动升级到 L4
- 降级操作立即生效，正在执行的任务需要检查新限制

## 验收标准

1. `strategy-intensity-framework.json` 存在且包含 4 级完整定义
2. `StrategyIntensityManager` 类可正确读取框架、检查限制、升降级
3. `lobster_runner.py` 在执行前检查策略强度限制
4. API 端点 `GET /api/strategy/intensity` 返回当前级别信息
5. 前端策略面板展示当前强度级别
