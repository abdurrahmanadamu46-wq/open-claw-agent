# CODEX TASK: 白标（White-Label）主题系统 — 代理商品牌化

**优先级：P1**  
**来源借鉴：Keycloak `themes/` 主题系统 + Realm 品牌配置**  
**参考分析：`docs/KEYCLOAK_BORROWING_ANALYSIS.md` 第二节 2.7**

---

## 背景

Keycloak 的 Themes 系统允许每个 Realm（租户）完全自定义登录页和邮件通知的外观，这是白标 SaaS 的核心基础设施。

我们的代理商计划要求：代理商的客户看到的是代理商品牌（logo、品牌色、域名），完全不暴露"龙虾池"品牌。这是代理商付费的核心价值之一。

---

## 任务目标

构建白标配置系统：后端存储租户品牌配置，前端根据租户动态渲染品牌化登录页和全局样式。

---

## 一、后端：新建 `dragon-senate-saas-v2/white_label_config.py`

```python
# white_label_config.py
# 租户白标配置管理

from dataclasses import dataclass, field
from typing import Optional

@dataclass
class WhiteLabelConfig:
    """代理商白标配置"""
    tenant_id: str
    
    # 品牌信息
    brand_name: str                    # 品牌名称（如"智慧运营助手"）
    brand_logo_url: Optional[str]      # Logo URL（建议 SVG 或 PNG，正方形）
    brand_favicon_url: Optional[str]   # Favicon URL
    
    # 品牌色彩
    brand_primary_color: str = "#3B82F6"      # 主色（按钮/链接/高亮）
    brand_secondary_color: str = "#10B981"    # 辅色
    brand_bg_color: str = "#FFFFFF"           # 背景色
    brand_text_color: str = "#1F2937"         # 文字色
    
    # 自定义域名
    custom_domain: Optional[str] = None       # 如 "ai.agentA.com"
    
    # 登录页配置
    login_slogan: Optional[str] = None        # 登录页标语
    login_bg_image_url: Optional[str] = None  # 登录页背景图
    
    # 联系信息（显示在登录页底部）
    support_email: Optional[str] = None
    support_phone: Optional[str] = None
    
    # 隐藏龙虾池痕迹
    hide_powered_by: bool = True              # 是否隐藏"Powered by 龙虾池"
    
    # 邮件配置
    email_from_name: Optional[str] = None     # 发件人名称（如"智慧运营助手"）
    email_from_address: Optional[str] = None  # 发件人地址
    
    created_at: datetime = None
    updated_at: datetime = None

class WhiteLabelManager:
    """
    白标配置管理器
    
    方法：
      get_config(tenant_id: str) → WhiteLabelConfig | None
      save_config(config: WhiteLabelConfig) → None
      delete_config(tenant_id: str) → None
      get_css_vars(tenant_id: str) → dict  # 返回 CSS 变量字典
      get_meta_tags(tenant_id: str) → dict  # 返回 HTML meta 信息
    
    存储：
      配置写入 DB（white_label_configs 表）
      Logo/图片文件上传到 OSS/S3，存储 URL
      配置缓存 Redis（TTL 5分钟），避免频繁查 DB
    """
```

### 后端 API

```
GET    /api/v1/white-label/{tenant_id}        → 获取白标配置（公开，用于前端渲染）
PUT    /api/v1/white-label/{tenant_id}        → 更新白标配置（需 admin 权限）
POST   /api/v1/white-label/{tenant_id}/logo   → 上传 Logo（multipart，需 admin 权限）
DELETE /api/v1/white-label/{tenant_id}        → 重置为默认配置（需 superadmin）
GET    /api/v1/white-label/{tenant_id}/preview → 预览白标效果（返回 CSS 变量）
```

---

## 二、前端：动态品牌化渲染

### 2.1 白标 CSS 变量注入

在 `web/src/app/layout.tsx` 根布局中：

```typescript
// 根据 tenant_id 动态注入 CSS 变量
// 从 /api/v1/white-label/{tenant_id}/preview 获取品牌色

async function getWhiteLabelVars(tenantId: string) {
  const res = await fetch(`/api/v1/white-label/${tenantId}/preview`);
  return res.json();
}

// 注入到 <style> 标签：
// :root {
//   --brand-primary: #FF4500;
//   --brand-secondary: #10B981;
//   --brand-name: "智慧运营助手";
// }
```

### 2.2 登录页品牌化（`/auth/login`）

