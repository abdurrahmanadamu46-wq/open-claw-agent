# CODEX TASK: DataTable 行展开 + 批量操作 — 执行记录/工作流/渠道账号

**优先级：P1**  
**来源：TANSTACK_TABLE_BORROWING_ANALYSIS.md P1-#2 + P1-#3**

---

## 背景

两个独立能力合并实现：
1. **行展开（Expanding）**：执行记录/审计日志/工作流执行历史，在行内展开查看完整详情，无需跳转新页面
2. **批量行选择 + 批量操作工具栏**：工作流/渠道账号/边缘节点的批量暂停/删除/归档操作

---

## 一、行展开能力（DataTable Expanding）

### 1.1 DataTable 组件新增 Expanding 支持

```typescript
// web/src/components/data-table/DataTable.tsx — 新增参数

interface DataTableProps<T> {
  // ... 原有参数
  // 行展开
  expandable?: boolean;
  renderSubComponent?: (row: Row<T>) => React.ReactNode;
  getRowCanExpand?: (row: Row<T>) => boolean;
}

export function DataTable<T>({
  expandable = false,
  renderSubComponent,
  getRowCanExpand,
  ...rest
}: DataTableProps<T>) {

  const table = useReactTable({
    // ... 原有配置
    getRowCanExpand: expandable ? (getRowCanExpand ?? (() => true)) : undefined,
    getExpandedRowModel: expandable ? getExpandedRowModel() : undefined,
  });

  // 表格 Body 渲染
  return (
    <TableBody>
      {table.getRowModel().rows.map(row => (
        <Fragment key={row.id}>
          <TableRow
            onClick={() => {
              if (expandable) row.toggleExpanded();
              else onRowClick?.(row.original);
            }}
            className={cn(
              expandable && 'cursor-pointer',
              row.getIsExpanded() && 'bg-muted/30',
            )}
          >
            {row.getVisibleCells().map(cell => (
              <TableCell key={cell.id}>
                {flexRender(cell.column.columnDef.cell, cell.getContext())}
              </TableCell>
            ))}
          </TableRow>
          {/* 展开内容行 */}
          {row.getIsExpanded() && renderSubComponent && (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={row.getVisibleCells().length} className="p-0">
                <div className="border-t border-b bg-muted/10 px-4 py-3">
                  {renderSubComponent(row)}
                </div>
              </TableCell>
            </TableRow>
          )}
        </Fragment>
      ))}
    </TableBody>
  );
}
```

### 1.2 展开列定义（expandColumn helper）

```typescript
// web/src/components/data-table/columns.tsx

import { ChevronRight } from 'lucide-react';

export const expandColumn = <T,>(): ColumnDef<T> => ({
  id: 'expand',
  header: () => null,
  cell: ({ row }) => (
    <button
      onClick={(e) => {
        e.stopPropagation();
        row.toggleExpanded();
      }}
      className="p-1 rounded hover:bg-muted transition-transform duration-150"
      style={{ transform: row.getIsExpanded() ? 'rotate(90deg)' : 'rotate(0deg)' }}
    >
      <ChevronRight className="h-4 w-4 text-muted-foreground" />
    </button>
  ),
  size: 40,
  enableSorting: false,
});
```

### 1.3 龙虾执行记录展开面板（`RunDetailPanel.tsx`）

