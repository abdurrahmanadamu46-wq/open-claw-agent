# CODEX TASK: shadcn/ui Charts 图表组件库 — 龙虾监控可视化

**优先级：P1**  
**来源借鉴：shadcn/ui charts/（Recharts 封装，主题感知图表）**  
**参考分析：`docs/SHADCN_UI_BORROWING_ANALYSIS.md` 第三节 3.1**

---

## 背景

Operations Console 目前缺少统一的图表组件，龙虾监控/执行趋势/质量评分等关键数据无法可视化展示。shadcn/ui Charts 基于 Recharts，自动继承 CSS 变量颜色，暗黑模式自动切换，Tooltip/Legend 样式统一。

---

## 任务目标

建立统一图表组件库，覆盖5个核心业务场景：
1. 执行量趋势（AreaChart）
2. 质量评分趋势（LineChart）  
3. 龙虾能力雷达图（RadarChart）★独特价值
4. 各龙虾执行量对比（BarChart）
5. 渠道平台分布（PieChart）

同时附带 DataTable（TanStack Table）统一实现。

---

## 一、安装依赖

```bash
npm install recharts
npx shadcn@latest add chart
```

---

## 二、图表组件实现

### 2.1 执行量趋势（`ExecutionTrendChart.tsx`）

```typescript
// web/src/components/charts/ExecutionTrendChart.tsx
'use client';

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import {
  ChartContainer, ChartTooltip, ChartTooltipContent, ChartLegend,
  type ChartConfig,
} from '@/components/ui/chart';

const chartConfig = {
  runs: { label: '执行次数', color: 'hsl(var(--chart-1))' },
  success: { label: '成功', color: 'hsl(var(--chart-2))' },
} satisfies ChartConfig;

interface ExecutionTrendChartProps {
  data: Array<{ date: string; runs: number; success: number }>;
  timeRange?: '7d' | '30d' | '90d';
}

export function ExecutionTrendChart({ data, timeRange = '7d' }: ExecutionTrendChartProps) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-semibold">执行量趋势</h3>
          <p className="text-sm text-muted-foreground">过去 {timeRange === '7d' ? '7天' : timeRange === '30d' ? '30天' : '90天'}</p>
        </div>
        {/* 时间范围切换 */}
        <TimeRangeToggle value={timeRange} />
      </div>
      <ChartContainer config={chartConfig} className="h-[200px] w-full">
        <AreaChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
          <XAxis dataKey="date" tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
          <YAxis tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
          <ChartTooltip content={<ChartTooltipContent />} />
          <Area
            type="monotone"
            dataKey="runs"
            stroke="var(--color-runs)"
            fill="var(--color-runs)"
            fillOpacity={0.15}
            strokeWidth={2}
          />
          <Area
            type="monotone"
            dataKey="success"
            stroke="var(--color-success)"
            fill="var(--color-success)"
            fillOpacity={0.1}
            strokeWidth={2}
          />
        </AreaChart>
      </ChartContainer>
    </div>
  );
}
```

### 2.2 质量评分趋势（`QualityScoreChart.tsx`）

```typescript
// web/src/components/charts/QualityScoreChart.tsx

import { Line, LineChart, CartesianGrid, XAxis, YAxis, ReferenceLine } from 'recharts';

const chartConfig = {
  score: { label: '质量评分', color: 'hsl(var(--chart-1))' },
} satisfies ChartConfig;

interface QualityScoreChartProps {
  data: Array<{ date: string; score: number }>;
  lobsterName?: string;
  threshold?: number;  // 质量红线（默认 7.0）
}

export function QualityScoreChart({ data, lobsterName, threshold = 7.0 }: QualityScoreChartProps) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <h3 className="font-semibold mb-1">质量评分趋势{lobsterName ? ` · ${lobsterName}` : ''}</h3>
      <ChartContainer config={chartConfig} className="h-[160px] w-full">
        <LineChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
          <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
          <YAxis domain={[0, 10]} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
          <ChartTooltip content={<ChartTooltipContent />} />
          {/* 质量红线 */}
          <ReferenceLine
            y={threshold}
            stroke="hsl(var(--destructive))"
            strokeDasharray="4 4"
            label={{ value: `红线 ${threshold}`, position: 'right', fontSize: 11 }}
          />
          <Line
            type="monotone"
            dataKey="score"
            stroke="var(--color-score)"
            strokeWidth={2}
            dot={{ r: 3 }}
            activeDot={{ r: 5 }}
          />
        </LineChart>
      </ChartContainer>
    </div>
  );
}
```