```typescript
// web/src/app/auth/login/page.tsx 升级

// 根据 domain 或 URL 参数识别 tenant
// 加载对应的 WhiteLabelConfig
// 渲染：
//   - 左侧品牌区：logo + 标语 + 背景图
//   - 右侧登录表单：使用品牌色按钮
//   - 底部：如 hide_powered_by=false → 显示"Powered by 龙虾池"
```

### 2.3 邮件模板品牌化

新建 `web/src/templates/email/` 目录：

```
web/src/templates/email/
├── base.html          ← 基础邮件模板（含品牌 logo + 页脚）
├── welcome.html       ← 欢迎邮件
├── reset-password.html ← 密码重置
└── verify-email.html  ← 邮箱验证

模板变量：
  {{brand_name}} / {{brand_logo_url}} / {{brand_primary_color}}
  {{support_email}} / {{support_phone}}
```

### 2.4 TypeScript 类型文件

新建 `web/src/types/white-label.ts`：

```typescript
export interface WhiteLabelConfig {
  tenant_id: string;
  brand_name: string;
  brand_logo_url?: string;
  brand_favicon_url?: string;
  brand_primary_color: string;
  brand_secondary_color: string;
  brand_bg_color: string;
  brand_text_color: string;
  custom_domain?: string;
  login_slogan?: string;
  login_bg_image_url?: string;
  support_email?: string;
  support_phone?: string;
  hide_powered_by: boolean;
  email_from_name?: string;
  email_from_address?: string;
}

export interface WhiteLabelCSSVars {
  '--brand-primary': string;
  '--brand-secondary': string;
  '--brand-bg': string;
  '--brand-text': string;
}
```

---

## 三、前端：白标配置管理页面

### 页面位置

```
/settings/white-label   ← 新建
```

### 页面功能

```
白标配置（/settings/white-label）
├── 品牌信息区
│   ├── 品牌名称输入
│   ├── Logo 上传（预览 + 裁剪）
│   └── Favicon 上传
├── 品牌色配置区
│   ├── 主色 ColorPicker（含预设色卡）
│   ├── 辅色 ColorPicker
│   └── 实时预览（迷你登录页预览）
├── 自定义域名区
│   ├── 域名输入框
│   ├── DNS 验证指引（CNAME 配置说明）
│   └── 验证状态（待验证/已验证）
├── 登录页配置
│   ├── 标语文字输入
│   └── 背景图上传
└── 预览面板（右侧固定）
    └── 实时渲染登录页效果
```

---

## 四、⚠️ 覆盖规则（重要）

1. **现有登录页 `/auth/login`** 不删除，改为支持白标动态渲染（原有样式作为默认"龙虾池"主题）
2. **`PROJECT_CONTROL_CENTER.md` 中** 白标/代理商相关的 `🟡` 待实现标注全部改为 `✅`
3. **默认 tenant 配置**（平台自用）不需要白标，继续使用原有样式

---

## 五、PROJECT_CONTROL_CENTER.md 同步更新

完成后更新：

1. **第三节"当前成熟能力"** 增加：
   ```
   ✅ white_label_config.py 代理商白标配置系统
   ✅ 登录页/邮件模板品牌化渲染
   ```

2. **第四节"已完成 API"** 增加：
   ```
   ✅ GET /api/v1/white-label/{tenant_id}
   ✅ PUT /api/v1/white-label/{tenant_id}
   ✅ POST /api/v1/white-label/{tenant_id}/logo
   ✅ GET /api/v1/white-label/{tenant_id}/preview
   ```

3. **第十节"前端对齐索引"** 增加：
   ```
   | 白标配置 | GET/PUT /api/v1/white-label/* | web/src/types/white-label.ts | /settings/white-label | ✅ |
   ```

4. **第七节"已落地借鉴清单"** 增加：
   ```
   | Keycloak | 白标主题系统（品牌化登录页/邮件） | ✅ | white_label_config.py, /settings/white-label |
   ```

---

## 验收标准

- [ ] `white_label_config.py` 实现完整，支持 CRUD + 缓存
- [ ] Logo 上传接口可用，返回可访问 URL
- [ ] 登录页根据 `tenant_id` 动态渲染品牌色和 Logo
- [ ] `hide_powered_by=true` 时不显示"龙虾池"字样
- [ ] 前端 `/settings/white-label` 有实时预览
- [ ] `web/src/types/white-label.ts` 类型文件存在
- [ ] `PROJECT_CONTROL_CENTER.md` 相关标注已更新

---

*Codex Task | 来源：KEYCLOAK_BORROWING_ANALYSIS.md P1-#2 | 2026-04-02*
