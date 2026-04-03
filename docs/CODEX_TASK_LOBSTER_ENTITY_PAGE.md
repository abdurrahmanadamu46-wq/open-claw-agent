# CODEX TASK: 龙虾 EntityPage — 标签页面板 + StatusCard 升级

**优先级：P1**  
**来源借鉴：Backstage Software Catalog EntityPage 设计模式**  
**参考分析：`docs/BACKSTAGE_BORROWING_ANALYSIS.md` 第二节 2.1**

---

## 背景

Backstage 的 EntityPage 是业界最成熟的实体详情页设计：固定头部 + 多标签页 + 状态卡片面板。运营人员在一个页面内可以查看实体的所有维度信息，无需在多页间跳转。

我们当前龙虾详情页是长页面滚动，信息密度高但导航困难，需要升级为标签页模式。

---

## 任务目标

升级 `web/src/app/lobsters/[id]/page.tsx` 为 Backstage EntityPage 风格：
- 固定头部（龙虾基础信息 + 状态徽章）
- 5个标签页：Overview / Skills / Runs / Knowledge / Config
- StatusCard 小面板组件
- 龙虾 lifecycle 徽章（experimental/production/deprecated）

---

## 一、页面结构设计

```
/lobsters/inkwriter-moxiaoya
┌─────────────────────────────────────────────────────────────┐
│  🦞  墨小雅 · InkWriter                                      │
│  文案创作专家 · 隶属：内容生产系统                              │
│  [🟢 production]  [● active]  [技能 7个]  [本周 342次]        │
├─────────────────────────────────────────────────────────────┤
│  Overview  │  Skills  │  Runs  │  Knowledge  │  Config       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  [本周执行 342次]  [平均质量 8.4]  [响应 P95: 1.2s]          │
│  [当前实验 inkwriter.prompt_v2 → 10%]                       │
│                                                             │
│  ▶ 快速执行                                                  │
│                                                             │
│  最近执行（最新 5 条）                                        │
│  ─────────────────────────────────────────────────────────  │
│  2026-04-02 14:32  voiceover_script  ✅ 成功  质量 8.6        │
│  2026-04-02 14:28  product_desc      ✅ 成功  质量 8.2        │
│  2026-04-02 14:15  social_copy       ❌ 失败  超时             │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 二、前端组件设计

### 2.1 主页面（`web/src/app/lobsters/[id]/page.tsx`）

```typescript
// 升级为标签页架构

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LobsterEntityHeader } from '@/components/lobster/LobsterEntityHeader';
import { LobsterOverviewTab } from '@/components/lobster/tabs/LobsterOverviewTab';
import { LobsterSkillsTab } from '@/components/lobster/tabs/LobsterSkillsTab';
import { LobsterRunsTab } from '@/components/lobster/tabs/LobsterRunsTab';
import { LobsterKnowledgeTab } from '@/components/lobster/tabs/LobsterKnowledgeTab';
import { LobsterConfigTab } from '@/components/lobster/tabs/LobsterConfigTab';