### 2.3 龙虾能力雷达图（`LobsterRadarChart.tsx`）★ 差异化

```typescript
// web/src/components/charts/LobsterRadarChart.tsx
// 用于龙虾详情 Skills 标签：展示各技能维度评分

import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis } from 'recharts';

const chartConfig = {
  score: { label: '当前评分', color: 'hsl(var(--chart-1))' },
  target: { label: '目标评分', color: 'hsl(var(--chart-2))' },
} satisfies ChartConfig;

interface LobsterRadarChartProps {
  skills: Array<{
    skill_name: string;      // "竞品监控"
    score: number;           // 当前评分 0-10
    target: number;          // 目标评分 0-10
  }>;
}

export function LobsterRadarChart({ skills }: LobsterRadarChartProps) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <h3 className="font-semibold mb-3">技能雷达图</h3>
      <ChartContainer config={chartConfig} className="h-[280px] w-full">
        <RadarChart data={skills} cx="50%" cy="50%" outerRadius="70%">
          <PolarGrid className="stroke-muted" />
          <PolarAngleAxis dataKey="skill_name" tick={{ fontSize: 12 }} />
          <PolarRadiusAxis angle={90} domain={[0, 10]} tick={{ fontSize: 10 }} />
          <ChartTooltip content={<ChartTooltipContent />} />
          <Radar
            name="当前评分"
            dataKey="score"
            stroke="var(--color-score)"
            fill="var(--color-score)"
            fillOpacity={0.3}
          />
          <Radar
            name="目标评分"
            dataKey="target"
            stroke="var(--color-target)"
            fill="var(--color-target)"
            fillOpacity={0.1}
            strokeDasharray="4 4"
          />
          <ChartLegend />
        </RadarChart>
      </ChartContainer>
    </div>
  );
}
```

### 2.4 龙虾执行量对比（`LobsterBarChart.tsx`）

```typescript
// web/src/components/charts/LobsterBarChart.tsx

import { Bar, BarChart, CartesianGrid, XAxis, YAxis, Cell } from 'recharts';

const LOBSTER_COLORS = [
  'hsl(var(--chart-1))', 'hsl(var(--chart-2))', 'hsl(var(--chart-3))',
  'hsl(var(--chart-4))', 'hsl(var(--chart-5))',
];

interface LobsterBarChartProps {
  data: Array<{ name: string; display_name: string; runs: number }>;
}

export function LobsterBarChart({ data }: LobsterBarChartProps) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <h3 className="font-semibold mb-3">各龙虾执行量（本周）</h3>
      <ChartContainer config={{}} className="h-[200px] w-full">
        <BarChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 20 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
          <XAxis
            dataKey="display_name"
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            angle={-30}
            textAnchor="end"
          />
          <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
          <ChartTooltip
            content={<ChartTooltipContent labelKey="display_name" />}
          />
          <Bar dataKey="runs" radius={[4, 4, 0, 0]}>
            {data.map((_, index) => (
              <Cell key={index} fill={LOBSTER_COLORS[index % LOBSTER_COLORS.length]} />
            ))}
          </Bar>
        </BarChart>
      </ChartContainer>
    </div>
  );
}
```

### 2.5 渠道平台分布（`ChannelPieChart.tsx`）

```typescript
// web/src/components/charts/ChannelPieChart.tsx

import { Pie, PieChart, Cell } from 'recharts';

interface ChannelPieChartProps {
  data: Array<{ platform: string; count: number; percentage: number }>;
}

export function ChannelPieChart({ data }: ChannelPieChartProps) {
  const chartConfig = Object.fromEntries(
    data.map((d, i) => [d.platform, { label: d.platform, color: `hsl(var(--chart-${i + 1}))` }])
  );
  
  return (
    <div className="rounded-lg border bg-card p-4">
      <h3 className="font-semibold mb-3">渠道平台分布</h3>
      <ChartContainer config={chartConfig} className="h-[180px] w-full">
        <PieChart>
          <ChartTooltip content={<ChartTooltipContent hideLabel />} />
          <Pie
            data={data}
            dataKey="count"
            nameKey="platform"
            cx="50%"
            cy="50%"
            innerRadius={50}
            outerRadius={75}
            paddingAngle={2}
          >
            {data.map((entry, index) => (
              <Cell key={entry.platform} fill={`hsl(var(--chart-${index + 1}))`} />
            ))}
          </Pie>
          <ChartLegend
            content={({ payload }) => (
              <div className="flex flex-wrap gap-2 justify-center mt-2">
                {payload?.map(p => (
                  <span key={p.value} className="flex items-center gap-1 text-xs">
                    <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
                    {p.value}
                  </span>
                ))}
              </div>
            )}
          />
        </PieChart>
      </ChartContainer>
    </div>
  );
}
```

