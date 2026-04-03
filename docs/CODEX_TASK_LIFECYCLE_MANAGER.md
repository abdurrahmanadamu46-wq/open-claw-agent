# CODEX TASK: 实体生命周期管理 — lifecycle 字段 + LifecycleManager

**优先级：P1**  
**来源借鉴：Backstage catalog-model lifecycle 状态机（experimental/production/deprecated）**  
**参考分析：`docs/BACKSTAGE_BORROWING_ANALYSIS.md` 第二节 2.2、2.5**

---

## 背景

Backstage 的 lifecycle 字段是实体元数据中最实用的概念之一：每个实体有明确的生命周期状态（实验中/生产/废弃），UI 用不同颜色徽章展示，deprecated 实体自动降低优先级。

我们的龙虾/工作流/渠道账号目前没有统一的生命周期概念，运营人员无法一眼看出哪些能力是稳定可用的，哪些是实验中的。

---

## 任务目标

1. 新建 `dragon-senate-saas-v2/lifecycle_manager.py` — 统一生命周期管理
2. 升级 `lobsters-registry.json` — 增加 lifecycle/system/annotations 字段
3. 生命周期变更联动：deprecated 龙虾降低调度优先级 + 记录审计事件
4. 前端：统一 LifecycleBadge 组件（已在 CODEX_TASK_LOBSTER_ENTITY_PAGE.md 实现）

---

## 一、新建 `dragon-senate-saas-v2/lifecycle_manager.py`

