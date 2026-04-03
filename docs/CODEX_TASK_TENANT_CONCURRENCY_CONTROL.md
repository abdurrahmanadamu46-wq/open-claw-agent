# CODEX TASK: 租户级并发控制（Queue Concurrency Limits）

**优先级：P1**  
**来源：TRIGGERDEV_BORROWING_ANALYSIS.md P1-#3（Trigger.dev Concurrency Limits）**

---

## 背景

多租户 SaaS 场景下，单个大客户可能触发大量并发任务，占用全部 LLM 调用配额，导致其他租户的任务长时间排队。借鉴 Trigger.dev Concurrency Limits，实现队列级 + 租户级并发控制，与已有的 quota_middleware 联动构成完整资源管控。

---

## 一、并发控制配置模型

```python
# dragon-senate-saas-v2/concurrency_config.py

from dataclasses import dataclass
from typing import Optional

@dataclass
class TenantConcurrencyConfig:
    """租户并发控制配置"""
    tenant_id: str
    plan_tier: str          # "free" | "standard" | "premium" | "enterprise"
    
    # 并发限制
    max_concurrent_workflows: int   # 同时运行的工作流数
    max_concurrent_steps: int       # 同时运行的步骤数（跨工作流）
    max_queue_depth: int            # 队列积压上限（超出拒绝新任务）
    
    # 速率限制（补充并发控制）
    workflow_per_minute: int        # 每分钟最多触发工作流数

# 默认各套餐配置
PLAN_CONCURRENCY_DEFAULTS = {
    "free":       TenantConcurrencyConfig("*", "free",       max_concurrent_workflows=1,  max_concurrent_steps=3,  max_queue_depth=5,   workflow_per_minute=5),
    "standard":   TenantConcurrencyConfig("*", "standard",   max_concurrent_workflows=3,  max_concurrent_steps=10, max_queue_depth=20,  workflow_per_minute=30),
    "premium":    TenantConcurrencyConfig("*", "premium",    max_concurrent_workflows=10, max_concurrent_steps=30, max_queue_depth=100, workflow_per_minute=100),
    "enterprise": TenantConcurrencyConfig("*", "enterprise", max_concurrent_workflows=50, max_concurrent_steps=150,max_queue_depth=500, workflow_per_minute=500),
}
```

---

## 二、并发控制器（Redis 实现）

```python
# dragon-senate-saas-v2/concurrency_controller.py

import redis.asyncio as redis
import asyncio

class ConcurrencyController:
    """
    基于 Redis 的并发控制器
    使用 Redis INCR/DECR + TTL 实现原子计数
    """

    def __init__(self, redis_client: redis.Redis):
        self.redis = redis_client

    def _key(self, tenant_id: str, resource: str) -> str:
        return f"concurrency:{tenant_id}:{resource}"

    async def acquire(
        self,
        tenant_id: str,
        resource: str,           # "workflows" | "steps"
        max_limit: int,
        timeout_seconds: int = 3600,
    ) -> bool:
        """
        尝试获取并发槽位
        返回 True：成功获取（可以执行）
        返回 False：已达上限（需排队）
        """
        key = self._key(tenant_id, resource)
        
        # Lua 脚本保证原子性（INCR + 条件检查）
        lua_script = """
        local current = redis.call('INCR', KEYS[1])
        if current > tonumber(ARGV[1]) then
            redis.call('DECR', KEYS[1])
            return 0
        end
        redis.call('EXPIRE', KEYS[1], tonumber(ARGV[2]))
        return current
        """
        result = await self.redis.eval(lua_script, 1, key, max_limit, timeout_seconds)
        return result > 0

    async def release(self, tenant_id: str, resource: str):
        """释放并发槽位"""
        key = self._key(tenant_id, resource)
        current = await self.redis.decr(key)
        if current < 0:
            await self.redis.set(key, 0)  # 防止计数器为负

    async def get_current(self, tenant_id: str, resource: str) -> int:
        """查询当前并发数"""
        key = self._key(tenant_id, resource)
        val = await self.redis.get(key)
        return int(val) if val else 0

    async def get_all_stats(self, tenant_id: str) -> dict:
        """获取租户并发统计"""
        return {
            "concurrent_workflows": await self.get_current(tenant_id, "workflows"),
            "concurrent_steps": await self.get_current(tenant_id, "steps"),
        }
```