```typescript
// web/src/components/lobster/RunDetailPanel.tsx

interface RunDetailPanelProps {
  run: LobsterRun;
}

export function RunDetailPanel({ run }: RunDetailPanelProps) {
  return (
    <div className="grid grid-cols-2 gap-4 text-sm">
      {/* 左：输入/输出 */}
      <div className="space-y-3">
        <div>
          <h4 className="font-medium text-muted-foreground mb-1">输入</h4>
          <pre className="bg-background rounded p-2 text-xs overflow-auto max-h-32 border">
            {JSON.stringify(run.input, null, 2)}
          </pre>
        </div>
        <div>
          <h4 className="font-medium text-muted-foreground mb-1">输出</h4>
          <div className="bg-background rounded p-2 text-xs border max-h-32 overflow-auto whitespace-pre-wrap">
            {run.output}
          </div>
        </div>
      </div>
      
      {/* 右：执行元数据 */}
      <div className="space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <MetaItem label="耗时" value={`${run.duration_ms}ms`} />
          <MetaItem label="Token 数" value={run.token_count?.toString() ?? '-'} />
          <MetaItem label="模型" value={run.model_name} />
          <MetaItem label="边缘节点" value={run.edge_node_id ?? '云端'} />
        </div>
        
        {/* 质量评分详情 */}
        {run.quality_score && (
          <div className="mt-2">
            <h4 className="font-medium text-muted-foreground mb-1">质量评分详情</h4>
            <div className="grid grid-cols-3 gap-1">
              {Object.entries(run.quality_breakdown ?? {}).map(([k, v]) => (
                <div key={k} className="flex justify-between bg-background rounded p-1 border text-xs">
                  <span className="text-muted-foreground">{k}</span>
                  <span className="font-medium">{v}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        
        {/* 错误信息 */}
        {run.error && (
          <div className="mt-2 p-2 bg-destructive/10 rounded border border-destructive/20 text-xs text-destructive">
            {run.error}
          </div>
        )}
      </div>
    </div>
  );
}

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  );
}
```

### 1.4 审计日志展开面板（ConfigDiffPanel）

```typescript
// web/src/components/audit/ConfigDiffPanel.tsx
// 展开显示配置变更前/后的 diff

export function ConfigDiffPanel({ log }: { log: AuditLog }) {
  if (!log.before || !log.after) {
    return <pre className="text-xs text-muted-foreground">{JSON.stringify(log.metadata, null, 2)}</pre>;
  }
  
  return (
    <div className="grid grid-cols-2 gap-3">
      <div>
        <h4 className="text-xs font-medium text-muted-foreground mb-1">变更前</h4>
        <pre className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900 rounded p-2 text-xs overflow-auto max-h-40">
          {JSON.stringify(log.before, null, 2)}
        </pre>
      </div>
      <div>
        <h4 className="text-xs font-medium text-muted-foreground mb-1">变更后</h4>
        <pre className="bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-900 rounded p-2 text-xs overflow-auto max-h-40">
          {JSON.stringify(log.after, null, 2)}
        </pre>
      </div>
    </div>
  );
}
```

### 1.5 执行记录列表（使用示例）

```typescript
// web/src/app/lobsters/runs/page.tsx

const runColumns: ColumnDef<LobsterRun>[] = [
  expandColumn<LobsterRun>(),
  { accessorKey: 'created_at', header: '时间', cell: ({ getValue }) => formatDateTime(getValue()) },
  { accessorKey: 'lobster_display_name', header: '龙虾' },
  { accessorKey: 'skill_name', header: '技能' },
  {
    accessorKey: 'status',
    header: '状态',
    cell: ({ getValue }) => <RunStatusBadge status={getValue()} />,
  },
  {
    accessorKey: 'quality_score',
    header: '质量分',
    cell: ({ getValue }) => {
      const v = getValue<number>();
      return v ? <span className={v < 7 ? 'text-destructive' : 'text-green-600'}>{v.toFixed(1)}</span> : '-';
    },
  },
  { accessorKey: 'duration_ms', header: '耗时', cell: ({ getValue }) => `${getValue()}ms` },
];

export default function RunsPage() {
  const serverTable = useServerDataTable({ fetchFn: (p) => api.get('/v1/runs', { params: p }) });
  
  return (
    <EntityListPage title="执行记录">
      <DataTable
        columns={runColumns}
        expandable
        renderSubComponent={({ original }) => <RunDetailPanel run={original} />}
        serverSide
        {...serverTable}
      />
    </EntityListPage>
  );
}
```

---

## 二、批量行选择 + 批量操作工具栏

### 2.1 DataTable 组件新增批量选择支持

