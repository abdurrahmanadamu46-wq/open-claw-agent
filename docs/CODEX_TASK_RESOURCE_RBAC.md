# CODEX TASK: 资源粒度 RBAC — 龙虾/渠道/工作流级别权限控制

**优先级：P1**  
**来源借鉴：Keycloak `authz/` Policy Engine（Resource × Scope × Policy）**  
**参考分析：`docs/KEYCLOAK_BORROWING_ANALYSIS.md` 第二节 2.2**

---

## 背景

Keycloak 的授权引擎将权限拆分为：
- **Resource**：被保护对象（某只龙虾/某个渠道/某个工作流）
- **Scope**：操作类型（read/write/execute/admin）
- **Policy**：授权规则（基于角色/用户/租户）

我们当前 `rbac_permission.py` 停留在"角色→API路由"的粗粒度，无法表达"代理商员工A只能操作 echoer 龙虾"这种资源级别的权限。

---

## 任务目标

升级 `rbac_permission.py`，实现资源粒度的 RBAC，并在前端权限管理页面提供可视化配置。

---

## 一、后端：升级 `dragon-senate-saas-v2/rbac_permission.py`

### 新增数据模型

```python
# rbac_permission.py 新增

from enum import Enum
from dataclasses import dataclass
from typing import Literal

class ResourceType(str, Enum):
    LOBSTER = "lobster"          # 龙虾实例
    WORKFLOW = "workflow"         # 工作流
    CHANNEL = "channel"          # 渠道账号
    API_KEY = "api_key"          # API 密钥
    EDGE_NODE = "edge_node"      # 边缘节点
    SKILL = "skill"              # 技能
    MEMORY = "memory"            # 记忆数据
    REPORT = "report"            # 数据报表

class ResourceScope(str, Enum):
    READ = "read"                # 查看
    WRITE = "write"              # 编辑配置
    EXECUTE = "execute"          # 执行/触发
    ADMIN = "admin"              # 完全控制（含删除）

@dataclass
class ResourcePermission:
    """资源粒度权限规则"""
    id: str
    tenant_id: str
    resource_type: ResourceType
    resource_id: str             # "*" 表示同类型全部资源
    scope: ResourceScope
    subject_type: Literal["role", "user"]
    subject_id: str              # role_name 或 user_id
    granted: bool = True
    created_at: datetime = None

# 持久化：写入 DB（resource_permissions 表）或 JSON 文件
```

### 核心方法升级

```python
class RBACPermission:
    
    def check_resource_permission(
        self,
        user_id: str,
        tenant_id: str,
        resource_type: ResourceType,
        resource_id: str,
        scope: ResourceScope
    ) -> bool:
        """
        检查用户是否有权限对指定资源执行指定操作
        
        优先级：
          1. 明确拒绝（granted=False）→ 立即返回 False
          2. 用户级别规则（user_id 匹配）
          3. 角色级别规则（用户角色匹配）
          4. 通配符规则（resource_id="*"）
          5. 默认：False（最小权限原则）
        
        示例：
          check_resource_permission(
            user_id="emp-001",
            tenant_id="tenant-A",
            resource_type=ResourceType.LOBSTER,
            resource_id="lobster-radar-001",
            scope=ResourceScope.EXECUTE
          ) → True/False
        """
    
    def grant_permission(self, perm: ResourcePermission) -> None:
        """授权（写入 DB）"""
    
    def revoke_permission(self, perm_id: str) -> None:
        """撤权"""
    
    def list_user_permissions(self, user_id: str, tenant_id: str) -> List[ResourcePermission]:
        """列出用户所有权限"""
    
    def list_resource_permissions(self, resource_type: ResourceType, resource_id: str) -> List[ResourcePermission]:
        """列出某个资源的所有授权规则"""
```

### 中间件集成

在 FastAPI 路由中增加资源权限装饰器：

```python
# 新建 dragon-senate-saas-v2/resource_guard.py

from functools import wraps

def require_resource_permission(resource_type: ResourceType, scope: ResourceScope):
    """
    路由级别资源权限装饰器
    
    使用方式：
    @app.post("/api/v1/lobsters/{lobster_id}/execute")
    @require_resource_permission(ResourceType.LOBSTER, ResourceScope.EXECUTE)
    async def execute_lobster(lobster_id: str, current_user = Depends(get_current_user)):
        ...
    
    装饰器自动：
      1. 从路径参数提取 resource_id（lobster_id）
      2. 从 JWT 提取 user_id + tenant_id
      3. 调用 RBACPermission.check_resource_permission()
      4. 无权限时返回 403 + 记录 PERMISSION_DENIED 审计事件
    """
```

### 预设角色默认权限

