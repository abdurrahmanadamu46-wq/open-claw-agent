# CODEX TASK: 前端国际化（i18n）— 中英双语

**优先级：P1**  
**来源借鉴：Aurogen `src/locales/en.json + zh.json` + `src/lib/i18n.ts`**  
**参考分析：`docs/AUROGEN_BORROWING_ANALYSIS.md` 第二节 2.1**

---

## 背景

龙虾池 SaaS 面向中国市场代理商和商家，Operations Console 当前主要为英文 labels。
Aurogen 已实现完整中英双语框架，我们需要跟进，尤其是客户/代理可见页面必须中文化。

---

## 任务目标

引入 `next-intl` 国际化框架，为 Operations Console 全部页面添加中英双语支持，默认中文。

---

## 一、技术方案

**框架：** `next-intl`（适配 Next.js 14 App Router）

**语言文件路径：**
```
web/src/locales/
├── zh.json   ← 默认语言（中文）
└── en.json   ← 备选语言（英文）
```

**语言切换：**
- 右上角语言切换按钮（🌐）
- 用户偏好存 `localStorage`
- 默认 `zh`

---

## 二、需要翻译的模块（按优先级）

### 优先级1：导航 + 通用组件
```json
// zh.json 示例结构
{
  "nav": {
    "skills_pool": "技能市场",
    "strategy": "策略强度",
    "scheduler": "定时调度",
    "workflows": "工作流",
    "memory": "记忆管理",
    "usecases": "用例市场",
    "sessions": "会话隔离",
    "channels": "渠道账号",
    "mcp": "MCP工具",
    "fleet": "边缘节点",
    "settings": "系统设置"
  },
  "common": {
    "save": "保存",
    "cancel": "取消",
    "delete": "删除",
    "confirm": "确认",
    "loading": "加载中...",
    "success": "操作成功",
    "error": "操作失败",
    "status": "状态",
    "created_at": "创建时间",
    "actions": "操作",
    "enable": "启用",
    "disable": "禁用",
    "enabled": "已启用",
    "disabled": "已禁用",
    "search": "搜索",
    "filter": "筛选",
    "export": "导出",
    "refresh": "刷新"
  }
}
```

### 优先级2：各功能页面 labels

覆盖以下页面的所有 UI 文字：
- `/operations/skills-pool` — 技能市场
- `/operations/strategy` — 策略强度
- `/operations/scheduler` — 定时调度
- `/operations/workflows` — 工作流
- `/operations/memory` — 记忆管理
- `/operations/usecases` — 用例市场
- `/operations/sessions` — 会话隔离
- `/operations/channels` — 渠道账号
- `/operations/mcp` — MCP工具（新页面，直接中文）
- `/fleet` — 边缘节点

### 优先级3：错误提示、空状态、帮助文字

---

## 三、实现步骤

### 3.1 安装依赖

```bash
cd web && npm install next-intl
```

### 3.2 配置 next-intl

`web/next.config.ts` 增加 next-intl 插件配置。

`web/src/i18n.ts`（新建）：
```typescript
import { getRequestConfig } from 'next-intl/server';

export default getRequestConfig(async ({ locale }) => ({
  messages: (await import(`./locales/${locale}.json`)).default,
}));
```

`web/src/middleware.ts`（新建或更新）：
```typescript
import createMiddleware from 'next-intl/middleware';

export default createMiddleware({
  locales: ['zh', 'en'],
  defaultLocale: 'zh',
});
```

### 3.3 使用方式

```typescript
// 页面组件中
import { useTranslations } from 'next-intl';

export default function SkillsPool() {
  const t = useTranslations('skills_pool');
  return <h1>{t('title')}</h1>;  // → "技能市场"
}
```

### 3.4 语言切换组件

新建 `web/src/components/locale-switcher.tsx`：
```typescript
// 右上角语言切换按钮
// 切换 zh / en
// 存 localStorage('preferred-locale')
// 图标：🌐 Globe
```

在全局 Header/Layout 引入此组件。

---

## 四、⚠️ 覆盖规则（重要）

1. **所有现有页面的硬编码英文字符串** 必须替换为 `t('key')` 调用
2. **不保留** 硬编码的英文文案（如 `"Skills Pool"` 直接写在 JSX 中）
3. **新建页面**（如 `/operations/mcp`）直接使用 i18n，不写硬编码
4. `en.json` 保持与 `zh.json` key 完全一致，仅 value 为英文
5. 组件级别的文案（如 Toast、Modal、Table column headers）全部纳入翻译

---

## 五、PROJECT_CONTROL_CENTER.md 同步更新

完成后更新 `PROJECT_CONTROL_CENTER.md`：

1. **第三节"当前成熟能力"** 增加：
   ```
   ✅ 前端 i18n 国际化（next-intl，中英双语，默认中文）
   ```

2. **第十节"前端对齐索引"** 新增行：
   ```
   | 国际化 i18n | — | web/src/locales/*.json | 全部 /operations/ 页面 | ✅ |
   ```

3. **第七节"已落地借鉴清单"** 增加：
   ```
   | Aurogen | 前端 i18n 国际化（next-intl，中英双语） | ✅ | web/src/locales/ |
   ```

---

## 验收标准

- [ ] `web/src/locales/zh.json` 和 `en.json` 存在，覆盖所有页面文案
- [ ] 右上角有语言切换按钮，可切换中/英
- [ ] 所有 `/operations/` 页面切换语言后立即生效，无硬编码残留
- [ ] `/fleet` 边缘节点页面也完成中文化
- [ ] `PROJECT_CONTROL_CENTER.md` 已同步更新

---

*Codex Task | 来源：AUROGEN_BORROWING_ANALYSIS.md P1-#2 | 2026-04-02*