```typescript
// 新增批量操作相关参数
interface DataTableProps<T> {
  // ... 原有参数
  // 批量选择
  selectable?: boolean;
  onSelectionChange?: (rows: T[]) => void;
  batchActions?: React.ReactNode;  // 批量操作工具栏内容
}

export function DataTable<T>({
  selectable = false,
  onSelectionChange,
  batchActions,
  ...rest
}: DataTableProps<T>) {
  const [rowSelection, setRowSelection] = useState({});

  const table = useReactTable({
    // ...
    enableRowSelection: selectable,
    onRowSelectionChange: setRowSelection,
    state: { rowSelection, /* ... */ },
  });

  const selectedRows = table.getSelectedRowModel().rows.map(r => r.original);

  // 通知父组件选中行变化
  useEffect(() => {
    onSelectionChange?.(selectedRows);
  }, [rowSelection]);

  return (
    <div className="space-y-2">
      {/* 批量操作工具栏（有选中时浮出）*/}
      {selectable && selectedRows.length > 0 && (
        <div className="flex items-center gap-3 px-3 py-2 bg-primary/5 border rounded-md animate-in slide-in-from-top-2 duration-150">
          <span className="text-sm font-medium text-primary">
            已选 {selectedRows.length} 项
          </span>
          <button
            onClick={() => table.resetRowSelection()}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            取消选择
          </button>
          <div className="ml-auto flex items-center gap-2">
            {batchActions}
          </div>
        </div>
      )}
      {/* 表格 */}
      <div className="rounded-md border">...</div>
    </div>
  );
}
```

### 2.2 selectColumn helper（含全选 Checkbox）

```typescript
// web/src/components/data-table/columns.tsx

export const selectColumn = <T,>(): ColumnDef<T> => ({
  id: 'select',
  header: ({ table }) => (
    <Checkbox
      checked={
        table.getIsAllPageRowsSelected() ||
        (table.getIsSomePageRowsSelected() && 'indeterminate')
      }
      onCheckedChange={(v) => table.toggleAllPageRowsSelected(!!v)}
      aria-label="全选当前页"
    />
  ),
  cell: ({ row }) => (
    <Checkbox
      checked={row.getIsSelected()}
      onCheckedChange={(v) => row.toggleSelected(!!v)}
      onClick={(e) => e.stopPropagation()}
      aria-label="选择此行"
    />
  ),
  size: 48,
  enableSorting: false,
});
```

### 2.3 工作流列表（批量操作使用示例）

```typescript
// web/src/app/workflows/page.tsx

export default function WorkflowsPage() {
  const [selectedWorkflows, setSelectedWorkflows] = useState<Workflow[]>([]);
  const serverTable = useServerDataTable({ fetchFn: (p) => api.get('/v1/workflows', { params: p }) });

  const workflowColumns: ColumnDef<Workflow>[] = [
    selectColumn<Workflow>(),
    { accessorKey: 'name', header: '工作流名称' },
    { accessorKey: 'step_count', header: '步骤数' },
    { accessorKey: 'status', header: '状态', cell: ({ getValue }) => <StatusBadge status={getValue()} /> },
    { accessorKey: 'last_run_at', header: '最近执行' },
    { id: 'actions', header: () => null, cell: ({ row }) => <WorkflowRowActions workflow={row.original} /> },
  ];

  const handleBatchPause = async () => {
    await api.post('/v1/workflows/batch-pause', { ids: selectedWorkflows.map(w => w.id) });
    serverTable.refresh();
  };

  const handleBatchDelete = async () => {
    await api.post('/v1/workflows/batch-delete', { ids: selectedWorkflows.map(w => w.id) });
    serverTable.refresh();
  };

  return (
    <EntityListPage
      title="工作流管理"
      primaryAction={<Button onClick={() => router.push('/workflows/new')}>+ 新建工作流</Button>}
    >
      <DataTable
        columns={workflowColumns}
        selectable
        onSelectionChange={setSelectedWorkflows}
        batchActions={
          <>
            <Button size="sm" variant="outline" onClick={handleBatchPause}>
              ⏸ 批量暂停 ({selectedWorkflows.length})
            </Button>
            <DangerActionGuard
              trigger={
                <Button size="sm" variant="destructive">
                  🗑 批量删除 ({selectedWorkflows.length})
                </Button>
              }
              title={`批量删除 ${selectedWorkflows.length} 个工作流`}
              description={`这 ${selectedWorkflows.length} 个工作流将被永久删除，不可恢复。`}
              confirmText="DELETE"
              onConfirm={handleBatchDelete}
            />
          </>
        }
        serverSide
        {...serverTable}
      />
    </EntityListPage>
  );
}
```

