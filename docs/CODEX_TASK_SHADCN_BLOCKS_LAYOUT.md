# CODEX TASK: shadcn/ui Blocks 布局骨架 — 侧边栏/监控看板/列表页统一框架

**优先级：P1**  
**来源借鉴：shadcn/ui blocks/（sidebar-10 / dashboard-01 / table-01）**  
**参考分析：`docs/SHADCN_UI_BORROWING_ANALYSIS.md` 第三节 3.1**

---

## 背景

shadcn/ui Blocks 提供完整的业务页面级布局模板。我们的 Operations Console 各页面布局不统一（有的用自定义侧边栏，有的用 flex 布局），整体视觉和交互体验缺乏一致性。

---

## 任务目标

参考 3 个 shadcn/ui Blocks 模板，统一重构 Operations Console 核心页面布局：
1. **侧边栏导航**：参考 sidebar-10（多级可折叠 + 图标）
2. **龙虾监控总览**：参考 dashboard-01（KPI 卡片 + 图表区 + 数据表）
3. **实体列表页框架**：参考 table-01（搜索 + 过滤 + 分页统一框架）

---

## 一、侧边栏统一（参考 sidebar-10）

### sidebar-10 结构：
```
┌────────────────────────────────────────────┐
│ [Logo]  OpenClaw              [折叠按钮 ▶] │
├────────────────────────────────────────────┤
│ 🦞 龙虾管理                               │
│   ├─ 所有龙虾                             │
│   ├─ 龙虾技能                             │
│   └─ 执行记录                             │
│ ⚙️ 工作流                                 │
│   ├─ 工作流列表                           │
│   └─ 工作流模板                           │
│ 📱 渠道账号                               │
│ 🖥️ 边缘节点                               │
├────────────────────────────────────────────┤
│ ── 运营管理 ──                            │
│ 📋 审计日志                               │
│ 🎚️ 功能开关                               │
│ 🏢 租户管理                               │
├────────────────────────────────────────────┤
│ [用户头像] 管理员        [设置] [注销]     │
└────────────────────────────────────────────┘
```

### 实现文件：

```typescript
// web/src/components/layout/AppSidebar.tsx

import {
  Sidebar, SidebarContent, SidebarFooter,
  SidebarGroup, SidebarGroupLabel, SidebarGroupContent,
  SidebarHeader, SidebarMenu, SidebarMenuButton,
  SidebarMenuItem, SidebarMenuSub, SidebarMenuSubItem,
  SidebarRail, SidebarTrigger,
} from '@/components/ui/sidebar';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

const NAV_ITEMS = [
  {
    label: '龙虾管理',
    icon: '🦞',
    children: [
      { label: '所有龙虾', href: '/lobsters' },
      { label: '龙虾技能', href: '/lobsters/skills' },
      { label: '执行记录', href: '/lobsters/runs' },
    ],
  },
  {
    label: '工作流',
    icon: '⚙️',
    children: [
      { label: '工作流列表', href: '/workflows' },
      { label: '工作流模板', href: '/workflows/templates' },
    ],
  },
  { label: '渠道账号', icon: '📱', href: '/channels' },
  { label: '边缘节点', icon: '🖥️', href: '/edge-nodes' },
];

const OPS_ITEMS = [
  { label: '审计日志', icon: '📋', href: '/operations/audit-log' },
  { label: '功能开关', icon: '🎚️', href: '/operations/feature-flags' },
  { label: '租户管理', icon: '🏢', href: '/operations/tenants' },
];

export function AppSidebar() {
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg">
              <span className="font-bold text-lg">🦞 OpenClaw</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      
      <SidebarContent>
        {/* 主导航 */}
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV_ITEMS.map(item => (
                item.children ? (
                  <Collapsible key={item.label} defaultOpen className="group/collapsible">
                    <SidebarMenuItem>
                      <CollapsibleTrigger asChild>
                        <SidebarMenuButton>
                          <span>{item.icon}</span>
                          <span>{item.label}</span>
                          <span className="ml-auto group-data-[state=open]/collapsible:rotate-90">›</span>
                        </SidebarMenuButton>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <SidebarMenuSub>
                          {item.children.map(child => (
                            <SidebarMenuSubItem key={child.href}>
                              <SidebarMenuButton asChild>
                                <a href={child.href}>{child.label}</a>
                              </SidebarMenuButton>
                            </SidebarMenuSubItem>
                          ))}
                        </SidebarMenuSub>
                      </CollapsibleContent>
                    </SidebarMenuItem>
                  </Collapsible>
                ) : (
                  <SidebarMenuItem key={item.label}>
                    <SidebarMenuButton asChild>
                      <a href={item.href}>
                        <span>{item.icon}</span>
                        <span>{item.label}</span>
                      </a>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        
        {/* 运营管理 */}
        <SidebarGroup>
          <SidebarGroupLabel>运营管理</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {OPS_ITEMS.map(item => (
                <SidebarMenuItem key={item.label}>
                  <SidebarMenuButton asChild>
                    <a href={item.href}>
                      <span>{item.icon}</span>
                      <span>{item.label}</span>
                    </a>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      
      <SidebarFooter>
        {/* 用户信息 + 设置 */}
        <UserFooter />
      </SidebarFooter>
      
      <SidebarRail />
    </Sidebar>
  );
}
```

