# Frontend Codex Handoff — 龙虾池 Dashboard

> 本文档给前端 AI（Codex / Cursor / Cline）或人类前端工程师作为接力说明。
> 目标：快速对齐龙虾池控制台、技能系统和业务闭环可视化。

---

## 一、你要做什么

在 `web/` 目录中构建两类前端能力：

1. **龙虾池管理 Dashboard**
2. **龙虾技能系统 UI**

后端 API 已具备以下两类接口：
- 龙虾池概览 / 明细 / Scorer
- 技能列表 / 技能详情

无需修改后端即可开始页面开发。

---

## 二、已有后端 API

### 龙虾池 Dashboard
- `GET /lobster/pool/overview`
- `GET /lobster/pool/metrics`
- `GET /lobster/pool/registry`
- `GET /lobster/{lobster_id}/detail`
- `POST /lobster/scoring/simulate`
- `GET /lobster/routing/history`

### 龙虾技能系统
- `GET /api/skills`
- `GET /api/skills?lobster_id=visualizer`
- `GET /api/skills/{skill_id}`

### Agent OS 文件
- `GET /api/lobster/{role_id}/soul`
- `GET /api/lobster/{role_id}/agents`
- `GET /api/lobster/{role_id}/heartbeat`
- `GET /api/lobster/{role_id}/working`

说明：
- `GET /api/skills` 当前返回 **46** 个技能
- `GET /api/skills?lobster_id=visualizer` 当前返回 **8** 个技能
- `config_fields` 用于驱动动态表单
- `PASSWORD` 类型字段在 API 返回中已脱敏

---

## 三、页面建议

### Dashboard 页面
建议路由：
- `/dashboard/lobster-pool`
- `/dashboard/lobster-pool/[id]`
- `/dashboard/lobster-pool/scorer`

### 技能系统页面
建议新增：
- `/dashboard/lobster-skills`
- `/dashboard/lobster-skills/[lobsterId]`

---

## 四、龙虾技能系统

### 技能总数
当前共 **46** 个技能，覆盖 9 只业务龙虾。

### 输出格式模板
每只业务龙虾当前都统一支持 4 种标准输出模板：
- `alert`
- `digest`
- `comparison`
- `analysis`

前端可根据工件元数据中的 `format` 选择模板渲染；若未指定，默认按 `analysis` 渲染。

建议前端接口：
```ts
interface RoleCardExtended {
  outputFormats: {
    alert: string;
    digest: string;
    comparison: string;
    analysis: string;
  };
}
```

### 页面需求
1. **技能总览页**
   - 按龙虾分组展示技能卡片
   - 卡片字段：图标、名称、描述、分类、启用状态

2. **技能配置弹窗**
   - 点击技能卡片后弹出配置面板
   - 表单完全由 `config_fields` 动态驱动

3. **业务闭环可视化**
   - 7 阶段环形图或泳道图
   - 每阶段展示：
     - 对应龙虾
     - 技能数量
     - 代表技能

4. **Agent OS 详情抽屉**
   - SOUL.md
   - AGENTS.md
   - HEARTBEAT.json
   - WORKING.json

---

## 五、业务闭环 7 阶段

| 阶段 | 龙虾 | 技能数 | 代表性技能 |
|------|------|--------|-----------|
| ① 信号发现 | 触须虾 | 8 | 全网热点监控、竞品追踪 |
| ② 策略制定 | 脑虫虾 | 7 | 内容日历排期、A/B 测试设计 |
| ③-A 文案 | 吐墨虾 | 5 | 多平台文案适配、违禁词检测 |
| ③-B 视觉 | 幻影虾 | 8 | AI 图片生成、数字人视频 |
| ④ 分发 | 点兵虾 | 4 | 定时发布、多账号轮转 |
| ⑤ 互动 + 线索 | 回声虾 + 铁网虾 | 7 | 私信回复、微信引流、CRM 入库 |
| ⑥ 跟进 | 回访虾 | 3 | 多触点跟进、沉默用户唤醒 |
| ⑦ 复盘 | 金算虾 | 4 | 多触点归因、策略反馈闭环 |

---

## 六、前端组件建议

建议文件：

```text
web/src/app/dashboard/lobster-pool/page.tsx
web/src/app/dashboard/lobster-pool/[id]/page.tsx
web/src/app/dashboard/lobster-pool/scorer/page.tsx
web/src/app/dashboard/lobster-skills/page.tsx
web/src/app/dashboard/lobster-skills/[lobsterId]/page.tsx

web/src/components/lobster/LobsterCard.tsx
web/src/components/lobster/LobsterStatusBadge.tsx
web/src/components/lobster/TokenUsageChart.tsx
web/src/components/lobster/CostChart.tsx
web/src/components/lobster/ScorerForm.tsx
web/src/components/lobster/DimensionRadar.tsx
web/src/components/lobster/LobsterSkillCard.tsx
web/src/components/lobster/LobsterSkillConfigModal.tsx

web/src/lib/lobster-api.ts
```

---

## 七、技能 UI 设计重点

### 技能卡片
建议展示：
- `icon`
- `name`
- `description`
- `category`
- `bound_lobsters`
- `enabled`

### 动态配置表单
根据 `config_fields[].field_type` 渲染：
- `text`
- `textarea`
- `number`
- `select`
- `toggle`
- `password`

### 密码字段
- 前端看到的是脱敏值
- 更新时走单独表单状态，不回显真实值

---

## 八、技术要求

- 使用现有 `web/` 的 Next.js + Tailwind CSS
- 图表建议使用 `recharts`
- 复用已有 API client / fetch wrapper
- 必须支持暗色模式
- 响应式：技能卡片和龙虾卡片在移动端退化为单列

---

## 九、给前端 Codex 的一句话指令

```text
请读取 docs/FRONTEND_CODEX_HANDOFF.md，
在 web/ 目录中构建龙虾池 Dashboard + 龙虾技能系统页面。
后端 API 已就绪，无需修改后端。
使用 Next.js + Tailwind + Recharts，支持暗色模式和响应式。
```
