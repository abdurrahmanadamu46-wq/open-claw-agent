# CODEX TASK: 统一运营控制台框架
> 优先级：P0 | 来源：chakra-ui recipes + boxyhq pages/teams + open-saas admin/
> 目标：把 operations/* 所有页面统一成一套"运营工作台框架"，消除页面堆叠感

---

## 任务背景

当前问题：
- skills/scheduler/memory/sessions/channels/monitor 各页面结构不一致
- 没有统一的 PageHeader / FilterBar / EmptyState / LoadingState / ErrorState
- 搜索、筛选、排序各自实现，难以维护
- 没有统一的 Right Rail（详情面板）模式

来源借鉴：
- chakra-ui `packages/react/src/components/` 中的 table/drawer/dialog/action-bar
- boxyhq `components/team/` 的列表+操作+详情模式
- open-saas `src/admin/dashboards/` 的统计卡片布局

---

## 目标产物

```
src/design-system/console/
├── PageHeader.tsx          ← 页面标题 + 描述 + 主操作
├── FilterBar.tsx           ← 搜索 + 过滤器 + 排序 + 批量操作
├── ConsoleLayout.tsx       ← 整体布局容器（含 Right Rail 支持）
├── EmptyState.tsx          ← 统一空状态（带 icon/title/description/action）
├── LoadingState.tsx        ← 统一加载态（Skeleton 列表）
├── ErrorState.tsx          ← 统一错误态（带重试按钮）
├── StatusBadge.tsx         ← 龙虾/任务状态徽章
├── MetricCard.tsx          ← 数据统计卡片
├── ActivityFeed.tsx        ← 活动流（审计/事件/历史）
└── index.ts
```

---

## 实现规范

### 1. PageHeader.tsx

```tsx
// src/design-system/console/PageHeader.tsx
import React from 'react';

interface PageHeaderProps {
  title: string;
  description?: string;
  /** 右上角主操作（如"新建任务"按钮） */
  primaryAction?: React.ReactNode;
  /** 面包屑（可选） */
  breadcrumb?: Array<{ label: string; href?: string }>;
  /** 右上角额外操作（如导出、刷新） */
  secondaryActions?: React.ReactNode;
}

export function PageHeader({
  title, description, primaryAction, breadcrumb, secondaryActions,
}: PageHeaderProps) {
  return (
    <div className="flex items-start justify-between pb-6 border-b border-[var(--ds-color-border-default)]">
      <div className="flex-1 min-w-0">
        {breadcrumb && breadcrumb.length > 0 && (
          <nav className="flex items-center gap-1 text-sm text-[var(--ds-color-text-muted)] mb-2">
            {breadcrumb.map((item, i) => (
              <React.Fragment key={i}>
                {i > 0 && <span>/</span>}
                {item.href
                  ? <a href={item.href} className="hover:text-[var(--ds-color-text-primary)]">{item.label}</a>
                  : <span>{item.label}</span>
                }
              </React.Fragment>
            ))}
          </nav>
        )}
        <h1 className="text-2xl font-semibold text-[var(--ds-color-text-primary)] truncate">
          {title}
        </h1>
        {description && (
          <p className="mt-1 text-sm text-[var(--ds-color-text-secondary)]">
            {description}
          </p>
        )}
      </div>
      {(primaryAction || secondaryActions) && (
        <div className="flex items-center gap-2 ml-4 flex-shrink-0">
          {secondaryActions}
          {primaryAction}
        </div>
      )}
    </div>
  );
}
```

### 2. FilterBar.tsx

```tsx
// src/design-system/console/FilterBar.tsx
interface FilterOption {
  label: string;
  value: string;
}

interface FilterBarProps {
  /** 搜索框 placeholder */
  searchPlaceholder?: string;
  onSearch?: (query: string) => void;
  /** 过滤器配置 */
  filters?: Array<{
    key: string;
    label: string;
    options: FilterOption[];
    value?: string;
    onChange?: (value: string) => void;
  }>;
  /** 排序配置 */
  sortOptions?: Array<{ label: string; value: string }>;
  onSort?: (value: string) => void;
  /** 已选中数量（显示批量操作栏） */
  selectedCount?: number;
  bulkActions?: React.ReactNode;
}

