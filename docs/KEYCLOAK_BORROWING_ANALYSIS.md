# Keycloak 借鉴分析报告
## https://github.com/keycloak/keycloak

**分析日期：2026-04-02**  
**对标基线：PROJECT_CONTROL_CENTER.md + SYSTEM_ARCHITECTURE_OVERVIEW.md v3.0**  
**结论方式：✅借鉴 | ❌略过（我们更好或不适用）**

---

## 一、Keycloak 项目定性

Keycloak 是 Red Hat / CNCF 孵化的**企业级开源身份与访问管理（IAM）平台**，行业事实标准。

```
核心能力矩阵：
  ✦ 认证（Authentication）：用户名密码、OTP、WebAuthn、FIDO2、PassKey
  ✦ 授权（Authorization）：细粒度策略（RBAC/ABAC/UMA）、资源权限
  ✦ 单点登录（SSO）：OIDC、SAML 2.0、OAuth 2.0
  ✦ 用户联合（Federation）：LDAP、Active Directory、自定义提供商
  ✦ 社交登录：Google、GitHub、微信、微博等 IdP
  ✦ 多租户（Realm）：每个 Realm 完全隔离，相当于一个独立租户空间
  ✦ 事件审计：登录事件、管理事件、失败记录全量可查
  ✦ Token 管理：JWT、刷新令牌、令牌内省、令牌撤销
  ✦ 主题系统（Themes）：登录页/账号页可完全自定义样式
  ✦ Admin Console：React 管理面板（js/apps/admin-ui）
  ✦ Account Console：用户自助账号管理（js/apps/account-ui）
  ✦ SCIM 2.0：用户目录同步协议
  ✦ K8s Operator：Kubernetes 原生运维（operator/）
```

**Keycloak 目录关键层：**
```
keycloak/
├── js/apps/
│   ├── admin-ui/         ← React Admin Console（Keycloak管理面板）
│   └── account-ui/       ← React Account Console（用户自助管理）
├── js/libs/
│   ├── keycloak-js/      ← ★ 官方 JS 客户端 SDK
│   └── ui-shared/        ← UI 组件库（PatternFly + React）
├── authz/                ← 细粒度授权引擎（Policy/Resource/Scope）
├── federation/           ← LDAP/AD 用户联合
├── scim/                 ← SCIM 2.0 用户目录同步
├── services/             ← 核心业务逻辑（Java/Quarkus）
├── rest/                 ← Admin REST API（OpenAPI）
├── themes/               ← 登录页/邮件主题模板
├── model/                ← 用户/Realm/Token 数据模型
├── operator/             ← K8s Operator（CRD/Controller）
└── quarkus/              ← 部署运行时（Quarkus + Docker）
```

---

## 二、逐层对比分析

### 2.1 前端（js/apps/ vs 我们的 Next.js Operations Console）

#### ✅ 强烈借鉴：登录页主题（Themes）

**Keycloak themes/ 核心价值：**
```
Keycloak 提供完整的登录页主题系统：
  - login/         ← 登录、注册、MFA、密码重置页面
  - account/       ← 用户账号自助管理页
  - email/         ← 邮件通知模板（欢迎/密码重置/验证码）
  - admin/         ← 管理控制台主题

每个主题可完全定制 HTML + CSS + JS + 国际化
支持继承（base theme → custom theme）
```

**我们现状：**
- 登录页（`/auth/login`）目前是 Next.js 自制页面
- 无独立的主题文件系统
- 邮件通知模板散落在代码里，无集中管理

**借鉴动作：**
```
建立统一登录页主题系统：
  web/src/themes/
  ├── login/
  │   ├── login.html          ← 登录页
  │   ├── register.html       ← 注册页（代理商）
  │   ├── reset-password.html ← 密码重置
  │   └── mfa-totp.html       ← MFA 验证
  ├── email/
  │   ├── welcome.html        ← 欢迎邮件
  │   ├── verify-email.html   ← 邮箱验证
  │   └── reset-password.html ← 密码重置邮件
  └── account/
      └── profile.html        ← 账号自助管理

  主题支持品牌化（代理商专属 logo/色调）
  品牌化主题 → 白标 SaaS 的核心竞争力
```

**优先级：P1**（白标 SaaS 的硬需求，代理商需要贴自己的品牌）

#### ✅ 可借鉴：keycloak-js SDK 集成模式