### 根布局集成：

```typescript
// web/src/app/layout.tsx
import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';

export default function RootLayout({ children }) {
  return (
    <SidebarProvider>
      <AppSidebar />
      <main className="flex flex-1 flex-col overflow-hidden">
        <header className="border-b px-4 py-2 flex items-center gap-2">
          <SidebarTrigger />
          {/* 面包屑 + 全局搜索（GlobalSearch Cmd+K）*/}
          <GlobalSearch />
        </header>
        <div className="flex-1 overflow-y-auto">
          {children}
        </div>
      </main>
    </SidebarProvider>
  );
}
```

---

## 二、监控看板骨架（参考 dashboard-01）

```typescript
// web/src/app/dashboard/page.tsx
// 参考 dashboard-01 布局

export default function DashboardPage() {
  return (
    <div className="flex flex-1 flex-col gap-4 p-4">
      {/* 第一行：KPI 卡片（4个）*/}
      <div className="grid grid-cols-4 gap-4">
        <StatusCard title="今日执行" value="1,284" trend="up" subtitle="较昨日 +8%" />
        <StatusCard title="平均质量分" value="8.3" subtitle="满分 10 分" />
        <StatusCard title="在线龙虾" value="9/9" subtitle="全部在线" />
        <StatusCard title="在线边缘节点" value="3" subtitle="正常" />
      </div>
      
      {/* 第二行：图表区 */}
      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2">
          <ExecutionTrendChart />  {/* AreaChart：7天执行量趋势 */}
        </div>
        <div>
          <LobsterDistributionChart />  {/* PieChart：各龙虾执行占比 */}
        </div>
      </div>
      
      {/* 第三行：最近执行记录表格 */}
      <RecentRunsTable />
    </div>
  );
}
```

---

## 三、列表页统一框架（参考 table-01）

```typescript
// web/src/components/layout/EntityListPage.tsx
// 通用列表页框架，所有列表页复用

interface EntityListPageProps<T> {
  title: string;
  description?: string;
  searchPlaceholder?: string;
  columns: ColumnDef<T>[];
  data: T[];
  total: number;
  loading?: boolean;
  filters?: FilterConfig[];
  primaryAction?: React.ReactNode;
}

export function EntityListPage<T>({
  title, description, searchPlaceholder,
  columns, data, total, loading,
  filters, primaryAction
}: EntityListPageProps<T>) {
  return (
    <div className="flex flex-col gap-4 p-4">
      {/* 页头 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{title}</h1>
          {description && <p className="text-muted-foreground text-sm">{description}</p>}
        </div>
        {primaryAction}
      </div>
      
      {/* 搜索 + 过滤栏 */}
      <div className="flex items-center gap-2">
        <Input placeholder={searchPlaceholder ?? '搜索...'} className="max-w-sm" />
        {filters?.map(f => <FilterDropdown key={f.key} config={f} />)}
        <div className="ml-auto">
          <DataTableViewOptions />
        </div>
      </div>
      
      {/* 数据表格（TanStack Table）*/}
      <DataTable columns={columns} data={data} loading={loading} />
      
      {/* 分页 */}
      <DataTablePagination total={total} />
    </div>
  );
}

// 使用示例（龙虾列表页）：
// <EntityListPage
//   title="龙虾管理"
//   description="管理所有 AI 龙虾的配置、技能和执行状态"
//   columns={lobsterColumns}
//   data={lobsters}
//   total={total}
//   primaryAction={<Button>+ 新增龙虾</Button>}
// />
```

---

## 四、需要安装的依赖

```bash
# shadcn/ui sidebar 组件（如尚未安装）
npx shadcn@latest add sidebar

# TanStack Table（DataTable 依赖）
npm install @tanstack/react-table
```

---

## 五、PROJECT_CONTROL_CENTER.md 同步

完成后更新第七节"已落地借鉴清单"：
```
| shadcn/ui | Blocks 布局骨架（AppSidebar/DashboardPage/EntityListPage）| ✅ | AppSidebar.tsx, EntityListPage.tsx |
```

---

## 验收标准

- [ ] `AppSidebar.tsx` 实现多级可折叠侧边栏（主导航 + 运营管理分组）
- [ ] `SidebarProvider` 集成到根布局（`app/layout.tsx`）
- [ ] 折叠按钮（`SidebarTrigger`）在顶部导航栏正常显示
- [ ] `SidebarRail`：hover 侧边栏边缘可展开
- [ ] `EntityListPage` 通用列表页框架（搜索+过滤+表格+分页）
- [ ] 龙虾列表页、工作流列表页、渠道列表页均使用 `EntityListPage`
- [ ] 监控看板页（`/dashboard`）使用 dashboard-01 骨架（4 KPI + 图表 + 表格）
- [ ] 所有页面侧边栏高亮当前路由

---

*Codex Task | 来源：SHADCN_UI_BORROWING_ANALYSIS.md P1-#1 | 2026-04-02*