---

## 三、集成到工作流触发和执行

```python
# dragon-senate-saas-v2/api_workflow_trigger.py — 触发时检查并发

concurrency_ctrl = ConcurrencyController(redis_client)

@router.post("/workflows/{workflow_id}/trigger")
async def trigger_workflow(workflow_id, body, tenant_context=Depends(get_tenant_context)):
    # 获取租户并发配置
    config = get_tenant_concurrency_config(tenant_context.tenant_id)
    
    # 检查队列积压
    current = await concurrency_ctrl.get_current(tenant_context.tenant_id, "workflows")
    if current >= config.max_queue_depth:
        raise HTTPException(
            status_code=429,
            detail={
                "error": "queue_full",
                "message": f"当前队列积压 {current} 个任务，已达上限 {config.max_queue_depth}",
                "current": current,
                "limit": config.max_queue_depth,
            }
        )
    
    # 正常触发（执行时在 LobsterRunner 内部获取并发槽位）
    ...


# dragon-senate-saas-v2/lobster_runner.py — 执行时控制并发

class LobsterRunner:
    async def run_workflow(self, workflow, input_data, tenant_id, ...):
        config = get_tenant_concurrency_config(tenant_id)
        
        # 获取工作流并发槽位（阻塞等待，最多等 5 分钟）
        acquired = False
        for attempt in range(30):  # 最多等 5 分钟（每10秒尝试一次）
            acquired = await concurrency_ctrl.acquire(
                tenant_id=tenant_id,
                resource="workflows",
                max_limit=config.max_concurrent_workflows,
            )
            if acquired:
                break
            await asyncio.sleep(10)
        
        if not acquired:
            raise WorkflowTimeoutError(f"租户 {tenant_id} 并发上限 {config.max_concurrent_workflows}，等待超时")
        
        try:
            return await self._do_run(workflow, input_data, tenant_id, ...)
        finally:
            await concurrency_ctrl.release(tenant_id, "workflows")

    async def _run_step(self, step, context, tenant_id):
        config = get_tenant_concurrency_config(tenant_id)
        
        # 步骤级并发控制
        acquired = await concurrency_ctrl.acquire(
            tenant_id=tenant_id,
            resource="steps",
            max_limit=config.max_concurrent_steps,
        )
        if not acquired:
            raise StepConcurrencyError("步骤并发已达上限")
        
        try:
            return await self._execute_step_internal(step, context, tenant_id)
        finally:
            await concurrency_ctrl.release(tenant_id, "steps")
```

---

## 四、并发状态 API（运营 Console 可见）

```python
# dragon-senate-saas-v2/api_concurrency_stats.py

@router.get("/tenant/concurrency-stats")
async def get_concurrency_stats(tenant_context=Depends(get_tenant_context)):
    """获取当前租户并发使用情况"""
    config = get_tenant_concurrency_config(tenant_context.tenant_id)
    stats = await concurrency_ctrl.get_all_stats(tenant_context.tenant_id)
    
    return {
        "current": stats,
        "limits": {
            "max_concurrent_workflows": config.max_concurrent_workflows,
            "max_concurrent_steps": config.max_concurrent_steps,
            "max_queue_depth": config.max_queue_depth,
            "workflow_per_minute": config.workflow_per_minute,
        },
        "plan_tier": config.plan_tier,
        "usage_pct": {
            "workflows": round(stats["concurrent_workflows"] / config.max_concurrent_workflows * 100, 1),
            "steps": round(stats["concurrent_steps"] / config.max_concurrent_steps * 100, 1),
        },
    }

# 平台管理员查看所有租户并发状态
@admin_router.get("/admin/concurrency-overview")
async def admin_concurrency_overview():
    """平台级并发总览（管理员）"""
    tenants = db.query(Tenant).filter(Tenant.is_active == True).all()
    result = []
    for tenant in tenants:
        stats = await concurrency_ctrl.get_all_stats(tenant.id)
        config = get_tenant_concurrency_config(tenant.id)
        result.append({
            "tenant_id": tenant.id,
            "tenant_name": tenant.name,
            "plan_tier": config.plan_tier,
            **stats,
            "max_concurrent_workflows": config.max_concurrent_workflows,
        })
    return {"tenants": result}
```