export function FilterBar({
  searchPlaceholder = '搜索...',
  onSearch, filters = [], sortOptions = [], onSort,
  selectedCount = 0, bulkActions,
}: FilterBarProps) {
  const [query, setQuery] = React.useState('');

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
    onSearch?.(e.target.value);
  };

  // 有选中时显示批量操作栏
  if (selectedCount > 0) {
    return (
      <div className="flex items-center gap-3 py-3 px-4 bg-[var(--ds-color-surface-selected)]
                      border border-[var(--ds-color-border-focus)] rounded-lg">
        <span className="text-sm font-medium text-[var(--ds-color-brand-default)]">
          已选 {selectedCount} 项
        </span>
        <div className="flex-1" />
        {bulkActions}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 flex-wrap">
      {/* 搜索框 */}
      <div className="relative flex-1 min-w-[200px]">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ds-color-text-muted)]">
          🔍
        </span>
        <input
          type="text"
          value={query}
          onChange={handleSearch}
          placeholder={searchPlaceholder}
          className="w-full pl-9 pr-3 py-2 text-sm border border-[var(--ds-color-border-default)]
                     rounded-lg bg-[var(--ds-color-surface-card)]
                     focus:outline-none focus:border-[var(--ds-color-border-focus)]"
        />
      </div>

      {/* 过滤器 */}
      {filters.map((filter) => (
        <select
          key={filter.key}
          value={filter.value || ''}
          onChange={(e) => filter.onChange?.(e.target.value)}
          className="px-3 py-2 text-sm border border-[var(--ds-color-border-default)]
                     rounded-lg bg-[var(--ds-color-surface-card)] text-[var(--ds-color-text-primary)]"
        >
          <option value="">{filter.label}</option>
          {filter.options.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      ))}

      {/* 排序 */}
      {sortOptions.length > 0 && (
        <select
          onChange={(e) => onSort?.(e.target.value)}
          className="px-3 py-2 text-sm border border-[var(--ds-color-border-default)]
                     rounded-lg bg-[var(--ds-color-surface-card)]"
        >
          {sortOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      )}
    </div>
  );
}
```

### 3. StatusBadge.tsx

```tsx
// src/design-system/console/StatusBadge.tsx
// 龙虾/任务/账号/边缘节点状态统一显示

type Status =
  | 'running' | 'completed' | 'failed' | 'paused'
  | 'pending' | 'backgrounded' | 'cancelled'
  | 'online' | 'offline' | 'active' | 'inactive';

const STATUS_CONFIG: Record<Status, {
  label: string;
  dot: string;
  className: string;
}> = {
  running:      { label: '运行中', dot: 'bg-blue-500 animate-pulse', className: 'bg-[var(--ds-color-status-running-bg)] text-[var(--ds-color-status-running-text)]' },
  completed:    { label: '已完成', dot: 'bg-green-500',  className: 'bg-[var(--ds-color-status-done-bg)] text-[var(--ds-color-status-done-text)]' },
  failed:       { label: '失败',   dot: 'bg-red-500',    className: 'bg-[var(--ds-color-status-failed-bg)] text-[var(--ds-color-status-failed-text)]' },
  paused:       { label: '已暂停', dot: 'bg-amber-500',  className: 'bg-[var(--ds-color-status-paused-bg)] text-[var(--ds-color-status-paused-text)]' },
  pending:      { label: '等待中', dot: 'bg-gray-400',   className: 'bg-[var(--ds-color-status-pending-bg)] text-[var(--ds-color-status-pending-text)]' },
  backgrounded: { label: '后台',   dot: 'bg-brand-500',  className: 'bg-blue-50 text-blue-700' },
  cancelled:    { label: '已取消', dot: 'bg-gray-400',   className: 'bg-gray-100 text-gray-500' },
  online:       { label: '在线',   dot: 'bg-green-500',  className: 'bg-green-50 text-green-700' },
  offline:      { label: '离线',   dot: 'bg-gray-400',   className: 'bg-gray-100 text-gray-500' },
  active:       { label: '活跃',   dot: 'bg-green-500',  className: 'bg-green-50 text-green-700' },
  inactive:     { label: '未激活', dot: 'bg-gray-300',   className: 'bg-gray-50 text-gray-500' },
};

interface StatusBadgeProps {
  status: Status;
  showDot?: boolean;
  size?: 'sm' | 'md';
}

