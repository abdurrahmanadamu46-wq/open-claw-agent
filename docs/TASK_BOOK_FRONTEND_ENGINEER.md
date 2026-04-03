# 前端工程师任务书 — 控制台页面真实接线

> 发布日期：2026-04-03  
> 负责人：前端工程师  
> 目标：把当前所有「演示布局」stub 页面逐步接入真实后端 API，同时补齐侧边栏缺失的导航项。  
> 汇报方式：每完成一个页面，在群里发 "页面名 接线完成，截图见附件"，并在 PCC 控制面章节把对应条目从 🟡 改为 ✅。

---

## 背景与约束

- **后端已部署地址**：`http://localhost:8000`（Python FastAPI）
- **NestJS 代理层**：`http://localhost:3000`（backend/src/ai-subservice/）
- **前端 dev 地址**：`http://localhost:3001`（Next.js）
- **API 调用规则**：前端统一调用 NestJS（`/api/...`），NestJS 代理到 FastAPI。不要直接调 `localhost:8000`。
- **国际化**：所有新文本必须加到 `web/src/locales/zh.json` 和 `en.json`，不允许硬编码中文字符串在组件里（仅 stub 页除外）。
- **样式规则**：沿用已有暗色系（`PANEL_BG = '#16243b'`，`BORDER = 'rgba(71,85,105,0.42)'`），不引入新颜色系统。

---

## 任务一：实时执行监控室 WebSocket 接线（P2 最高优先）

**页面路径**：`F:/openclaw-agent/web/src/app/operations/monitor/page.tsx`

**现状**：页面已存在，WebSocket 连接代码已写好，但后端 `ws/execution-logs` 还没有数据推送进来（需等后端工程师完成 Batch 1），快照 REST 接口也未接线。

**需要修改**：`web/src/services/endpoints/ai-subservice.ts`

在文件末尾添加以下函数（如果还没有的话）：

```typescript
// 执行监控快照
export async function fetchExecutionMonitorSnapshot(tenantId: string) {
  const res = await apiClient.get(`/api/v1/monitor/snapshot?tenant_id=${tenantId}`);
  return res.data as { nodes: ExecutionMonitorNodeRow[]; recent_logs: ExecutionMonitorEvent[] };
}

// Event Bus subject 列表
export async function fetchEventBusSubjects(prefix?: string) {
  const params = prefix ? `?prefix=${encodeURIComponent(prefix)}` : '';
  const res = await apiClient.get(`/api/observability/event-bus/subjects${params}`);
  return res.data as { subjects: EventBusSubjectStat[] };
}

// Event Bus prefix 聚合
export async function fetchEventBusPrefixSummary() {
  const res = await apiClient.get('/api/observability/event-bus/prefix-summary');
  return res.data as { prefixes: EventBusPrefixSummary[] };
}
```

**类型定义**（加在同文件或单独 `types/event-bus-traffic.ts`）：
```typescript
export type ExecutionMonitorNodeRow = {
  node_id: string; client_name?: string; status: string;
  region?: string; load_percent?: number; running_task_id?: string; last_seen_at?: string;
};
export type ExecutionMonitorEvent = {
  task_id: string; node_id: string; level: string;
  message: string; stage?: string; created_at?: string;
};
export type EventBusSubjectStat = {
  subject: string; count_last_minute: number;
  count_last_hour: number; total_count: number; last_published_at?: number;
};
export type EventBusPrefixSummary = {
  prefix: string; count_last_minute: number;
  count_last_hour: number; total_count: number;
};
```

**验证**：
1. 打开 `http://localhost:3001/operations/monitor`
2. 点「刷新」按钮，不应有红色报错（即使数据为空也要返回空数组）
3. WebSocket 状态指示器应显示「连接中...」或「已连接」，不应卡在「已断开」

---

## 任务二：侧边栏补全缺失导航项

**文件**：`F:/openclaw-agent/web/src/components/layout/AppSidebar.tsx`

对照现有路由目录，以下页面已有文件但侧边栏没有入口（通过直接输入 URL 可以访问，但菜单中找不到）：

| 路由 | labelKey | icon |
|---|---|---|
| `/operations/feature-flags` | `nav.feature_flags` | `ToggleLeft` |
| `/operations/experiments` | `nav.experiments` | `FlaskConical` |
| `/operations/traces` | `nav.traces` | `Activity` |
| `/operations/alerts` | `nav.alerts` | `Bell` |
| `/operations/sessions` | `nav.sessions` | `MessageSquare` |
| `/analytics/attribution` | `nav.analytics_attribution` | `ChartLine` |（已在 GROUPS 但未确认）
| `/settings/audit` | `nav.audit` | `Shield` |
| `/settings/permissions` | `nav.permissions` | `Lock` |
| `/settings/white-label` | `nav.white_label` | `Palette` |
| `/partner/portal` | `nav.partner_portal` | `BriefcaseBusiness` |（已在 GROUPS 确认）