export default async function LobsterPage({ params }: { params: { id: string } }) {
  const lobster = await fetchLobster(params.id);
  
  return (
    <div className="flex flex-col h-full">
      {/* 固定头部 */}
      <LobsterEntityHeader lobster={lobster} />
      
      {/* 标签页内容 */}
      <Tabs defaultValue="overview" className="flex-1">
        <TabsList className="border-b px-6">
          <TabsTrigger value="overview">概览</TabsTrigger>
          <TabsTrigger value="skills">技能</TabsTrigger>
          <TabsTrigger value="runs">执行记录</TabsTrigger>
          <TabsTrigger value="knowledge">知识库</TabsTrigger>
          <TabsTrigger value="config">配置</TabsTrigger>
        </TabsList>
        
        <TabsContent value="overview">
          <LobsterOverviewTab lobster={lobster} />
        </TabsContent>
        <TabsContent value="skills">
          <LobsterSkillsTab lobster={lobster} />
        </TabsContent>
        <TabsContent value="runs">
          <LobsterRunsTab lobsterId={lobster.id} />
        </TabsContent>
        <TabsContent value="knowledge">
          <LobsterKnowledgeTab lobsterId={lobster.id} />
        </TabsContent>
        <TabsContent value="config">
          <LobsterConfigTab lobster={lobster} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
```

### 2.2 头部组件（`LobsterEntityHeader.tsx`）

```typescript
// web/src/components/lobster/LobsterEntityHeader.tsx

interface LobsterEntityHeaderProps {
  lobster: Lobster;
}

export function LobsterEntityHeader({ lobster }: LobsterEntityHeaderProps) {
  return (
    <div className="flex items-start gap-4 p-6 border-b bg-card">
      {/* 龙虾头像 */}
      <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center text-3xl">
        🦞
      </div>
      
      <div className="flex-1">
        {/* 名称 + 徽章行 */}
        <div className="flex items-center gap-3 mb-1">
          <h1 className="text-2xl font-bold">{lobster.display_name}</h1>
          <LifecycleBadge lifecycle={lobster.lifecycle} />
          <StatusBadge status={lobster.status} />
        </div>
        
        {/* 描述 */}
        <p className="text-muted-foreground text-sm mb-2">{lobster.description}</p>
        
        {/* 元信息行 */}
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <span>隶属：{lobster.system}</span>
          <span>·</span>
          <span>技能 {lobster.skill_count} 个</span>
          <span>·</span>
          <span>本周执行 {lobster.weekly_runs} 次</span>
          {lobster.active_experiment && (
            <>
              <span>·</span>
              <span className="text-yellow-600">🧪 A/B实验进行中 {lobster.active_experiment.rollout}%</span>
            </>
          )}
        </div>
      </div>
      
      {/* 操作按钮 */}
      <div className="flex gap-2">
        <Button variant="outline" size="sm">查看日志</Button>
        <Button size="sm">▶ 执行</Button>
      </div>
    </div>
  );
}
```

### 2.3 LifecycleBadge 组件

```typescript
// web/src/components/lobster/LifecycleBadge.tsx

type Lifecycle = 'experimental' | 'production' | 'deprecated';

const LIFECYCLE_CONFIG: Record<Lifecycle, { label: string; className: string }> = {
  experimental: { label: '实验中', className: 'bg-yellow-100 text-yellow-800 border-yellow-300' },
  production:   { label: '生产',   className: 'bg-green-100 text-green-800 border-green-300' },
  deprecated:   { label: '废弃中', className: 'bg-red-100 text-red-800 border-red-300' },
};

export function LifecycleBadge({ lifecycle }: { lifecycle: Lifecycle }) {
  const config = LIFECYCLE_CONFIG[lifecycle];
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${config.className}`}>
      {config.label}
    </span>
  );
}
```

### 2.4 StatusCard 组件（小面板）

```typescript
// web/src/components/lobster/StatusCard.tsx

interface StatusCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  trend?: 'up' | 'down' | 'neutral';
  icon?: React.ReactNode;
}

export function StatusCard({ title, value, subtitle, trend, icon }: StatusCardProps) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-muted-foreground">{title}</span>
        {icon && <span className="text-muted-foreground">{icon}</span>}
      </div>
      <div className="text-2xl font-bold">{value}</div>
      {subtitle && (
        <div className="flex items-center gap-1 mt-1">
          {trend === 'up' && <span className="text-green-500 text-xs">↑</span>}
          {trend === 'down' && <span className="text-red-500 text-xs">↓</span>}
          <span className="text-xs text-muted-foreground">{subtitle}</span>
        </div>
      )}
    </div>
  );
}
```

### 2.5 Overview 标签页（`LobsterOverviewTab.tsx`）

```typescript
// web/src/components/lobster/tabs/LobsterOverviewTab.tsx

export function LobsterOverviewTab({ lobster }: { lobster: Lobster }) {
  return (
    <div className="p-6">
      {/* StatusCard 行 */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <StatusCard
          title="本周执行"
          value={lobster.weekly_runs}
          subtitle="较上周 +12%"
          trend="up"
        />
        <StatusCard
          title="平均质量评分"
          value={lobster.avg_quality_score.toFixed(1)}
          subtitle="满分 10 分"
        />
        <StatusCard
          title="P95 响应时间"
          value={`${lobster.p95_latency_ms}ms`}
          subtitle="过去 7 天"
        />
        <StatusCard
          title="活跃边缘节点"
          value={lobster.active_edge_nodes}
          subtitle="在线"
        />
      </div>
      
      {/* 当前技能列表 */}
      <div className="mb-6">
        <h3 className="font-semibold mb-3">当前技能</h3>
        <div className="space-y-2">
          {lobster.skills.map(skill => (
            <SkillRow key={skill.name} skill={skill} />
          ))}
        </div>
      </div>
      
      {/* 最近执行记录 */}
      <div>
        <h3 className="font-semibold mb-3">最近执行</h3>
        <RunTable runs={lobster.recent_runs} compact />
      </div>
    </div>
  );
}
```

---

## 三、后端 API

需要新增或升级以下端点：

```
GET /api/v1/lobsters/{id}
  返回：完整龙虾信息（含 lifecycle/status/skill_count/weekly_runs/avg_quality_score/...）

GET /api/v1/lobsters/{id}/stats
  返回：统计数据（weekly_runs/avg_quality/p95_latency/active_edge_nodes）

GET /api/v1/lobsters/{id}/runs?limit=20&page=1
  返回：执行记录列表

GET /api/v1/lobsters/{id}/docs
  返回：龙虾知识库 Markdown（从 docs/lobster-kb/{name}/ 读取）

GET /api/v1/lobsters/{id}/skills
  返回：技能列表（含评分/版本/Feature Flag 状态）
```

---

## 四、TypeScript 类型更新

更新 `web/src/types/lobster.ts`：

```typescript
export type Lifecycle = 'experimental' | 'production' | 'deprecated';
export type LobsterStatus = 'active' | 'idle' | 'training' | 'offline' | 'error';

export interface Lobster {
  id: string;
  name: string;                    // "inkwriter"
  display_name: string;            // "墨小雅"
  description: string;
  lifecycle: Lifecycle;            // 新增
  status: LobsterStatus;
  system: string;                  // "content-operation" 新增
  skill_count: number;
  weekly_runs: number;
  avg_quality_score: number;
  p95_latency_ms: number;
  active_edge_nodes: number;
  active_experiment?: {
    flag_name: string;
    rollout: number;
  };
  skills: LobsterSkill[];
  recent_runs: LobsterRun[];
  tags: string[];
  annotations: Record<string, string>;  // 新增（如 prompt-version）
}
```

---

## 五、PROJECT_CONTROL_CENTER.md 同步更新

完成后：

1. **第十节"前端对齐索引"** 更新：
   ```
   | 龙虾详情页 | GET /api/v1/lobsters/{id}/* | web/src/types/lobster.ts | /lobsters/[id] | ✅ EntityPage 升级 |
   ```

2. **第七节"已落地借鉴清单"** 增加：
   ```
   | Backstage | EntityPage 标签页设计（龙虾详情页升级）| ✅ | LobsterEntityPage, StatusCard, LifecycleBadge |
   ```

---

## 验收标准

- [ ] `/lobsters/[id]` 页面改为标签页架构（5个标签）
- [ ] `LobsterEntityHeader` 展示头像/名称/lifecycle徽章/状态/元信息
- [ ] `LifecycleBadge` 三种颜色正确（黄/绿/红）
- [ ] `StatusCard` 展示4个关键指标（本周执行/质量分/P95延迟/在线节点）
- [ ] Overview 标签展示技能列表 + 最近5次执行记录
- [ ] Skills 标签展示技能详情（含评分趋势）
- [ ] Runs 标签展示分页执行历史
- [ ] Knowledge 标签渲染龙虾 KB Markdown
- [ ] Config 标签展示 Prompt 版本 + Feature Flag 状态
- [ ] `web/src/types/lobster.ts` 增加 lifecycle/system/annotations 字段
- [ ] 后端 `/api/v1/lobsters/{id}/docs` 端点可用

---

*Codex Task | 来源：BACKSTAGE_BORROWING_ANALYSIS.md P1-#1 | 2026-04-02*