**Keycloak keycloak-js 的设计模式：**
```javascript
// keycloak-js 提供统一的前端认证 SDK
const keycloak = new Keycloak({
  url: 'https://auth.example.com',
  realm: 'my-tenant',
  clientId: 'web-app'
});

await keycloak.init({ onLoad: 'login-required' });

// token 自动刷新
keycloak.onTokenExpired = () => keycloak.updateToken(30);

// 认证状态响应式
keycloak.onAuthSuccess = () => { /* 登录成功 */ };
keycloak.onAuthLogout = () => { /* 登出 */ };
```

**我们现状：**
- 前端认证通过 NestJS JWT 处理，前端硬编码 axios 拦截器刷新 token
- 无统一的前端认证 SDK 封装，各页面重复逻辑

**借鉴动作：**
```
新建 web/src/lib/auth-client.ts：
  - 封装 token 获取/刷新/失效逻辑
  - 统一的 AuthContext（React Context）
  - 自动 token 刷新（距离过期30s时刷新）
  - 登出时清理所有认证状态
  - 为未来集成 Keycloak 提前对齐接口
```

**优先级：P2**（架构整洁性，为 Keycloak 集成预留）

#### ❌ 略过：PatternFly UI 组件库

**Keycloak Admin Console** 使用 Red Hat PatternFly（企业级 UI）。  
**我们已有：** Radix UI + Tailwind + 自定义 Design Token 系统，风格更现代，适合国内市场。

---

### 2.2 认证系统（services/ 核心认证 vs 我们的 NestJS JWT）

#### ✅ 强烈借鉴：OIDC/OAuth2 标准协议 + SSO

**Keycloak 提供完整 OIDC Provider：**
```
OIDC 端点：
  /realms/{realm}/.well-known/openid-configuration  ← 发现文档
  /realms/{realm}/protocol/openid-connect/auth       ← 授权端点
  /realms/{realm}/protocol/openid-connect/token      ← 令牌端点
  /realms/{realm}/protocol/openid-connect/logout     ← 登出端点
  /realms/{realm}/protocol/openid-connect/userinfo   ← 用户信息
  /realms/{realm}/protocol/openid-connect/certs      ← JWKS 公钥

SSO 能力：
  - 一次登录，多个关联应用自动免密
  - 代理商门户 + 运营 Console + 龙虾管理台 共享登录状态
  - 跨域 Cookie/Token 共享
```

**我们现状：**
- NestJS JWT 自制认证，每个服务独立验证
- 代理商/管理员/运营 分开登录，无 SSO
- 没有标准的 OIDC 发现文档

**借鉴动作（两种选项）：**

**选项A（推荐短期）：** 在 NestJS 中实现简化 OIDC Provider
```typescript
// backend/src/auth/ 升级：
// 增加标准 OIDC 端点（发现文档 + JWKS + UserInfo）
// 使用 oidc-provider npm 包（node.js 首选 OIDC 库）
// 支持代理商门户和 Operations Console 的 SSO

依赖：npm install oidc-provider
配置：支持 code flow + refresh token
```

**选项B（推荐长期）：** 部署 Keycloak 作为 IAM 基础设施
```
docker-compose.yml 增加 Keycloak 服务：
  keycloak:
    image: quay.io/keycloak/keycloak:25.x
    environment:
      KC_DB: postgres
      KC_REALM_NAME: dragon-senate
    
  创建 Realm：dragon-senate
  创建 Client：web-console, agent-api, edge-runtime
  将现有用户迁移到 Keycloak
```

**优先级：P1（选项A），P2（选项B）**

#### ✅ 强烈借鉴：细粒度 RBAC + ABAC 授权（authz/）

**Keycloak authz/ 的核心模型：**
```
资源（Resource）：被保护的对象（API端点/页面/龙虾/数据）
作用域（Scope）：操作类型（read/write/execute/admin）
策略（Policy）：授权规则（基于角色/用户/时间/IP）
权限（Permission）：Resource × Scope → Policy 的映射

示例：
  Resource: "lobster:radar"
  Scope: "execute", "configure"
  Policy: "role:operator" → execute only
           "role:admin" → execute + configure

UMA 2.0（User-Managed Access）：
  资源拥有者可以自己授权给他人
  → 代理商可以把某只龙虾的访问权授权给下属员工
```

**我们现状：** `rbac_permission.py` 有角色权限，但粒度停留在"角色→API"层面，没有：
- 资源级别的细粒度权限（某只龙虾 vs 某个 API 端点）
- ABAC 属性授权（基于 IP/时间/账号属性的动态授权）
- 权限委托（代理商授权给员工）

