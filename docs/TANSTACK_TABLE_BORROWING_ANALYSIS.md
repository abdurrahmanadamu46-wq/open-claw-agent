# TanStack Table 借鉴分析报告
## https://github.com/TanStack/table

**分析日期：2026-04-02**  
**规则：生成过 Codex Task 的任务默认已落地 | 我们更好的默认略过**  
**重要前置：`CODEX_TASK_SHADCN_CHARTS.md` 已包含 DataTable 基础实现（已落地）**

---

## 一、TanStack Table 项目定性

TanStack Table v8 是**框架无关的 Headless 数据表格引擎**，支持 React/Vue/Solid/Svelte。零 DOM 依赖，所有 UI 由消费者控制。GitHub 26k+ Star，Linear、Planetscale、Vercel 等均在用。

```
核心能力矩阵（v8）：
  ✦ 列定义（ColumnDef）：访问器/聚合/显示列
  ✦ 排序（Sorting）：单列/多列/自定义比较函数
  ✦ 过滤（Filtering）：全局过滤 + 列级过滤
  ✦ 分页（Pagination）：客户端/服务端
  ✦ 行选择（Row Selection）：单选/多选/全选
  ✦ 列可见性（Column Visibility）：显示/隐藏列
  ✦ 列固定（Column Pinning）：左固定/右固定
  ✦ 列大小调整（Column Resizing）：拖拽改变列宽
  ✦ 行分组（Grouping）：按列值分组
  ✦ 行展开（Expanding）：父子行/嵌套内容
  ✦ 虚拟化（Virtualizing）：配合 TanStack Virtual 渲染万行数据
  ✦ 服务端模式：manualSorting/manualFiltering/manualPagination
```

---

## 二、关键说明：DataTable 基础已落地

`CODEX_TASK_SHADCN_CHARTS.md` 已实现的 DataTable 功能（默认已落地）：
```
✅ 基础 ColumnDef + 排序 + 列过滤 + 分页 + 行点击
```

**本次聚焦 3 个真实能力缺口：**
1. **服务端模式**（manualPagination + manualSorting）— 大数据量审计日志/执行记录
2. **行展开（Expanding）**— 工作流步骤展开/龙虾执行详情展开
3. **批量行选择 + 批量操作工具栏**— 批量停用龙虾/批量删除工作流

---

## 三、逐层对比分析

### 3.1 前端（Operations Console）

#### ❌ 略过：基础排序/过滤/分页/列可见性
已在 CODEX_TASK_SHADCN_CHARTS.md DataTable 实现。

#### ❌ 略过：列大小调整（Column Resizing）
我们的表格列宽固定，无动态调整需求。

#### ❌ 略过：行分组（Grouping）
暂无数据分组展示需求。

#### ✅ 强烈借鉴：服务端模式（manualPagination + manualSorting）

**问题背景：**
```
审计日志：数量可能百万级
龙虾执行记录：每日数千条，30天累计数十万
渠道账号发布历史：持续增长

客户端分页（当前 DataTable）：
  一次拉取全量数据 → 内存占用大 → 首屏慢
  
服务端分页：
  每次只拉 20 条 → 快 → 按需加载
  排序/过滤在 DB 层执行 → 正确
```

**TanStack Table 服务端模式：**
```typescript
const table = useReactTable({
  data,
  columns,
  // 告诉 TanStack Table：排序/过滤/分页由外部控制
  manualPagination: true,
  manualSorting: true,
  manualFiltering: true,
  pageCount: Math.ceil(total / pageSize),  // 服务端总页数
  state: {
    pagination: { pageIndex, pageSize },
    sorting,
    columnFilters,
  },
  onPaginationChange: setPagination,
  onSortingChange: setSorting,
  onColumnFiltersChange: setColumnFilters,
  getCoreRowModel: getCoreRowModel(),
  // 不再用 getPaginationRowModel（客户端分页）
});

// 当 pagination/sorting/filters 变化时，触发 API 请求
useEffect(() => {
  fetchData({
    page: pageIndex + 1,
    page_size: pageSize,
    sort_by: sorting[0]?.id,
    sort_dir: sorting[0]?.desc ? 'desc' : 'asc',
    filters: columnFilters,
  });
}, [pageIndex, pageSize, sorting, columnFilters]);
```

**对我们的价值：**
```
升级以下页面的 DataTable 为服务端模式：
  - 审计日志页（/operations/audit-log）  ← 最重要
  - 龙虾执行记录页（/lobsters/runs）
  - 渠道发布历史（/channels/{id}/history）
  - LLM 调用记录（/operations/llm-logs）
```