```python
# 初始化时写入默认规则（tenant 级别通配符规则）

DEFAULT_ROLE_PERMISSIONS = [
    # superadmin：所有资源全权
    {"role": "superadmin", "resource_type": "*", "resource_id": "*", "scope": "admin"},
    
    # admin：本租户所有资源全权
    {"role": "admin", "resource_type": "*", "resource_id": "*", "scope": "admin"},
    
    # operator：可执行，不能删除
    {"role": "operator", "resource_type": "lobster", "resource_id": "*", "scope": "execute"},
    {"role": "operator", "resource_type": "workflow", "resource_id": "*", "scope": "execute"},
    {"role": "operator", "resource_type": "channel", "resource_id": "*", "scope": "read"},
    
    # viewer：只读
    {"role": "viewer", "resource_type": "*", "resource_id": "*", "scope": "read"},
]
```

---

## 二、后端 API

```
GET    /api/v1/rbac/permissions                    → 列出当前租户所有权限规则
POST   /api/v1/rbac/permissions                    → 新增权限规则
DELETE /api/v1/rbac/permissions/{id}               → 删除权限规则
GET    /api/v1/rbac/users/{user_id}/permissions    → 列出某用户的有效权限
POST   /api/v1/rbac/check                          → 权限检查（调试用，admin only）
  Body: { resource_type, resource_id, scope, user_id }
  Response: { allowed: bool, matched_rule: ResourcePermission | null }
```

---

## 三、前端：权限管理页面

### 页面位置

```
/settings/permissions   ← 新建或升级现有权限页
```

### 页面功能

```
权限管理（/settings/permissions）
├── 用户权限视图（按用户查看）
│   ├── 选择用户 → 显示该用户的所有有效权限
│   ├── 权限列表：资源类型 / 资源名 / 操作范围 / 来源（角色/直接授权）
│   └── 快速授权/撤权按钮
├── 资源权限视图（按资源查看）
│   ├── 选择资源类型（龙虾/渠道/工作流等）
│   ├── 选择具体资源
│   └── 显示哪些用户/角色有什么权限
└── 权限规则管理
    ├── 规则列表（角色/用户 × 资源 × 操作）
    ├── 新增规则 Modal（选择主体、资源、操作）
    └── 删除规则（需二次确认）
```

### TypeScript 类型文件

新建 `web/src/types/rbac-permission.ts`：

```typescript
export type ResourceType = 'lobster' | 'workflow' | 'channel' | 'api_key' | 'edge_node' | 'skill' | 'memory' | 'report';
export type ResourceScope = 'read' | 'write' | 'execute' | 'admin';
export type SubjectType = 'role' | 'user';

export interface ResourcePermission {
  id: string;
  tenant_id: string;
  resource_type: ResourceType;
  resource_id: string;  // "*" 表示全部
  scope: ResourceScope;
  subject_type: SubjectType;
  subject_id: string;
  granted: boolean;
  created_at: string;
}

export interface PermissionCheckResult {
  allowed: boolean;
  matched_rule: ResourcePermission | null;
  reason: string;
}
```

---

## 四、⚠️ 覆盖规则（重要）

1. **现有 `rbac_permission.py` 的角色→API 粗粒度规则保留**，新规则叠加在其上（兼容性优先）
2. **现有路由的 `@require_role` 装饰器不删除**，在其基础上增加 `@require_resource_permission`
3. **`PROJECT_CONTROL_CENTER.md` 中 RBAC 相关 `🟡` 标注**全部替换为 `✅`

---

## 五、PROJECT_CONTROL_CENTER.md 同步更新

完成后更新：

1. **第三节"当前成熟能力"** 更新：
   ```
   ✅ rbac_permission.py 升级：资源粒度 RBAC（Resource × Scope × Subject）
   ✅ resource_guard.py 路由权限装饰器
   ```

2. **第四节"已完成 API"** 增加：
   ```
   ✅ GET /api/v1/rbac/permissions
   ✅ POST /api/v1/rbac/permissions
   ✅ DELETE /api/v1/rbac/permissions/{id}
   ✅ GET /api/v1/rbac/users/{user_id}/permissions
   ✅ POST /api/v1/rbac/check
   ```

3. **第十节"前端对齐索引"** 增加：
   ```
   | 资源粒度 RBAC | GET/POST /api/v1/rbac/* | web/src/types/rbac-permission.ts | /settings/permissions | ✅ |
   ```

4. **第七节"已落地借鉴清单"** 增加：
   ```
   | Keycloak | 资源粒度 RBAC（Resource × Scope × Policy）| ✅ | rbac_permission.py, resource_guard.py |
   ```

---

## 验收标准

- [ ] `ResourcePermission` 数据模型存在，可持久化
- [ ] `check_resource_permission()` 正确处理通配符规则和优先级
- [ ] `resource_guard.py` 装饰器可用，无权限时返回 403 + 写审计日志
- [ ] 龙虾执行 API（`/api/v1/lobsters/{id}/execute`）已接入资源权限检查
- [ ] 前端 `/settings/permissions` 可配置用户/角色的资源权限
- [ ] `web/src/types/rbac-permission.ts` 类型文件存在
- [ ] `PROJECT_CONTROL_CENTER.md` 相关 `🟡` 全部改为 `✅`

---

*Codex Task | 来源：KEYCLOAK_BORROWING_ANALYSIS.md P1-#1 | 2026-04-02*