export function StatusBadge({ status, showDot = true, size = 'md' }: StatusBadgeProps) {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending;
  const sizeClass = size === 'sm' ? 'text-xs px-1.5 py-0.5' : 'text-sm px-2.5 py-1';

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full font-medium ${sizeClass} ${config.className}`}>
      {showDot && <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${config.dot}`} />}
      {config.label}
    </span>
  );
}
```

### 4. EmptyState.tsx

```tsx
// src/design-system/console/EmptyState.tsx
interface EmptyStateProps {
  icon?: string;          // emoji 或图标
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export function EmptyState({ icon = '📭', title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="text-4xl mb-4">{icon}</div>
      <h3 className="text-lg font-semibold text-[var(--ds-color-text-primary)] mb-2">{title}</h3>
      {description && (
        <p className="text-sm text-[var(--ds-color-text-secondary)] max-w-sm mb-6">{description}</p>
      )}
      {action}
    </div>
  );
}
```

### 5. MetricCard.tsx

```tsx
// src/design-system/console/MetricCard.tsx
interface MetricCardProps {
  label: string;
  value: string | number;
  trend?: { value: number; label: string };  // +12% vs 昨日
  icon?: string;
  description?: string;
  loading?: boolean;
}

export function MetricCard({ label, value, trend, icon, description, loading }: MetricCardProps) {
  if (loading) {
    return (
      <div className="bg-[var(--ds-color-surface-card)] border border-[var(--ds-color-border-default)]
                      rounded-xl p-5 animate-pulse">
        <div className="h-4 bg-gray-200 rounded w-24 mb-3" />
        <div className="h-8 bg-gray-200 rounded w-16" />
      </div>
    );
  }

  const trendPositive = (trend?.value ?? 0) >= 0;

  return (
    <div className="bg-[var(--ds-color-surface-card)] border border-[var(--ds-color-border-default)]
                    rounded-xl p-5 hover:shadow-sm transition-shadow">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-medium text-[var(--ds-color-text-secondary)]">{label}</span>
        {icon && <span className="text-xl">{icon}</span>}
      </div>
      <div className="flex items-end gap-3">
        <span className="text-3xl font-bold text-[var(--ds-color-text-primary)]">{value}</span>
        {trend && (
          <span className={`text-sm font-medium mb-1 ${trendPositive ? 'text-green-600' : 'text-red-600'}`}>
            {trendPositive ? '↑' : '↓'} {Math.abs(trend.value)}% {trend.label}
          </span>
        )}
      </div>
      {description && (
        <p className="mt-2 text-xs text-[var(--ds-color-text-muted)]">{description}</p>
      )}
    </div>
  );
}
```

### 6. ConsoleLayout.tsx — 核心布局容器

```tsx
// src/design-system/console/ConsoleLayout.tsx
// 整体控制台布局，支持可选 Right Rail（详情面板）

interface ConsoleLayoutProps {
  header: React.ReactNode;           // PageHeader
  filterBar?: React.ReactNode;       // FilterBar
  metricRow?: React.ReactNode;       // MetricCard 行
  children: React.ReactNode;         // 主内容（table/grid）
  rightRail?: React.ReactNode;       // 详情面板（可选）
  rightRailTitle?: string;
  onCloseRightRail?: () => void;
  loading?: boolean;
  error?: string | null;
  empty?: boolean;
  emptyState?: React.ReactNode;
}

export function ConsoleLayout({
  header, filterBar, metricRow, children,
  rightRail, rightRailTitle, onCloseRightRail,
  loading, error, empty, emptyState,
}: ConsoleLayoutProps) {
  return (
    <div className="flex h-full min-h-screen bg-[var(--ds-color-surface-page)]">
      {/* 主区域 */}
      <div className={`flex-1 flex flex-col min-w-0 ${rightRail ? 'max-w-[calc(100%-400px)]' : ''}`}>
        {/* Header */}
        <div className="px-6 pt-6">{header}</div>

        {/* Metric Row */}
        {metricRow && (
          <div className="px-6 pt-5">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">{metricRow}</div>
          </div>
        )}

        {/* Filter Bar */}
        {filterBar && (
          <div className="px-6 pt-4 pb-2">{filterBar}</div>
        )}

        {/* Main Content */}
        <div className="flex-1 px-6 py-4 overflow-auto">
          {loading ? (
            <LoadingState />
          ) : error ? (
            <ErrorState message={error} />
          ) : empty ? (
            emptyState ?? <EmptyState title="暂无数据" description="尝试调整过滤条件或新建记录" />
          ) : children}
        </div>
      </div>

      {/* Right Rail */}
      {rightRail && (
        <div className="w-[400px] flex-shrink-0 border-l border-[var(--ds-color-border-default)]
                        bg-[var(--ds-color-surface-card)] flex flex-col">
          <div className="flex items-center justify-between px-4 py-3
                          border-b border-[var(--ds-color-border-default)]">
            <span className="font-medium text-[var(--ds-color-text-primary)]">
              {rightRailTitle ?? '详情'}
            </span>
            <button
              onClick={onCloseRightRail}
              className="text-[var(--ds-color-text-muted)] hover:text-[var(--ds-color-text-primary)]"
            >
              ✕
            </button>
          </div>
          <div className="flex-1 overflow-auto p-4">{rightRail}</div>
        </div>
      )}
    </div>
  );
}

// ── 内嵌辅助组件 ────────────────────────────────────────────────────

function LoadingState() {
  return (
    <div className="space-y-3 animate-pulse">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-14 bg-gray-100 rounded-lg" />
      ))}
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="text-4xl mb-4">⚠️</div>
      <h3 className="text-lg font-semibold text-[var(--ds-color-text-primary)] mb-2">加载失败</h3>
      <p className="text-sm text-[var(--ds-color-text-secondary)] mb-4">{message}</p>
      <button
        onClick={() => window.location.reload()}
        className="px-4 py-2 text-sm bg-[var(--ds-color-brand-default)] text-white rounded-lg hover:opacity-90"
      >
        重试
      </button>
    </div>
  );
}
```

---

## 使用示例 — Lobsters 页面

```tsx
// src/pages/operations/lobsters.tsx
import { ConsoleLayout, PageHeader, FilterBar, StatusBadge, MetricCard } from '@/design-system/console';

