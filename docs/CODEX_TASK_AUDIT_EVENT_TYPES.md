# CODEX TASK: 审计事件标准化 — AuditEventType 枚举 + 保留策略

**优先级：P1**  
**来源借鉴：Keycloak `EventType.java` + Event Retention 策略**  
**参考分析：`docs/KEYCLOAK_BORROWING_ANALYSIS.md` 第二节 2.4**

---

## 背景

Keycloak 的事件系统有完整的标准化 EventType 枚举（100+ 事件类型），前端可以按类型精准筛选。我们的 `tenant_audit_log.py` 事件类型是松散字符串，无法统一查询和告警。

---

## 任务目标

1. 为 `tenant_audit_log.py` 增加标准 `AuditEventType` 枚举
2. 增加可配置的事件保留策略（按类型设置天数，定时清理）
3. 前端审计日志页支持按事件类型精准筛选

---

## 一、后端：升级 `dragon-senate-saas-v2/tenant_audit_log.py`

### 新增 AuditEventType 枚举

```python
# tenant_audit_log.py 新增

from enum import Enum

class AuditEventType(str, Enum):
    """
    标准化审计事件类型
    参考 Keycloak EventType.java 设计，适配龙虾池业务场景
    """
    
    # ===== 认证类 =====
    AUTH_LOGIN = "AUTH_LOGIN"                      # 登录成功
    AUTH_LOGIN_FAILED = "AUTH_LOGIN_FAILED"        # 登录失败
    AUTH_LOGOUT = "AUTH_LOGOUT"                    # 主动登出
    AUTH_TOKEN_REFRESH = "AUTH_TOKEN_REFRESH"      # Token 刷新
    AUTH_TOKEN_REFRESH_ERROR = "AUTH_TOKEN_REFRESH_ERROR"
    AUTH_MFA_ENABLED = "AUTH_MFA_ENABLED"          # 开启 MFA
    AUTH_MFA_DISABLED = "AUTH_MFA_DISABLED"        # 关闭 MFA
    AUTH_MFA_VERIFY = "AUTH_MFA_VERIFY"            # MFA 验证
    AUTH_MFA_VERIFY_FAILED = "AUTH_MFA_VERIFY_FAILED"
    AUTH_PASSWORD_RESET = "AUTH_PASSWORD_RESET"    # 密码重置
    AUTH_PASSWORD_UPDATE = "AUTH_PASSWORD_UPDATE"  # 密码修改
    
    # ===== 用户管理类 =====
    USER_CREATE = "USER_CREATE"
    USER_UPDATE = "USER_UPDATE"
    USER_DELETE = "USER_DELETE"
    USER_ROLE_ASSIGN = "USER_ROLE_ASSIGN"          # 角色分配
    USER_ROLE_REVOKE = "USER_ROLE_REVOKE"          # 角色撤销
    USER_INVITE = "USER_INVITE"                    # 邀请成员
    USER_ACTIVATE = "USER_ACTIVATE"                # 激活账号
    USER_DEACTIVATE = "USER_DEACTIVATE"            # 停用账号
    
    # ===== 龙虾操作类 =====
    LOBSTER_EXECUTE = "LOBSTER_EXECUTE"            # 执行任务
    LOBSTER_EXECUTE_FAILED = "LOBSTER_EXECUTE_FAILED"
    LOBSTER_CONFIG_UPDATE = "LOBSTER_CONFIG_UPDATE" # 配置修改
    LOBSTER_ENABLE = "LOBSTER_ENABLE"              # 启用
    LOBSTER_DISABLE = "LOBSTER_DISABLE"            # 禁用
    LOBSTER_CLONE = "LOBSTER_CLONE"                # 克隆
    LOBSTER_BOOTSTRAP_COMPLETE = "LOBSTER_BOOTSTRAP_COMPLETE"  # 冷启动完成
    
    # ===== 工作流类 =====
    WORKFLOW_CREATE = "WORKFLOW_CREATE"
    WORKFLOW_EXECUTE = "WORKFLOW_EXECUTE"
    WORKFLOW_EXECUTE_FAILED = "WORKFLOW_EXECUTE_FAILED"
    WORKFLOW_UPDATE = "WORKFLOW_UPDATE"
    WORKFLOW_DELETE = "WORKFLOW_DELETE"
    
    # ===== 渠道账号类 =====
    CHANNEL_CONNECT = "CHANNEL_CONNECT"            # 渠道账号接入
    CHANNEL_DISCONNECT = "CHANNEL_DISCONNECT"      # 渠道账号断开
    CHANNEL_POST = "CHANNEL_POST"                  # 发布内容
    CHANNEL_POST_FAILED = "CHANNEL_POST_FAILED"
    
    # ===== API Key 类 =====
    API_KEY_CREATE = "API_KEY_CREATE"
    API_KEY_REVOKE = "API_KEY_REVOKE"
    API_KEY_USE = "API_KEY_USE"                    # API Key 被使用（高频，采样记录）
    
    # ===== 租户/计费类 =====
    TENANT_CREATE = "TENANT_CREATE"
    TENANT_UPDATE = "TENANT_UPDATE"
    TENANT_PLAN_CHANGE = "TENANT_PLAN_CHANGE"      # 套餐变更
    BILLING_CHARGE = "BILLING_CHARGE"              # 计费扣款
    BILLING_CHARGE_FAILED = "BILLING_CHARGE_FAILED"
    QUOTA_EXCEED = "QUOTA_EXCEED"                  # 配额超限
    QUOTA_WARNING = "QUOTA_WARNING"                # 配额预警（80%）
    
    # ===== 安全类 =====
    PERMISSION_DENIED = "PERMISSION_DENIED"        # 权限拒绝
    SUSPICIOUS_ACTIVITY = "SUSPICIOUS_ACTIVITY"   # 可疑行为
    SSRF_BLOCKED = "SSRF_BLOCKED"                 # SSRF 阻断
    DLP_TRIGGERED = "DLP_TRIGGERED"               # DLP 规则触发
    RATE_LIMIT_EXCEEDED = "RATE_LIMIT_EXCEEDED"   # 频率限制
    
    # ===== 边缘节点类 =====
    EDGE_REGISTER = "EDGE_REGISTER"               # 节点注册
    EDGE_DISCONNECT = "EDGE_DISCONNECT"           # 节点掉线
    EDGE_RECONNECT = "EDGE_RECONNECT"             # 节点重连
    EDGE_TASK_EXECUTE = "EDGE_TASK_EXECUTE"       # 边缘任务执行
    EDGE_TASK_FAILED = "EDGE_TASK_FAILED"
    EDGE_BACKUP = "EDGE_BACKUP"                   # 数据备份
    
    # ===== MCP 工具类（新增）=====
    MCP_SERVER_REGISTER = "MCP_SERVER_REGISTER"
    MCP_TOOL_CALL = "MCP_TOOL_CALL"
    MCP_TOOL_CALL_FAILED = "MCP_TOOL_CALL_FAILED"
    
    # ===== 系统管理类 =====
    SYSTEM_CONFIG_UPDATE = "SYSTEM_CONFIG_UPDATE"
    PROVIDER_ADD = "PROVIDER_ADD"
    PROVIDER_REMOVE = "PROVIDER_REMOVE"
    WHITE_LABEL_UPDATE = "WHITE_LABEL_UPDATE"

# 事件严重等级映射
EVENT_SEVERITY = {
    AuditEventType.AUTH_LOGIN_FAILED: "WARNING",
    AuditEventType.PERMISSION_DENIED: "WARNING",
    AuditEventType.SUSPICIOUS_ACTIVITY: "CRITICAL",
    AuditEventType.SSRF_BLOCKED: "CRITICAL",
    AuditEventType.DLP_TRIGGERED: "CRITICAL",
    AuditEventType.QUOTA_EXCEED: "WARNING",
    AuditEventType.BILLING_CHARGE_FAILED: "ERROR",
    # 其他默认 "INFO"
}
```