---

## 三、DataTable（TanStack Table 统一实现）

```typescript
// web/src/components/data-table/DataTable.tsx

import {
  useReactTable, getCoreRowModel, getSortedRowModel,
  getFilteredRowModel, getPaginationRowModel,
  flexRender, type ColumnDef, type SortingState,
} from '@tanstack/react-table';
import {
  Table, TableBody, TableCell, TableHead,
  TableHeader, TableRow,
} from '@/components/ui/table';

interface DataTableProps<T> {
  columns: ColumnDef<T>[];
  data: T[];
  loading?: boolean;
  onRowClick?: (row: T) => void;
}

export function DataTable<T>({ columns, data, loading, onRowClick }: DataTableProps<T>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState([]);
  
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    state: { sorting, columnFilters },
    initialState: { pagination: { pageSize: 20 } },
  });
  
  if (loading) return <DataTableSkeleton />;
  
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map(headerGroup => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map(header => (
                <TableHead key={header.id}>
                  {header.isPlaceholder ? null : (
                    <div
                      className={header.column.getCanSort() ? 'cursor-pointer select-none flex items-center gap-1' : ''}
                      onClick={header.column.getToggleSortingHandler()}
                    >
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      {header.column.getIsSorted() === 'asc' && ' ↑'}
                      {header.column.getIsSorted() === 'desc' && ' ↓'}
                    </div>
                  )}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.length ? (
            table.getRowModel().rows.map(row => (
              <TableRow
                key={row.id}
                onClick={() => onRowClick?.(row.original)}
                className={onRowClick ? 'cursor-pointer hover:bg-muted/50' : ''}
              >
                {row.getVisibleCells().map(cell => (
                  <TableCell key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell colSpan={columns.length} className="h-24 text-center text-muted-foreground">
                暂无数据
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
```

---

## 四、图表使用索引

| 图表 | 组件 | 使用场景 |
|-----|-----|---------|
| AreaChart | `ExecutionTrendChart` | 监控看板 + 龙虾详情 Overview |
| LineChart | `QualityScoreChart` | 龙虾详情 Overview + Skills 标签 |
| RadarChart | `LobsterRadarChart` | 龙虾详情 Skills 标签（★独特）|
| BarChart | `LobsterBarChart` | 监控看板（各龙虾对比）|
| PieChart | `ChannelPieChart` | 渠道账号分析页 |

---

## 五、后端 API（图表数据端点）

```
GET /api/v1/stats/execution-trend?range=7d&lobster_id=all
  → [{ date, runs, success }]

GET /api/v1/stats/quality-trend?lobster_id=xxx&range=30d
  → [{ date, score }]

GET /api/v1/lobsters/{id}/skills/scores
  → [{ skill_name, score, target }]  ← 雷达图数据

GET /api/v1/stats/lobster-distribution?range=7d
  → [{ name, display_name, runs }]

GET /api/v1/stats/channel-distribution
  → [{ platform, count, percentage }]
```

---

## 验收标准

- [ ] `recharts` 和 shadcn/ui chart 组件安装完成
- [ ] `ExecutionTrendChart` 在监控看板展示 7/30/90 天切换
- [ ] `QualityScoreChart` 展示质量红线（ReferenceLine）
- [ ] `LobsterRadarChart` 在龙虾详情 Skills 标签展示（含目标评分虚线）
- [ ] `LobsterBarChart` 各龙虾不同颜色
- [ ] `ChannelPieChart` 甜甜圈样式（innerRadius）
- [ ] 所有图表暗黑模式自动适配（CSS 变量颜色）
- [ ] `DataTable` 支持排序/过滤/分页/行点击
- [ ] 龙虾列表页使用 DataTable + ColumnDef
- [ ] 后端5个图表数据 API 可用

---

*Codex Task | 来源：SHADCN_UI_BORROWING_ANALYSIS.md P1-#2 | 2026-04-02*