**操作步骤**：
1. 打开 `AppSidebar.tsx`，在 `GROUPS` 数组中找到 `id: 'operations'` 的 items 数组
2. 逐条添加缺失的 items，格式参考现有条目：
   ```typescript
   { href: '/operations/feature-flags', labelKey: 'nav.feature_flags', icon: ToggleLeft },
   ```
3. 在 `lucide-react` import 行补充需要的 icon（先用 `Grep` 确认 icon 名称存在）：
   ```typescript
   import { ..., ToggleLeft, FlaskConical, Bell, MessageSquare, Shield, Lock, Palette } from 'lucide-react';
   ```
4. 在 `web/src/locales/zh.json` 和 `en.json` 补充对应 key：
   ```json
   "feature_flags": "功能开关",
   "experiments": "实验评测",
   "traces": "链路追踪",
   "alerts": "告警规则",
   "sessions": "会话管理",
   "audit": "审计日志",
   "permissions": "权限管理",
   "white_label": "白标主题"
   ```

**验证**：
```bash
cd F:/openclaw-agent/web
npx tsc --noEmit   # 0 错误
npm run build      # build 成功
```
然后打开侧边栏确认所有新增条目可以点击跳转。

---

## 任务三：前端 endpoints 文件补齐

**背景**：`web/src/services/endpoints/` 目前只有 16 个文件，但后端已有 200+ 个 API 路由。以下是优先补齐的 endpoints。

### 3A — 补齐 `feature-flags.ts`

新建 `web/src/services/endpoints/feature-flags.ts`：

```typescript
import { apiClient } from '../client';

export type FeatureFlag = {
  name: string; description?: string; enabled: boolean;
  rollout_percentage?: number; created_at?: string;
};

export async function fetchFeatureFlags() {
  const res = await apiClient.get('/api/v1/feature-flags');
  return res.data as { flags: FeatureFlag[] };
}

export async function createFeatureFlag(payload: { name: string; description?: string; enabled?: boolean }) {
  const res = await apiClient.post('/api/v1/feature-flags', payload);
  return res.data as FeatureFlag;
}

export async function toggleFeatureFlag(name: string, enable: boolean) {
  const endpoint = enable ? 'enable' : 'disable';
  const res = await apiClient.post(`/api/v1/feature-flags/${name}/${endpoint}`);
  return res.data;
}

export async function deleteFeatureFlag(name: string) {
  const res = await apiClient.delete(`/api/v1/feature-flags/${name}`);
  return res.data;
}
```

### 3B — 补齐 `experiments.ts`

新建 `web/src/services/endpoints/experiments.ts`：

```typescript
import { apiClient } from '../client';

export type Experiment = {
  id: string; name: string; status: string;
  created_at?: string; sample_count?: number;
};

export async function fetchExperiments() {
  const res = await apiClient.get('/api/v1/experiments');
  return res.data as { experiments: Experiment[] };
}

export async function fetchExperiment(id: string) {
  const res = await apiClient.get(`/api/v1/experiments/${id}`);
  return res.data as Experiment;
}

export async function runExperiment(id: string) {
  const res = await apiClient.post(`/api/v1/experiments/${id}/run`);
  return res.data;
}
```

### 3C — 验证方式

```bash
cd F:/openclaw-agent/web
npx tsc --noEmit   # 0 类型错误
```

然后在 `/operations/feature-flags` 页面的 `useQuery` 中引入 `fetchFeatureFlags`，确认数据能正常加载（或返回空数组时显示「暂无数据」）。

---

## 任务四：Onboarding 页面接线（接后端就绪后）

**页面**：`F:/openclaw-agent/web/src/app/onboarding/page.tsx`  
**等待条件**：需要后端工程师 Batch 2 完成（`enterprise_onboarding.py` 合并并注册路由）

**接线目标**：Step 4「生成首批任务」的「进入任务列表」按钮，改为真实调用：
```typescript
// 替换 stub 的静态任务列表，改为：
const { data } = useQuery({
  queryKey: ['onboarding-tasks', industry],
  queryFn: () => apiClient.post('/api/v1/onboarding/generate-tasks', { industry }),
});
```

届时你会从后端工程师那里得到具体的 API 路径和 payload 格式，再做接线。

---

## 汇报格式

```
任务N 完成
- 页面/文件：<路径>
- 接入 API：<端点列表>
- 验证：build 通过 / 截图已附
- PCC 已更新：<条目>
- 遇到的问题：<如有>
```