### 新增 AuditRetentionPolicy

```python
@dataclass
class AuditRetentionPolicy:
    """事件保留策略（可按租户配置）"""
    tenant_id: str
    
    # 保留天数（0 = 永久保留）
    auth_events_days: int = 60        # 认证类事件
    user_events_days: int = 90        # 用户管理类
    lobster_events_days: int = 30     # 龙虾操作类
    security_events_days: int = 180   # 安全类（保留更长）
    billing_events_days: int = 365    # 计费类（法规要求）
    edge_events_days: int = 30        # 边缘节点类
    system_events_days: int = 90      # 系统管理类

class AuditRetentionCleaner:
    """
    定时清理过期审计日志
    
    调度：每日 UTC 02:00 执行
    逻辑：按 event_type 分类 → 查找超过保留天数的记录 → 批量软删除
    """
    async def cleanup(self, tenant_id: str) → dict:
        """返回各类型清理数量"""
```

### 升级 log() 方法

```python
# tenant_audit_log.py 中 log() 方法签名升级：

async def log(
    event_type: AuditEventType,          # 必填，使用枚举
    tenant_id: str,
    user_id: Optional[str] = None,
    resource_type: Optional[str] = None,
    resource_id: Optional[str] = None,
    details: Optional[dict] = None,      # 额外上下文
    ip_address: Optional[str] = None,
    severity: Optional[str] = None,      # 自动从 EVENT_SEVERITY 推断
) → str:
    """记录审计事件，返回 event_id"""
```