**优先级：P1**（审计日志服务端分页是生产级 SaaS 的必须能力）

#### ✅ 强烈借鉴：行展开（Row Expanding）— 嵌套详情

**TanStack Table Expanding：**
```typescript
// ColumnDef 中添加展开列
const columns: ColumnDef<WorkflowRun>[] = [
  {
    id: 'expand',
    header: () => null,
    cell: ({ row }) =>
      row.getCanExpand() ? (
        <button onClick={row.getToggleExpandedHandler()}>
          {row.getIsExpanded() ? '▾' : '▸'}
        </button>
      ) : null,
  },
  // ... 其他列
];

const table = useReactTable({
  data,
  columns,
  getRowCanExpand: () => true,  // 所有行可展开
  getExpandedRowModel: getExpandedRowModel(),
  // 渲染展开内容
  renderSubComponent: ({ row }) => <RunDetailPanel run={row.original} />,
});

// 表格 Body 渲染展开行
{row.getIsExpanded() && (
  <TableRow>
    <TableCell colSpan={columns.length}>
      <RunDetailPanel run={row.original} />
    </TableCell>
  </TableRow>
)}
```

**对我们的价值：**
```
龙虾执行记录列表（展开行查看详情）：

  ┌─────────────────────────────────────────────────────┐
  │ ▸ │ 2026-04-02 14:32 │ voiceover_script │ ✅ │ 8.6 │
  ├─────────────────────────────────────────────────────┤
  │ ▾ │ 2026-04-02 14:28 │ product_desc     │ ✅ │ 8.2 │   ← 展开
  │   ┌───────────────────────────────────────────────┐ │
  │   │ 输入：[商品名] 蓝牙耳机 [目标人群] 年轻用户   │ │
  │   │ 输出：这款蓝牙耳机... (完整文案)               │ │
  │   │ 用时：1.2s │ Tokens：382 │ 模型：Claude-3.5   │ │
  │   │ 质量评分详情：流畅度 9 | 准确性 8 | 创意 8    │ │
  │   └───────────────────────────────────────────────┘ │
  │ ▸ │ 2026-04-02 14:15 │ social_copy      │ ❌ │ 超时 │
  └─────────────────────────────────────────────────────┘

工作流执行历史（展开查看步骤详情）：
  工作流运行记录 → 展开 → 每个步骤的执行状态/耗时/输出

审计日志（展开查看完整 diff）：
  LOBSTER_CONFIG_UPDATE → 展开 → 变更前/后的完整配置 diff
```

**优先级：P1**（审计日志和执行记录是运营核心页面）

#### ✅ 强烈借鉴：批量行选择 + 批量操作工具栏

**TanStack Table Row Selection：**
```typescript
const columns: ColumnDef<Lobster>[] = [
  {
    id: 'select',
    header: ({ table }) => (
      <Checkbox
        checked={table.getIsAllPageRowsSelected()}
        indeterminate={table.getIsSomePageRowsSelected()}
        onCheckedChange={table.toggleAllPageRowsSelected}
        aria-label="全选"
      />
    ),
    cell: ({ row }) => (
      <Checkbox
        checked={row.getIsSelected()}
        onCheckedChange={row.toggleSelected}
        aria-label={`选择行 ${row.index + 1}`}
      />
    ),
    enableSorting: false,
  },
  // ...
];

// 获取选中行
const selectedRows = table.getSelectedRowModel().rows.map(r => r.original);
```

**批量操作工具栏（选中时浮出）：**
```typescript
// 当有选中行时，表格顶部显示浮动工具栏
{selectedRows.length > 0 && (
  <div className="flex items-center gap-2 p-2 bg-primary/5 border rounded-md">
    <span className="text-sm font-medium">已选 {selectedRows.length} 项</span>
    <div className="ml-auto flex gap-2">
      <Button size="sm" variant="outline" onClick={handleBatchPause}>
        ⏸ 批量暂停
      </Button>
      <DangerActionGuard
        trigger={<Button size="sm" variant="destructive">🗑 批量删除</Button>}
        title={`批量删除 ${selectedRows.length} 个工作流`}
        description="所有选中的工作流将被永久删除，关联的定时任务将停止运行。"
        affectedCount={selectedRows.reduce((sum, r) => sum + r.schedule_count, 0)}
        affectedType="定时任务"
        confirmText="DELETE"
        onConfirm={handleBatchDelete}
      />
    </div>
  </div>
)}
```

**对我们的价值：**
```
工作流列表：批量暂停/批量恢复/批量删除
渠道账号列表：批量暂停发布/批量归档
边缘节点列表：批量断开/批量重连
```