**借鉴动作：**
```
升级 rbac_permission.py → 资源粒度 RBAC：

ResourcePermission 模型：
  resource_type: "lobster" | "workflow" | "channel" | "api_key" | "edge_node"
  resource_id: str        # 具体资源 ID（如 lobster-radar-001）
  scope: "read" | "write" | "execute" | "admin"
  subject_type: "role" | "user" | "tenant"
  subject_id: str

示例规则：
  resource: lobster:radar, scope: execute → role:operator ✅
  resource: lobster:*, scope: admin → role:superadmin only
  resource: channel:douyin-*  → tenant_id 匹配才能访问

这样代理商只能操作自己租户的龙虾，不会越界
```

**优先级：P1**（多租户 SaaS 安全隔离的关键）

#### ✅ 可借鉴：多因素认证（MFA/OTP）

**Keycloak 支持：**
- TOTP（Google Authenticator / Authy）
- WebAuthn（FIDO2 硬件密钥）
- Email OTP
- SMS OTP

**我们现状：** 登录仅密码，无 MFA。

**借鉴动作：**
```
为管理员账号增加 TOTP MFA：
  backend/src/auth/mfa.service.ts（新建）
  
  使用 speakeasy npm 包：
    生成 TOTP 密钥 → 返回 QR Code
    验证 6位 TOTP 码
    备用码（Recovery Code）生成
  
  触发场景：
    - 管理员账号登录强制 MFA
    - 代理商账号可选 MFA（开关）
    - 首次启用敏感操作时要求 MFA 确认
```

**优先级：P2**（企业客户安全合规需求）

#### ❌ 略过：Keycloak 的 SAML 2.0 支持

**Keycloak 支持 SAML 2.0** 用于企业 SSO（对接 AD FS 等）。  
**我们的场景：** 面向中小商家代理商，不需要 SAML，OIDC + 微信/手机号登录足够。

---

### 2.3 用户联合（federation/ vs 我们的账号体系）

#### ✅ 可借鉴：社交登录 / 第三方身份提供商

**Keycloak 支持：**
```
国际：Google / GitHub / Facebook / Twitter / Apple
中国：微信 / 微博 / QQ / 支付宝（需要自定义 IdP）
```

**我们现状：** 登录方式仅手机号+验证码，无社交登录。

**借鉴动作：**
```
增加微信扫码登录（代理商门户优先）：
  backend/src/auth/wechat.service.ts
  
  流程：
    1. 前端显示微信扫码二维码（微信开放平台 OAuth2）
    2. 用户扫码授权
    3. 后端获取 openid → 查询/创建用户
    4. 返回 JWT token

  意义：
    - 代理商一键微信登录，减少注册摩擦
    - 与企业微信打通（未来）
```

**优先级：P2**（提升代理商注册/登录转化率）

#### ❌ 略过：LDAP / Active Directory 联合