```python
# lifecycle_manager.py
# 实体生命周期统一管理

from enum import Enum
from dataclasses import dataclass
from typing import Optional, Literal
from datetime import datetime

# ============================================================
# 生命周期状态定义
# ============================================================

class LobsterLifecycle(str, Enum):
    """龙虾生命周期"""
    EXPERIMENTAL = "experimental"   # 实验中：新技能测试，部分租户可用
    PRODUCTION = "production"       # 生产：稳定全量可用
    DEPRECATED = "deprecated"       # 废弃中：即将下线，通知用户迁移

class WorkflowLifecycle(str, Enum):
    """工作流生命周期"""
    DRAFT = "draft"           # 草稿：编辑中，未激活
    ACTIVE = "active"         # 激活：正常运行
    PAUSED = "paused"         # 暂停：临时停止
    ARCHIVED = "archived"     # 归档：永久停止，不可恢复

class ChannelLifecycle(str, Enum):
    """渠道账号生命周期"""
    ACTIVE = "active"         # 活跃：正常发布
    PAUSED = "paused"         # 暂停：暂停发布（如被平台限流）
    ARCHIVED = "archived"     # 归档：停止使用

# ============================================================
# 生命周期变更事件
# ============================================================

@dataclass
class LifecycleChangeEvent:
    entity_type: str            # "lobster" | "workflow" | "channel"
    entity_id: str
    entity_name: str
    old_lifecycle: str
    new_lifecycle: str
    changed_by: str             # user_id
    tenant_id: str
    reason: Optional[str] = None  # 变更原因（选填）
    changed_at: datetime = None

# ============================================================
# LifecycleManager
# ============================================================

class LifecycleManager:
    """
    统一生命周期管理器
    
    职责：
      1. 变更生命周期状态（带校验）
      2. 触发联动效果（deprecated → 降低调度优先级）
      3. 记录 AuditEvent（LIFECYCLE_CHANGED）
      4. 发送通知（deprecated 时通知受影响租户）
    """
    
    # ---- 状态变更规则（合法的状态转换）----
    LOBSTER_TRANSITIONS = {
        LobsterLifecycle.EXPERIMENTAL: [LobsterLifecycle.PRODUCTION, LobsterLifecycle.DEPRECATED],
        LobsterLifecycle.PRODUCTION: [LobsterLifecycle.DEPRECATED],
        LobsterLifecycle.DEPRECATED: [],  # 废弃是终态（不可撤销，只能新建替代版）
    }
    
    WORKFLOW_TRANSITIONS = {
        WorkflowLifecycle.DRAFT: [WorkflowLifecycle.ACTIVE, WorkflowLifecycle.ARCHIVED],
        WorkflowLifecycle.ACTIVE: [WorkflowLifecycle.PAUSED, WorkflowLifecycle.ARCHIVED],
        WorkflowLifecycle.PAUSED: [WorkflowLifecycle.ACTIVE, WorkflowLifecycle.ARCHIVED],
        WorkflowLifecycle.ARCHIVED: [],  # 归档是终态
    }
    
    CHANNEL_TRANSITIONS = {
        ChannelLifecycle.ACTIVE: [ChannelLifecycle.PAUSED, ChannelLifecycle.ARCHIVED],
        ChannelLifecycle.PAUSED: [ChannelLifecycle.ACTIVE, ChannelLifecycle.ARCHIVED],
        ChannelLifecycle.ARCHIVED: [],
    }
    
    async def change_lobster_lifecycle(
        self,
        lobster_id: str,
        new_lifecycle: LobsterLifecycle,
        changed_by: str,
        tenant_id: str,
        reason: Optional[str] = None
    ) -> LifecycleChangeEvent:
        """
        变更龙虾生命周期
        
        校验：
          1. 目标状态在合法转换列表中
          2. 如果是 deprecated，检查是否有依赖此龙虾的活跃工作流
        
        联动效果：
          experimental → production:
            - Feature Flag 全量开放（如有实验中的 flag）
          production → deprecated:
            - 调度优先级降为 0（不接新任务）
            - 给所有使用该龙虾的租户发通知（下线预告 + 迁移指引）
            - 在 feature_flags 中关闭该龙虾的所有 flag
        """
        # 查询当前状态
        lobster = await self._get_lobster(lobster_id)
        current_lifecycle = LobsterLifecycle(lobster.lifecycle)
        
        # 校验状态转换合法性
        allowed_transitions = self.LOBSTER_TRANSITIONS.get(current_lifecycle, [])
        if new_lifecycle not in allowed_transitions:
            raise ValueError(
                f"不允许的生命周期变更: {current_lifecycle} → {new_lifecycle}. "
                f"允许的变更: {allowed_transitions}"
            )
        
        # 执行变更
        await self._update_lobster_lifecycle(lobster_id, new_lifecycle)
        
        # 联动效果
        event = LifecycleChangeEvent(
            entity_type="lobster",
            entity_id=lobster_id,
            entity_name=lobster.name,
            old_lifecycle=current_lifecycle.value,
            new_lifecycle=new_lifecycle.value,
            changed_by=changed_by,
            tenant_id=tenant_id,
            reason=reason,
            changed_at=datetime.now()
        )
        
        await self._handle_lobster_lifecycle_effects(lobster, current_lifecycle, new_lifecycle)
        await self._record_audit_event(event)
        
        return event
    
    async def _handle_lobster_lifecycle_effects(
        self,
        lobster,
        old_lifecycle: LobsterLifecycle,
        new_lifecycle: LobsterLifecycle
    ):
        """生命周期变更联动效果"""
        
        if new_lifecycle == LobsterLifecycle.DEPRECATED:
            # 1. 调度优先级降为 0（lobster_pool_manager 中检查 lifecycle）
            await self._set_scheduling_priority(lobster.id, 0)
            
            # 2. 关闭该龙虾的所有 Feature Flag
            # await feature_flag_service.disable_all_flags_for_lobster(lobster.name)
            
            # 3. 给受影响租户发通知
            await self._notify_affected_tenants(
                lobster=lobster,
                message=f"龙虾「{lobster.display_name}」将在 30 天后下线，请迁移相关工作流"
            )
        
        elif new_lifecycle == LobsterLifecycle.PRODUCTION:
            # 恢复正常调度优先级
            await self._set_scheduling_priority(lobster.id, 100)
    
    async def change_workflow_lifecycle(
        self,
        workflow_id: str,
        new_lifecycle: WorkflowLifecycle,
        changed_by: str,
        tenant_id: str,
        reason: Optional[str] = None
    ) -> LifecycleChangeEvent:
        """变更工作流生命周期"""
        # 类似 change_lobster_lifecycle，此处略
        ...
    
    async def _record_audit_event(self, event: LifecycleChangeEvent):
        """记录 AuditEvent（LIFECYCLE_CHANGED）"""
        from tenant_audit_log import AuditEventType, log
        await log(
            event_type=AuditEventType.LOBSTER_CONFIG_UPDATE,  # 或新增 LIFECYCLE_CHANGED 类型
            tenant_id=event.tenant_id,
            user_id=event.changed_by,
            resource_type=event.entity_type,
            resource_id=event.entity_id,
            details={
                "old_lifecycle": event.old_lifecycle,
                "new_lifecycle": event.new_lifecycle,
                "reason": event.reason
            }
        )

# ============================================================
# 调度层集成（lobster_pool_manager.py）
# ============================================================
# 在 lobster_pool_manager.py 中，调度龙虾时检查 lifecycle：

def should_schedule_lobster(lobster: dict) -> bool:
    """deprecated 的龙虾不接新任务"""
    lifecycle = lobster.get("lifecycle", "production")
    if lifecycle == "deprecated":
        return False
    if lifecycle == "experimental":
        # experimental 龙虾只对 feature flag 开启的租户调度
        return True  # 由 feature_flags.py 进一步过滤
    return True
```

---

## 二、升级 `lobsters-registry.json`

为所有龙虾增加 lifecycle/system/annotations 字段：