**优先级：P1**（运营效率的关键能力，大量实体管理时必须）

#### ✅ 可借鉴：列固定（Column Pinning）— 宽表格操作列固定

**使用场景：**
```
执行记录表格列很多（时间/龙虾/技能/状态/质量分/Token数/耗时/操作）
横向滚动时"操作"列会消失，用户无法操作。

Column Pinning 固定"操作"列到右侧：
  即使横向滚动，"操作"列始终可见。
```

**TanStack Table Column Pinning：**
```typescript
const table = useReactTable({
  columnPinning: { right: ['actions'] },  // 固定操作列到右侧
  ...
});

// 获取固定列样式
const pinnedRight = header.column.getIsPinned() === 'right';
className={cn(
  pinnedRight && 'sticky right-0 bg-background border-l shadow-[-4px_0_8px_-4px_rgba(0,0,0,0.1)]'
)}
```

**优先级：P2**（执行记录/审计日志宽表格的体验优化）

#### ✅ 可借鉴：虚拟化（TanStack Virtual）— 万行数据流畅渲染

**使用场景：**
```
实时日志页（边缘节点日志流）：可能有数千行快速涌入
LLM 调用日志：密集监控场景

使用 @tanstack/react-virtual 配合 TanStack Table：
  只渲染可视区域的行
  其余行用占位符撑高度
  滚动时动态替换渲染内容
  即使 10000 行也流畅
```

**优先级：P2**（实时日志场景，非紧急）

---

### 3.2 云端大脑 + 9只龙虾

#### ❌ 略过：TanStack Table 无后端能力

---

### 3.3 L2.5 支撑微服务集群

#### ✅ 可借鉴：服务端 API 响应格式规范（配合 manualPagination）

TanStack Table 服务端模式要求后端返回统一的分页格式：

```json
{
  "data": [...],
  "total": 12456,
  "page": 1,
  "page_size": 20,
  "total_pages": 623
}
```

**对我们的价值：**
```
统一所有列表 API 的分页响应格式。
目前各 API 的分页格式不统一：
  有的返回 total / page / page_size
  有的返回 count / offset / limit
  有的没有返回 total_pages

建立统一的 PaginatedResponse 基础类：
  所有列表 API 都继承此格式
  前端 DataTable 服务端模式无缝对接
```

**优先级：P2**（API 规范，集成到现有 API 治理中）

#### ❌ 略过：TanStack Table 的其他后端能力

---

### 3.4 云边调度层 + 边缘层

#### ❌ 略过：TanStack Table 无云边概念

---

### 3.5 SaaS 系统整体

#### ❌ 略过：TanStack Table 无 SaaS 业务能力

---

## 四、对比总结

| 维度 | TanStack Table | 我们 | 胜负 | 行动 |
|-----|---------|------|------|------|
| 基础表格（排序/过滤/分页）| ✅ | ✅ CODEX_TASK_SHADCN_CHARTS 已落地 | **平** | 无 |
| **服务端分页/排序** | ✅ manualPagination | 仅客户端分页 | **TanStack 胜** | **P1** |
| **行展开（Expanding）** | ✅ 嵌套详情 | 无展开 | **TanStack 胜** | **P1** |
| **批量行选择 + 批量操作** | ✅ Row Selection | 无批量操作 | **TanStack 胜** | **P1** |
| 列固定（Pinning）| ✅ | 无 | **TanStack 胜** | P2 |
| 虚拟化（Virtual）| ✅ 10000行 | 无 | **TanStack 胜** | P2 |
| 后端/业务能力 | ❌ 无 | ✅ 完整 | **我们胜** | — |

---

## 五、借鉴清单

### P1 新建 Codex Task

| # | 借鉴点 | 落地场景 | 工时 |
|---|--------|---------|------|
| 1 | **DataTable 服务端模式**（manualPagination + sorting）| 审计日志/执行记录/LLM调用记录 | 1天 |
| 2 | **行展开（Expanding）**（嵌套详情面板）| 执行记录/工作流步骤/审计日志 diff | 1天 |
| 3 | **批量选择 + 批量操作工具栏** | 工作流/渠道账号/边缘节点批量操作 | 1天 |

### P2 集成到现有任务

| # | 借鉴点 | 集成到 |
|---|--------|---------|
| 4 | 列固定（右固定操作列）| DataTable 组件升级 |
| 5 | 虚拟化（实时日志）| 边缘节点日志页 |
| 6 | 统一分页响应格式 | API 治理规范 |

---

*分析基于 TanStack Table v8.x（2026-04-02）*  
*DataTable 基础实现详见 CODEX_TASK_SHADCN_CHARTS.md（已落地）*