---

## 二、定时清理任务

在 `dragon-senate-saas-v2/cron_jobs.py`（或现有 cron 配置）中注册：

```python
# 每日凌晨清理过期审计日志
@cron("0 2 * * *")
async def cleanup_audit_logs():
    cleaner = AuditRetentionCleaner()
    for tenant_id in await get_all_tenant_ids():
        result = await cleaner.cleanup(tenant_id)
        logger.info(f"Audit cleanup [{tenant_id}]: {result}")
```

---

## 三、前端：审计日志页升级

### 页面位置

```
/operations/audit-log   ← 已有，升级筛选能力
```

### 升级内容

1. **事件类型筛选**：多选下拉（按分类分组：认证/用户/龙虾/安全/计费/边缘）
2. **严重等级筛选**：INFO / WARNING / ERROR / CRITICAL
3. **时间范围筛选**：预设（今天/7天/30天）+ 自定义
4. **实时告警角标**：有 CRITICAL 级别事件时，导航栏审计日志入口显示红点

### TypeScript 类型文件

更新 `web/src/types/audit-log.ts`（已有则升级）：

```typescript
export type AuditEventCategory = 
  | 'auth' | 'user' | 'lobster' | 'workflow' | 'channel'
  | 'api_key' | 'tenant' | 'billing' | 'security' | 'edge' | 'mcp' | 'system';

export type AuditSeverity = 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';

export interface AuditEvent {
  id: string;
  event_type: string;         // AuditEventType 枚举值
  category: AuditEventCategory;
  severity: AuditSeverity;
  tenant_id: string;
  user_id?: string;
  resource_type?: string;
  resource_id?: string;
  details?: Record<string, unknown>;
  ip_address?: string;
  created_at: string;
}

export interface AuditEventFilter {
  event_types?: string[];
  severity?: AuditSeverity[];
  category?: AuditEventCategory[];
  from_date?: string;
  to_date?: string;
  user_id?: string;
  resource_id?: string;
}
```

---

## 四、⚠️ 覆盖规则（重要）

1. **现有 `tenant_audit_log.py` 中已有的 `log()` 调用** — 逐一替换为使用 `AuditEventType` 枚举（不能保留裸字符串）
2. **`PROJECT_CONTROL_CENTER.md` 中审计相关 `🟡`** 全部改为 `✅`
3. **`AuditRetentionCleaner` 的清理是软删除**（标记 deleted_at），不是物理删除，方便审计恢复

---

## 五、PROJECT_CONTROL_CENTER.md 同步更新

完成后：

1. **第三节"当前成熟能力"** 更新：
   ```
   ✅ AuditEventType 枚举标准化（覆盖所有业务操作类型）
   ✅ AuditRetentionPolicy 可配置保留策略
   ✅ 审计日志定时清理 cron job
   ```

2. **第七节"已落地借鉴清单"** 增加：
   ```
   | Keycloak | 审计事件标准化（AuditEventType 枚举 + 保留策略） | ✅ | tenant_audit_log.py |
   ```

---

## 验收标准

- [ ] `AuditEventType` 枚举包含全部类型（至少50个），无裸字符串残留
- [ ] `EVENT_SEVERITY` 映射对高风险事件正确标记 WARNING/CRITICAL
- [ ] `log()` 方法接受 `AuditEventType` 枚举参数
- [ ] `AuditRetentionCleaner` 可按策略软删除过期记录
- [ ] 定时清理 cron job 已注册
- [ ] 前端审计日志页支持事件类型 + 严重等级筛选
- [ ] `web/src/types/audit-log.ts` 类型文件更新
- [ ] `PROJECT_CONTROL_CENTER.md` 相关 `🟡` 已更新

---

*Codex Task | 来源：KEYCLOAK_BORROWING_ANALYSIS.md P1-#3 | 2026-04-02*