export default function LobstersPage() {
  const [selectedRail, setSelectedRail] = useState<string | null>(null);

  return (
    <ConsoleLayout
      header={
        <PageHeader
          title="龙虾管理"
          description="管理所有 AI 龙虾助手及其任务"
          breadcrumb={[{ label: '运营', href: '/operations' }, { label: '龙虾管理' }]}
          primaryAction={<button className="btn-primary">新建任务</button>}
        />
      }
      metricRow={
        <>
          <MetricCard label="在线龙虾" value={9} icon="🦞" />
          <MetricCard label="今日任务" value={42} trend={{ value: 12, label: 'vs 昨日' }} icon="📋" />
          <MetricCard label="成功率" value="94%" trend={{ value: 3, label: 'vs 上周' }} icon="✅" />
          <MetricCard label="今日消耗" value="12万" description="Token 用量" icon="🔢" />
        </>
      }
      filterBar={
        <FilterBar
          searchPlaceholder="搜索龙虾..."
          filters={[
            { key: 'status', label: '状态', options: [
              { label: '运行中', value: 'running' },
              { label: '已完成', value: 'completed' },
              { label: '失败', value: 'failed' },
            ]},
          ]}
        />
      }
      rightRail={selectedRail ? <LobsterDetail id={selectedRail} /> : undefined}
      onCloseRightRail={() => setSelectedRail(null)}
    >
      <LobsterTable onSelectRow={setSelectedRail} />
    </ConsoleLayout>
  );
}
```

---

## 验收标准

- [ ] `src/design-system/console/` 目录下所有组件创建完毕
- [ ] PageHeader 在所有 operations/* 页面统一使用
- [ ] FilterBar 替换现有各自实现的搜索/筛选
- [ ] StatusBadge 覆盖所有状态显示场景（龙虾/任务/账号/边缘节点）
- [ ] EmptyState / LoadingState / ErrorState 统一替换
- [ ] MetricCard 在 Dashboard、Lobsters、Analytics 页使用
- [ ] Right Rail 模式在 Lobsters / Edges 页面实现
- [ ] 所有组件支持 dark mode（通过 CSS variable）

---

## 参考文件

- `f:/openclaw-agent/docs/CODEX_TASK_DESIGN_TOKEN_SYSTEM.md`
- `f:/openclaw-agent/docs/OPENSAAS_ECOSYSTEM_BORROWING_ANALYSIS.md` 第三章
- chakra-ui: `packages/react/src/components/action-bar/`
- chakra-ui: `packages/react/src/components/table/`
- boxyhq: `components/team/`
