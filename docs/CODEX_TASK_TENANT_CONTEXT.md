# CODEX TASK: 租户上下文中间件 — 请求级 tenant_id 注入 + 跨租户防泄露

**优先级：P1**  
**来源借鉴：Keycloak Realm 物理隔离模型**  
**参考分析：`docs/KEYCLOAK_BORROWING_ANALYSIS.md` 第二节 2.7**

---

## 背景

Keycloak 的 Realm 是物理级别的命名空间隔离，每个 Realm 的数据完全隔离。我们用 `tenant_id` 做逻辑隔离，但目前没有强制的全局 guard 防止开发者遗漏 `tenant_id` 过滤，存在跨租户数据泄露风险。

---

## 任务目标

新建 `tenant_context.py`，实现请求级租户上下文：
- 从 JWT 自动提取 `tenant_id`，注入整个请求生命周期
- FastAPI 全局依赖，所有路由自动获取 `TenantContext`
- 数据库查询助手：自动追加 `tenant_id` 过滤条件
- Redis key 前缀：统一 `tenant:{id}:*` 格式

---

## 一、后端：新建 `dragon-senate-saas-v2/tenant_context.py`

```python
# tenant_context.py
# 租户上下文 — 请求级 tenant_id 注入与隔离

from contextvars import ContextVar
from fastapi import Request, HTTPException, Depends
from typing import Optional
import jwt

# 全局上下文变量（asyncio 安全）
_tenant_ctx: ContextVar[Optional[str]] = ContextVar("tenant_id", default=None)

class TenantContext:
    """
    请求级租户上下文
    
    用法：
      # 在 FastAPI 路由中
      async def my_route(ctx: TenantContext = Depends(get_tenant_context)):
          tenant_id = ctx.tenant_id
          data = await ctx.db_query("SELECT * FROM lobsters WHERE tenant_id = $1", ctx.tenant_id)
    """
    
    def __init__(self, tenant_id: str, user_id: str, roles: list[str]):
        self.tenant_id = tenant_id
        self.user_id = user_id
        self.roles = roles
    
    def redis_prefix(self, key: str) -> str:
        """
        生成租户隔离的 Redis key
        示例：ctx.redis_prefix("lobster:radar") → "tenant:xxx:lobster:radar"
        """
        return f"tenant:{self.tenant_id}:{key}"
    
    async def assert_resource_belongs_to_tenant(
        self,
        resource_type: str,
        resource_id: str
    ) -> None:
        """
        断言指定资源属于当前租户
        如果不属于，抛出 403（防止越权访问）
        
        示例：
          await ctx.assert_resource_belongs_to_tenant("lobster", lobster_id)
          # 自动查询 DB 验证 lobster.tenant_id == ctx.tenant_id
        """

async def get_tenant_context(request: Request) -> TenantContext:
    """
    FastAPI 全局依赖注入器
    从 JWT Bearer Token 提取 tenant_id + user_id + roles
    
    JWT Payload 期望格式：
    {
      "sub": "user-xxx",
      "tenant_id": "tenant-yyy",
      "roles": ["admin", "operator"],
      "exp": 1234567890
    }
    
    异常处理：
      - 无 Token → 401
      - Token 过期 → 401
      - Token 无 tenant_id → 403（系统 Token 或配置错误）
    """
    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing Bearer token")
    
    token = auth_header.split(" ")[1]
    try:
        payload = jwt.decode(token, settings.JWT_SECRET, algorithms=["HS256"])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")
    
    tenant_id = payload.get("tenant_id")
    if not tenant_id:
        raise HTTPException(status_code=403, detail="No tenant_id in token")
    
    ctx = TenantContext(
        tenant_id=tenant_id,
        user_id=payload.get("sub"),
        roles=payload.get("roles", [])
    )
    _tenant_ctx.set(tenant_id)  # 写入 ContextVar 供非路由层访问
    return ctx

def get_current_tenant_id() -> Optional[str]:
    """
    在非路由层（如龙虾执行器、后台任务）获取当前租户 ID
    复用 ContextVar（asyncio 安全）
    """
    return _tenant_ctx.get()
```

---

## 二、全局应用到 `dragon-senate-saas-v2/app.py`