### 2.4 后端批量操作 API

```python
# dragon-senate-saas-v2/api_governance_routes.py 新增批量端点

@router.post("/workflows/batch-pause")
async def batch_pause_workflows(
    body: BatchIdsBody,
    tenant_context: TenantContext = Depends(get_tenant_context),
):
    """批量暂停工作流"""
    updated = db.query(Workflow)\
        .filter(Workflow.id.in_(body.ids), Workflow.tenant_id == tenant_context.tenant_id)\
        .update({"status": "paused"}, synchronize_session=False)
    db.commit()
    # 写审计日志
    audit_logger.log_bulk(
        event_type=AuditEventType.WORKFLOW_BATCH_PAUSE,
        resource_ids=body.ids,
        actor=tenant_context.user_id,
        tenant_id=tenant_context.tenant_id,
    )
    return {"updated": updated}

@router.post("/workflows/batch-delete")
async def batch_delete_workflows(
    body: BatchIdsBody,
    tenant_context: TenantContext = Depends(get_tenant_context),
):
    """批量删除工作流（带 DangerActionGuard 二次确认）"""
    db.query(Workflow)\
        .filter(Workflow.id.in_(body.ids), Workflow.tenant_id == tenant_context.tenant_id)\
        .delete(synchronize_session=False)
    db.commit()
    audit_logger.log_bulk(
        event_type=AuditEventType.WORKFLOW_BATCH_DELETE,
        resource_ids=body.ids,
        actor=tenant_context.user_id,
        tenant_id=tenant_context.tenant_id,
    )
    return {"deleted": len(body.ids)}
```

---

## 三、各页面接入计划

| 页面 | 展开 | 批量操作 | 批量动作 |
|-----|------|---------|---------|
| 龙虾执行记录 | ✅ RunDetailPanel | ❌ 不需要 | — |
| 审计日志 | ✅ ConfigDiffPanel | ❌ 只读 | — |
| 工作流列表 | ❌ | ✅ | 批量暂停/批量删除 |
| 渠道账号列表 | ❌ | ✅ | 批量暂停发布/批量归档 |
| 边缘节点列表 | ❌ | ✅ | 批量断开/批量重连 |

---

## 验收标准

**行展开：**
- [ ] `DataTable` 支持 `expandable` + `renderSubComponent` props
- [ ] `expandColumn()` helper：点击箭头展开/折叠（动画旋转90°）
- [ ] 点击行任意位置均可展开（`onClick` 在行上）
- [ ] `RunDetailPanel`：左侧输入/输出 + 右侧元数据 + 质量评分详情 + 错误信息
- [ ] `ConfigDiffPanel`：变更前（红底）/ 变更后（绿底）对比
- [ ] 执行记录列表使用 `expandable`，行展开显示 RunDetailPanel
- [ ] 审计日志列表使用 `expandable`，行展开显示 ConfigDiffPanel

**批量操作：**
- [ ] `DataTable` 支持 `selectable` + `onSelectionChange` + `batchActions` props
- [ ] `selectColumn()` helper：表头全选（支持 indeterminate 状态）
- [ ] 有选中时，顶部批量工具栏动画滑入（animate-in）
- [ ] 工具栏展示选中数量 + 取消选择按钮
- [ ] 工作流列表支持批量暂停/批量删除（DangerActionGuard 二次确认）
- [ ] 渠道账号列表支持批量暂停发布
- [ ] 边缘节点列表支持批量重连
- [ ] 批量操作后自动刷新列表（`serverTable.refresh()`）
- [ ] 批量操作均写入审计日志（`audit_logger.log_bulk`）

---

*Codex Task | 来源：TANSTACK_TABLE_BORROWING_ANALYSIS.md P1-#2 + P1-#3 | 2026-04-02*