```json
{
  "lobsters": [
    {
      "id": "radar-lintao",
      "name": "radar",
      "display_name": "林涛（Radar）",
      "description": "竞品情报侦察，市场趋势监控",
      "lifecycle": "production",
      "system": "content-intelligence",
      "tags": ["monitor", "data-collection", "critical"],
      "annotations": {
        "openclaw/prompt-version": "v2",
        "openclaw/avg-quality-score": "8.2",
        "openclaw/edge-compatible": "true",
        "openclaw/last-upgraded": "2026-03-15"
      },
      "skills": ["competitive_monitor", "trend_analysis", "hot_topic_alert"],
      "dependsOn": ["resource:redis", "api:search-api"]
    },
    {
      "id": "inkwriter-moxiaoya",
      "name": "inkwriter",
      "display_name": "墨小雅（InkWriter）",
      "description": "文案创作、脚本生成、产品描述",
      "lifecycle": "production",
      "system": "content-production",
      "tags": ["writing", "creative", "llm-heavy"],
      "annotations": {
        "openclaw/prompt-version": "v1",
        "openclaw/avg-quality-score": "8.4",
        "openclaw/edge-compatible": "true",
        "openclaw/ab-experiment": "inkwriter.prompt_v2"
      },
      "skills": ["voiceover_script", "product_description", "social_copy"],
      "dependsOn": ["resource:prompt-registry", "api:llm-provider"]
    }
  ],
  "systems": [
    {
      "name": "content-intelligence",
      "description": "内容情报与策略分析",
      "lobsters": ["radar", "strategist"]
    },
    {
      "name": "content-production",
      "description": "内容创作与视觉生成",
      "lobsters": ["inkwriter", "visualizer"]
    },
    {
      "name": "channel-delivery",
      "description": "渠道分发与互动运营",
      "lobsters": ["dispatcher", "echoer", "catcher"]
    },
    {
      "name": "follow-growth",
      "description": "数据分析与复盘优化",
      "lobsters": ["abacus", "followup"]
    }
  ]
}
```

---

## 三、后端 API

```
GET    /api/v1/lobsters/{id}/lifecycle            → 获取当前 lifecycle
PUT    /api/v1/lobsters/{id}/lifecycle            → 变更 lifecycle
  Body: { new_lifecycle: "production", reason: "经过30天实验验证稳定" }

GET    /api/v1/workflows/{id}/lifecycle           → 工作流 lifecycle
PUT    /api/v1/workflows/{id}/lifecycle           → 变更工作流 lifecycle

GET    /api/v1/lobsters?lifecycle=experimental    → 按 lifecycle 过滤龙虾列表
GET    /api/v1/lobsters?lifecycle=deprecated      → 查看待下线龙虾
```

---

## 四、TypeScript 类型更新

更新 `web/src/types/lobster.ts`（已在 CODEX_TASK_LOBSTER_ENTITY_PAGE 中定义）：

```typescript
export type Lifecycle = 'experimental' | 'production' | 'deprecated';

// 生命周期变更请求
export interface LifecycleChangeRequest {
  new_lifecycle: Lifecycle;
  reason?: string;
}

// 生命周期变更历史
export interface LifecycleChangeEvent {
  entity_type: 'lobster' | 'workflow' | 'channel';
  entity_id: string;
  entity_name: string;
  old_lifecycle: string;
  new_lifecycle: string;
  changed_by: string;
  reason?: string;
  changed_at: string;
}
```

---

## 五、PROJECT_CONTROL_CENTER.md 同步更新

完成后：

1. **第三节"当前成熟能力"** 增加：
   ```
   ✅ lifecycle_manager.py 实体生命周期管理（experimental/production/deprecated）
   ✅ lobsters-registry.json 增加 lifecycle/system/annotations 字段
   ✅ deprecated 龙虾自动降低调度优先级 + 通知租户
   ```

2. **第七节"已落地借鉴清单"** 增加：
   ```
   | Backstage | 实体生命周期管理（experimental/production/deprecated）| ✅ | lifecycle_manager.py |
   ```

---

## 验收标准

- [ ] `lifecycle_manager.py` 实现完整（LobsterLifecycle/WorkflowLifecycle/ChannelLifecycle）
- [ ] 状态转换校验：非法转换抛出 ValueError
- [ ] deprecated 龙虾调度优先级降为 0
- [ ] deprecated 时向受影响租户发送通知
- [ ] `lobsters-registry.json` 所有龙虾增加 lifecycle/system/annotations
- [ ] `systems` 字段定义4个子系统
- [ ] 后端 `PUT /api/v1/lobsters/{id}/lifecycle` 端点可用
- [ ] `lobster_pool_manager.py` 调度时检查 lifecycle（deprecated → 跳过）
- [ ] 生命周期变更记录到 AuditLog
- [ ] 前端龙虾列表支持按 lifecycle 筛选

---

*Codex Task | 来源：BACKSTAGE_BORROWING_ANALYSIS.md P1-#3 | 2026-04-02*