```python
# app.py 修改

from tenant_context import get_tenant_context

# 方式1：路由级显式依赖（推荐，清晰可见）
@app.get("/api/v1/lobsters")
async def list_lobsters(ctx: TenantContext = Depends(get_tenant_context)):
    lobsters = await db.query(
        "SELECT * FROM lobsters WHERE tenant_id = $1",
        ctx.tenant_id
    )
    return lobsters

# 方式2：全局中间件（兜底，防遗漏）
@app.middleware("http")
async def tenant_isolation_middleware(request: Request, call_next):
    # 对 /api/v1/* 路由强制要求 tenant_id（/auth/* 路由跳过）
    if request.url.path.startswith("/api/v1/") and not is_public_route(request.url.path):
        try:
            ctx = await get_tenant_context(request)
        except HTTPException:
            return JSONResponse(status_code=401, content={"detail": "Unauthorized"})
    response = await call_next(request)
    return response
```

---

## 三、Redis Key 规范化

**现有 Redis key 命名（可能存在未隔离的风险）：**
```
# 危险：未加租户前缀
redis.set("lobster:radar:status", ...)
redis.set("session:abc123", ...)

# 安全：加租户前缀
redis.set(ctx.redis_prefix("lobster:radar:status"), ...)   → "tenant:xxx:lobster:radar:status"
redis.set(ctx.redis_prefix(f"session:{session_id}"), ...)
```

**全局扫描 + 修复：**
- 搜索所有 `redis.set` / `redis.get` / `redis.hset` 调用
- 对业务数据 key 统一加 `tenant:{}:` 前缀
- 对系统级 key（全局配置、Provider 状态等）不需要加前缀

---

## 四、数据库行级安全（Row-Level Security）

在 PostgreSQL 中开启 RLS（可选，作为防御纵深）：

```sql
-- 为核心业务表开启 RLS
ALTER TABLE lobsters ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON lobsters
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- 在每个数据库连接中设置：
SET app.current_tenant_id = 'tenant-xxx';
```

**在 `tenant_context.py` 中集成：**
```python
async def get_db_connection(ctx: TenantContext):
    """
    获取带租户上下文的 DB 连接
    自动 SET app.current_tenant_id = ctx.tenant_id
    """
```

---

## 五、前端：无需前端改动

此任务纯后端，但需要确认：
1. **前端登录后收到的 JWT 包含 `tenant_id` claim** — 如不包含，需要升级 NestJS auth 模块的 token 生成逻辑
2. **`web/src/lib/auth-client.ts`**（如果 CODEX_TASK_PROVIDER_HOT_RELOAD 已落地）中的 token 解码工具可展示 `tenant_id`

---

## 六、⚠️ 覆盖规则（重要）

1. **现有所有 FastAPI 路由** 中手动提取 `tenant_id` 的代码，统一替换为 `Depends(get_tenant_context)`
2. **Redis key** 扫描全仓库，业务数据 key 补充 `tenant:` 前缀（可分批进行）
3. **`PROJECT_CONTROL_CENTER.md`** 中多租户安全相关 `🟡` 改为 `✅`

---

## 七、PROJECT_CONTROL_CENTER.md 同步更新

完成后：

1. **第三节"当前成熟能力"** 更新：
   ```
   ✅ tenant_context.py 请求级租户上下文注入
   ✅ Redis key 统一 tenant:{id}: 前缀隔离
   ✅ PostgreSQL RLS 行级安全（防御纵深）
   ```

2. **第七节"已落地借鉴清单"** 增加：
   ```
   | Keycloak | 租户上下文中间件（Realm 隔离模型移植）| ✅ | tenant_context.py |
   ```

---

## 验收标准

- [ ] `tenant_context.py` 实现完整，`get_tenant_context()` 可作为 FastAPI 依赖使用
- [ ] `ctx.redis_prefix()` 方法存在并工作正确
- [ ] `ctx.assert_resource_belongs_to_tenant()` 实现，防止越权访问
- [ ] 所有 `/api/v1/*` 路由已接入 TenantContext（或全局中间件兜底）
- [ ] JWT token payload 包含 `tenant_id` claim（NestJS 侧确认）
- [ ] Redis 业务数据 key 已加 `tenant:` 前缀（至少覆盖高风险 key）
- [ ] `PROJECT_CONTROL_CENTER.md` 相关 `🟡` 已更新

---

*Codex Task | 来源：KEYCLOAK_BORROWING_ANALYSIS.md P1-#4 | 2026-04-02*