**Keycloak federation/** 主要用于企业 LDAP/AD 对接。  
**我们的用户：** 中小商家/代理商，无 LDAP 需求。

---

### 2.4 事件审计（services/events vs 我们的 tenant_audit_log.py）

#### ✅ 可借鉴：标准化事件分类体系

**Keycloak 的事件类型分类（来自 EventType.java）：**
```
认证事件：
  LOGIN / LOGIN_ERROR / LOGOUT / LOGOUT_ERROR
  REGISTER / REGISTER_ERROR
  CODE_TO_TOKEN / CODE_TO_TOKEN_ERROR
  REFRESH_TOKEN / REFRESH_TOKEN_ERROR
  
管理事件（Admin Events）：
  CREATE / UPDATE / DELETE / ACTION
  目标资源类型：
    USER / GROUP / ROLE / CLIENT / REALM_ROLE
    CLIENT_SCOPE / IDENTITY_PROVIDER / COMPONENT
    
用户事件：
  UPDATE_PASSWORD / UPDATE_EMAIL / UPDATE_PROFILE
  VERIFY_EMAIL / SEND_RESET_PASSWORD
  REQUIRED_ACTION_*
```

**我们现状：** `tenant_audit_log.py` 有审计日志，但事件类型分类比较松散，没有统一的事件类型枚举。

**借鉴动作：**
```
在 tenant_audit_log.py 增加标准化事件分类：

class AuditEventType(str, Enum):
    # 认证类
    AUTH_LOGIN = "AUTH_LOGIN"
    AUTH_LOGIN_FAILED = "AUTH_LOGIN_FAILED"
    AUTH_LOGOUT = "AUTH_LOGOUT"
    AUTH_TOKEN_REFRESH = "AUTH_TOKEN_REFRESH"
    AUTH_MFA_ENABLED = "AUTH_MFA_ENABLED"
    
    # 用户管理类
    USER_CREATE = "USER_CREATE"
    USER_UPDATE = "USER_UPDATE"
    USER_DELETE = "USER_DELETE"
    USER_PASSWORD_RESET = "USER_PASSWORD_RESET"
    
    # 龙虾操作类
    LOBSTER_EXECUTE = "LOBSTER_EXECUTE"
    LOBSTER_CONFIG_UPDATE = "LOBSTER_CONFIG_UPDATE"
    LOBSTER_ENABLE = "LOBSTER_ENABLE"
    LOBSTER_DISABLE = "LOBSTER_DISABLE"
    
    # 租户/计费类
    TENANT_CREATE = "TENANT_CREATE"
    TENANT_PLAN_CHANGE = "TENANT_PLAN_CHANGE"
    BILLING_CHARGE = "BILLING_CHARGE"
    QUOTA_EXCEED = "QUOTA_EXCEED"
    
    # 安全类
    PERMISSION_DENIED = "PERMISSION_DENIED"
    SUSPICIOUS_ACTIVITY = "SUSPICIOUS_ACTIVITY"
    API_KEY_CREATE = "API_KEY_CREATE"
    API_KEY_REVOKE = "API_KEY_REVOKE"
    
    # 边缘节点类
    EDGE_REGISTER = "EDGE_REGISTER"
    EDGE_DISCONNECT = "EDGE_DISCONNECT"
    EDGE_TASK_EXECUTE = "EDGE_TASK_EXECUTE"
```

**优先级：P1**（审计日志标准化是合规的基础，也方便前端筛选过滤）

#### ✅ 可借鉴：事件保留策略（Event Retention）

**Keycloak 的做法：**
```
管理员可设置事件保留天数：
  - 登录事件：默认保留 60 天
  - 管理事件：默认保留 90 天
  - 到期自动删除（定时任务清理）
```

**我们现状：** `tenant_audit_log.py` 无保留策略，日志会无限增长。

**借鉴动作：**
```
在 tenant_audit_log.py 增加保留策略：

class AuditRetentionPolicy:
    login_events_days: int = 60
    admin_events_days: int = 90
    lobster_events_days: int = 30
    
# 定时任务（cron）每日清理过期日志
```

**优先级：P2**（运营成本控制 + GDPR 合规）

---

### 2.5 L2.5 支撑微服务集群

#### ✅ 强烈借鉴：SCIM 2.0 用户目录同步（scim/）

**Keycloak scim/ 的能力：**
```
SCIM 2.0（System for Cross-domain Identity Management）：
  - 标准化用户目录同步协议
  - 支持把 Keycloak 用户同步到第三方系统（如 CRM、HR 系统）
  - 支持从外部系统推送用户变更到 Keycloak
  
SCIM 端点：
  GET    /scim/v2/Users           → 查询用户列表
  POST   /scim/v2/Users           → 创建用户
  PUT    /scim/v2/Users/{id}      → 更新用户
  DELETE /scim/v2/Users/{id}      → 删除用户
  GET    /scim/v2/Groups          → 查询用户组（租户/角色）
```

**我们现状：** `tenant_memory_sync.py` 做租户记忆同步，但没有标准的用户目录同步协议。

**借鉴动作：**
```
为我们的 SaaS 增加 SCIM 2.0 端点：
  dragon-senate-saas-v2/scim_provider.py（新建）
  
  用途：
    - 企业客户将自己的员工账号同步到龙虾池
    - 代理商将下属账号批量导入
    - 与第三方 HR/CRM 系统打通（SAP SuccessFactors / 钉钉 HR）
    
  意义：
    - 让企业客户无缝接入，不用手动逐个创建账号
    - 打通钉钉/飞书企业通讯录（SCIM + 企业通讯录 API）
```

**优先级：P2**（企业客户批量上线的关键）

#### ✅ 可借鉴：Token 内省（Introspection）端点

**Keycloak 标准 Token 内省：**
```
POST /realms/{realm}/protocol/openid-connect/token/introspect
参数：token=xxx

响应：
{
  "active": true,
  "sub": "user-id",
  "exp": 1234567890,
  "iat": 1234567800,
  "scope": "openid profile",
  "realm_access": { "roles": ["operator"] },
  "resource_access": { "web-console": { "roles": ["admin"] } }
}
```

**我们现状：** 每个微服务（NestJS / FastAPI）都要解码 JWT 验签，没有集中内省端点。

**借鉴动作：**
```
在 NestJS 增加 Token 内省端点：
  GET /auth/introspect
  响应：当前 token 的解码信息 + 权限列表
  
  FastAPI 和 edge-runtime 可调用此端点验证 token
  避免每个服务都要硬编码 JWT 密钥
```

**优先级：P2**（微服务间认证解耦）

#### ❌ 略过：Keycloak 的 K8s Operator（operator/）

**Keycloak operator/** 是 Kubernetes CRD + Controller，用于在 K8s 中自动部署/升级 Keycloak。  
**我们的部署：** Docker Compose。如果未来上 K8s 可以直接使用 Keycloak Operator。  
**当前阶段无需关注。**

---

### 2.6 云边调度层 + 边缘层

#### ❌ 略过：Keycloak 无云边调度概念

Keycloak 是纯云端 IAM，没有边缘节点、离线调度、WebSocket 云边通信的概念。  
**我们的云边调度 + edge-runtime 是我们的核心优势壁垒。**

---

### 2.7 SaaS 系统（整体商业化）

#### ✅ 强烈借鉴：Realm = 租户隔离模型

**Keycloak Realm 的设计哲学：**
```
每个 Realm 是一个完全隔离的命名空间：
  - 独立的用户库
  - 独立的角色/权限配置
  - 独立的社交登录/IdP 配置
  - 独立的主题（登录页品牌化）
  - 独立的 Token 策略（有效期/刷新策略）
  - 独立的审计日志
  
master Realm → 超级管理员（我们的平台运营）
tenant-A Realm → 代理商 A 及其下属商家
tenant-B Realm → 代理商 B 及其下属商家
```

**我们现状：** `tenant_audit_log.py` / `rbac_permission.py` 有 tenant_id，但租户隔离停留在数据过滤层，不是物理隔离的命名空间。

**借鉴动作：**
```
强化租户隔离模型：
  在 API 中间件层增加 TenantContext：
  
  每个请求必须携带 tenant_id（JWT claim 或 header）
  所有数据库查询自动加 tenant_id 过滤（Row-Level Security）
  Redis key 统一前缀：tenant:{id}:*
  
  新建 dragon-senate-saas-v2/tenant_context.py：
    - 从 JWT 提取 tenant_id
    - 注入到整个请求生命周期
    - 防止跨租户数据泄露（全局 guard）
```

**优先级：P1**（多租户 SaaS 安全的基础，比 Keycloak 更轻量可控）

#### ✅ 可借鉴：白标（White-label）主题支持

**Keycloak 主题系统用于白标化：**
```
代理商 A → 登录页显示代理商 A 的 logo + 品牌色
代理商 B → 登录页显示代理商 B 的 logo + 品牌色
完全不暴露"龙虾池"品牌
```

**借鉴动作：**
```
在我们的 SaaS 增加白标配置：
  tenant_config 中增加：
    brand_logo_url: str      # 代理商 logo
    brand_primary_color: str  # 品牌主色
    brand_name: str           # 品牌名称
    custom_domain: str        # 自定义域名（如 ai.agent-a.com）
  
  登录页根据 tenant_config 动态渲染品牌化样式
  这就是"white-label SaaS"的核心实现
  
  新建 dragon-senate-saas-v2/white_label_config.py
```

**优先级：P1**（白标是代理商计划的核心卖点，直接影响销售）

---

## 三、Keycloak vs 我们 — 优劣势对比总结

| 维度 | Keycloak | 我们（龙虾池）| 胜负 |
|-----|---------|-------------|------|
| 标准 OIDC/OAuth2 | ✅ 完整 Provider | 自制 JWT，部分兼容 | **Keycloak 胜** |
| 细粒度 RBAC/ABAC | ✅ Policy Engine | rbac_permission.py（较粗） | **Keycloak 胜** |
| 多租户 Realm 隔离 | ✅ 物理命名空间隔离 | tenant_id 过滤（逻辑隔离）| **Keycloak 胜** |
| MFA / OTP | ✅ TOTP/WebAuthn | ❌ 无 | **Keycloak 胜** |
| 社交登录 | ✅ 20+ IdP | 手机号+验证码 | **Keycloak 胜** |
| 事件审计分类 | ✅ 标准 EventType | 松散分类 | **Keycloak 胜** |
| 白标主题 | ✅ Themes 系统 | ❌ 无主题系统 | **Keycloak 胜** |
| SCIM 用户同步 | ✅ SCIM 2.0 | ❌ 无 | **Keycloak 胜** |
| 云边调度 | ❌ 无 | ✅ 完整 | **我们胜** |
| 边缘自治 | ❌ 无 | ✅ 完整 | **我们胜** |
| AI 龙虾系统 | ❌ 无 | ✅ 9只专业龙虾 | **我们胜** |
| 业务 SaaS 功能 | ❌ 仅 IAM | ✅ 完整内容运营 SaaS | **我们胜** |
| 计费/订阅 | ❌ 无 | ✅ V7 定价体系 | **我们胜** |
| 中国社交登录 | 需自定义 IdP | 手机号（已有）| **平手** |

**总结：Keycloak 在身份认证/授权/多租户隔离/审计/白标方面远超我们当前自制方案；但 Keycloak 是纯 IAM 工具，与我们的业务 SaaS 功能（龙虾/边缘/内容运营）完全不重叠，可以作为基础设施引入。**

---

## 四、借鉴清单（优先级排序）

### P1 立即行动（无需引入 Keycloak 本身，直接升级我们的代码）

| # | 借鉴点 | 来源 | 落地文件 | 工时 |
|---|--------|------|---------|------|
| 1 | **资源粒度 RBAC** 龙虾/渠道/工作流级别的权限控制 | `authz/` Policy Engine | `rbac_permission.py` 升级 | 2天 |
| 2 | **白标主题配置** 代理商登录页品牌化（logo/色/域名）| `themes/` | `white_label_config.py`（新建）| 2天 |
| 3 | **标准化审计事件分类** AuditEventType 枚举，覆盖所有操作类型 | `EventType.java` | `tenant_audit_log.py` 升级 | 1天 |
| 4 | **租户上下文中间件** 请求级 tenant_id 注入 + 跨租户防泄露 | Realm 隔离模型 | `tenant_context.py`（新建）| 1天 |

### P2 下一阶段

| # | 借鉴点 | 来源 | 落地文件 | 工时 |
|---|--------|------|---------|------|
| 5 | **TOTP MFA** 管理员账号强制多因素认证 | OTP/WebAuthn | `mfa.service.ts`（新建）| 2天 |
| 6 | **微信扫码登录** 代理商门户社交登录 | Identity Provider | `wechat.service.ts`（新建）| 2天 |
| 7 | **Token 内省端点** `/auth/introspect`，微服务间认证解耦 | Token Introspection | NestJS auth 模块升级 | 1天 |
| 8 | **事件保留策略** 审计日志定时清理，可配置保留天数 | Event Retention | `tenant_audit_log.py` 升级 | 0.5天 |
| 9 | **SCIM 2.0** 企业用户目录同步，对接钉钉/飞书 | `scim/` | `scim_provider.py`（新建）| 3天 |

### P3 远期（引入 Keycloak 作为 IAM 基础设施）

| # | 借鉴点 | 说明 |
|---|--------|------|
| 10 | **部署 Keycloak** 替换自制 JWT 认证，成为标准 IAM | docker-compose.yml 增加 Keycloak 服务 |
| 11 | **Keycloak Operator** 上 Kubernetes 后用 Operator 管理 | 需要先完成 K8s 迁移 |

---

## 五、最高价值行动：白标主题 + 资源粒度 RBAC

### 白标主题（white_label_config.py）

```
代理商购买龙虾池服务 → 配置白标信息：
  - 上传品牌 logo
  - 设置品牌主色（#FF4500 → 对应代理商品牌）
  - 绑定自定义域名（ai.agentA.com → 我们的服务器）
  
效果：
  代理商的客户打开 ai.agentA.com → 看到的是代理商 A 的品牌
  完全不知道背后是龙虾池
  → 这就是"白标 SaaS"的核心价值
```

### 资源粒度 RBAC（rbac_permission.py 升级）

```
当前："用户A" 有 "operator 角色" → 可以访问所有 operator 接口
升级："用户A" 有 "对龙虾-radar 的 execute 权限" → 只能操作 radar，无法操作 abacus

对代理商的意义：
  代理商老板：拥有所有龙虾的 admin 权限
  代理商员工A：只有 echoer + catcher 的 execute 权限
  代理商员工B：只有查看权限，不能执行任何操作
```

---

*分析基于 Keycloak 25.x 架构（2026-04-02）*  
*分析人：龙虾池 AI 团队 | 2026-04-02*