---

## 五、前端并发状态展示

```typescript
// web/src/components/layout/ConcurrencyStatusBar.tsx
// 顶部导航栏显示当前并发使用情况（类似 CPU 使用率）

export function ConcurrencyStatusBar() {
  const { data } = useQuery({
    queryKey: ['concurrency-stats'],
    queryFn: () => api.get('/v1/tenant/concurrency-stats'),
    refetchInterval: 10_000,  // 每10秒刷新
  });

  if (!data || data.current.concurrent_workflows === 0) return null;

  const wfPct = data.usage_pct.workflows;
  const isHigh = wfPct >= 80;

  return (
    <div className={cn(
      "flex items-center gap-2 text-xs px-3 py-1 rounded-full",
      isHigh ? "bg-orange-100 text-orange-700" : "bg-muted text-muted-foreground"
    )}>
      <Activity className="h-3 w-3" />
      <span>
        运行中：{data.current.concurrent_workflows}/{data.limits.max_concurrent_workflows} 工作流
      </span>
      {isHigh && <span className="font-medium">（并发较高）</span>}
    </div>
  );
}

// 套餐升级提示（达到并发上限时）
export function ConcurrencyLimitBanner() {
  const { data } = useQuery({ queryFn: () => api.get('/v1/tenant/concurrency-stats') });
  
  if (!data || data.usage_pct.workflows < 100) return null;
  
  return (
    <Alert variant="destructive" className="mb-4">
      <AlertTitle>工作流并发已满</AlertTitle>
      <AlertDescription>
        当前套餐最多 {data.limits.max_concurrent_workflows} 个并行工作流。
        新任务将排队等待。
        <Button size="sm" variant="outline" className="ml-3" onClick={() => router.push('/billing/upgrade')}>
          升级套餐
        </Button>
      </AlertDescription>
    </Alert>
  );
}
```

---

## 验收标准

- [ ] `TenantConcurrencyConfig` 数据模型 + 四套餐默认值（free/standard/premium/enterprise）
- [ ] `ConcurrencyController`：Redis 原子 INCR/DECR（Lua 脚本保证原子性）
- [ ] `acquire()` + `release()` 并发槽位管理
- [ ] `LobsterRunner.run_workflow()` 执行前 acquire 工作流槽位，finally 释放
- [ ] `LobsterRunner._run_step()` 执行前 acquire 步骤槽位，finally 释放
- [ ] 触发时检查队列积压，超出返回 HTTP 429 + 详细错误信息
- [ ] 等待并发槽位：最多等 5 分钟（30次 × 10秒），超时抛出异常
- [ ] `GET /v1/tenant/concurrency-stats` API（当前并发数 / 上限 / 使用率）
- [ ] `GET /admin/concurrency-overview` 平台级总览（管理员）
- [ ] 前端 `ConcurrencyStatusBar`：顶部导航实时并发状态
- [ ] 前端 `ConcurrencyLimitBanner`：并发满时显示升级提示
- [ ] 与 AlertEngine 联动：并发使用率 > 90% 触发 WARNING 告警

---

*Codex Task | 来源：TRIGGERDEV_BORROWING_ANALYSIS.md P1-#3 | 2026-04-02*
