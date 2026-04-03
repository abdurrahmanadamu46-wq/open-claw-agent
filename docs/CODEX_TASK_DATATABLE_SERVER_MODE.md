# CODEX TASK: DataTable 服务端模式 — 审计日志/执行记录大数据量分页

**优先级：P1**  
**来源：TANSTACK_TABLE_BORROWING_ANALYSIS.md P1-#1**

---

## 背景

审计日志/龙虾执行记录/LLM调用记录数量持续增长（百万级），当前客户端分页一次拉取全量数据，生产环境必须切换为服务端分页。

---

## 一、升级 DataTable 组件支持服务端模式

```typescript
// web/src/components/data-table/DataTable.tsx
// 新增 serverSide 模式支持

interface DataTableProps<T> {
  columns: ColumnDef<T>[];
  data: T[];
  loading?: boolean;
  onRowClick?: (row: T) => void;
  // 服务端模式参数
  serverSide?: boolean;
  total?: number;         // 服务端总记录数
  pageIndex?: number;
  pageSize?: number;
  onPaginationChange?: (pagination: { pageIndex: number; pageSize: number }) => void;
  onSortingChange?: (sorting: SortingState) => void;
  onColumnFiltersChange?: (filters: ColumnFiltersState) => void;
}

export function DataTable<T>({
  columns, data, loading, onRowClick,
  serverSide = false,
  total = 0, pageIndex = 0, pageSize = 20,
  onPaginationChange, onSortingChange, onColumnFiltersChange,
}: DataTableProps<T>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [internalPagination, setInternalPagination] = useState({ pageIndex: 0, pageSize: 20 });

  const table = useReactTable({
    data,
    columns,
    // 服务端模式开关
    manualPagination: serverSide,
    manualSorting: serverSide,
    manualFiltering: serverSide,
    pageCount: serverSide ? Math.ceil(total / pageSize) : undefined,
    state: {
      sorting,
      columnFilters,
      pagination: serverSide
        ? { pageIndex, pageSize }
        : internalPagination,
    },
    onSortingChange: (updater) => {
      const next = typeof updater === 'function' ? updater(sorting) : updater;
      setSorting(next);
      onSortingChange?.(next);
    },
    onColumnFiltersChange: (updater) => {
      const next = typeof updater === 'function' ? updater(columnFilters) : updater;
      setColumnFilters(next);
      onColumnFiltersChange?.(next);
    },
    onPaginationChange: serverSide
      ? (updater) => {
          const prev = { pageIndex, pageSize };
          const next = typeof updater === 'function' ? updater(prev) : updater;
          onPaginationChange?.(next);
        }
      : (updater) => {
          const prev = internalPagination;
          const next = typeof updater === 'function' ? updater(prev) : updater;
          setInternalPagination(next);
        },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: serverSide ? undefined : getSortedRowModel(),
    getFilteredRowModel: serverSide ? undefined : getFilteredRowModel(),
    getPaginationRowModel: serverSide ? undefined : getPaginationRowModel(),
  });

  // ... 表格渲染不变
}
```

---

## 二、useServerDataTable Hook（复用逻辑）

```typescript
// web/src/hooks/useServerDataTable.ts
// 所有服务端表格页复用此 Hook

import { useState, useEffect, useCallback } from 'react';
import { SortingState, ColumnFiltersState } from '@tanstack/react-table';

interface UseServerDataTableOptions<T> {
  fetchFn: (params: FetchParams) => Promise<PaginatedResponse<T>>;
  defaultPageSize?: number;
}

interface FetchParams {
  page: number;
  page_size: number;
  sort_by?: string;
  sort_dir?: 'asc' | 'desc';
  filters?: Record<string, unknown>;
}

interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export function useServerDataTable<T>({
  fetchFn,
  defaultPageSize = 20,
}: UseServerDataTableOptions<T>) {
  const [data, setData] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(defaultPageSize);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const filters = Object.fromEntries(
        columnFilters.map(f => [f.id, f.value])
      );
      const result = await fetchFn({
        page: pageIndex + 1,
        page_size: pageSize,
        sort_by: sorting[0]?.id,
        sort_dir: sorting[0]?.desc ? 'desc' : 'asc',
        filters,
      });
      setData(result.data);
      setTotal(result.total);
    } finally {
      setLoading(false);
    }
  }, [pageIndex, pageSize, sorting, columnFilters]);

  useEffect(() => { fetch(); }, [fetch]);

  return {
    data, total, loading, pageIndex, pageSize,
    sorting, columnFilters,
    onPaginationChange: ({ pageIndex: pi, pageSize: ps }: { pageIndex: number; pageSize: number }) => {
      setPageIndex(pi);
      setPageSize(ps);
    },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    refresh: fetch,
  };
}
```

---

## 三、审计日志页（服务端模式使用示例）

```typescript
// web/src/app/operations/audit-log/page.tsx

const auditLogColumns: ColumnDef<AuditLog>[] = [
  { accessorKey: 'created_at', header: '时间', cell: ({ getValue }) => formatDateTime(getValue()) },
  { accessorKey: 'actor', header: '操作人' },
  { accessorKey: 'event_type', header: '事件类型', cell: ({ getValue }) => <EventTypeBadge type={getValue()} /> },
  { accessorKey: 'resource_type', header: '资源类型' },
  { accessorKey: 'resource_id', header: '资源 ID', cell: ({ getValue }) => <code className="text-xs">{getValue()}</code> },
  { accessorKey: 'tenant_id', header: '租户' },
];

export default function AuditLogPage() {
  const serverTable = useServerDataTable({
    fetchFn: (params) => api.get('/v1/audit/logs', { params }),
    defaultPageSize: 50,
  });

  return (
    <EntityListPage
      title="审计日志"
      description="所有系统操作的完整审计记录"
      filters={[
        { key: 'event_type', label: '事件类型', options: AUDIT_EVENT_TYPES },
        { key: 'actor', label: '操作人' },
      ]}
    >
      <DataTable
        columns={auditLogColumns}
        serverSide
        {...serverTable}
      />
    </EntityListPage>
  );
}
```

---

## 四、后端统一 PaginatedResponse 格式

```python
# dragon-senate-saas-v2/pagination.py
# 统一所有列表 API 的分页响应格式

from dataclasses import dataclass
from typing import Generic, TypeVar, List

T = TypeVar('T')

@dataclass
class PaginatedResponse(Generic[T]):
    data: List[T]
    total: int
    page: int
    page_size: int
    total_pages: int

    @classmethod
    def from_query(cls, query, page: int, page_size: int, serializer=None):
        total = query.count()
        offset = (page - 1) * page_size
        items = query.offset(offset).limit(page_size).all()
        data = [serializer(item) if serializer else item for item in items]
        return cls(
            data=data,
            total=total,
            page=page,
            page_size=page_size,
            total_pages=(total + page_size - 1) // page_size,
        )
```

```python
# 使用示例（审计日志 API）
@router.get("/audit/logs")
async def list_audit_logs(
    page: int = 1,
    page_size: int = 50,
    sort_by: str = "created_at",
    sort_dir: str = "desc",
    event_type: Optional[str] = None,
    actor: Optional[str] = None,
    tenant_context: TenantContext = Depends(get_tenant_context),
):
    query = db.query(AuditLog).filter(AuditLog.tenant_id == tenant_context.tenant_id)
    if event_type:
        query = query.filter(AuditLog.event_type == event_type)
    if actor:
        query = query.filter(AuditLog.actor.contains(actor))
    order_col = getattr(AuditLog, sort_by, AuditLog.created_at)
    query = query.order_by(order_col.desc() if sort_dir == 'desc' else order_col.asc())
    return PaginatedResponse.from_query(query, page, page_size, AuditLogSchema.from_orm)
```

---

## 验收标准

- [ ] `DataTable` 组件支持 `serverSide` prop（向下兼容，不影响现有客户端分页）
- [ ] `useServerDataTable` Hook 封装 fetch/loading/pagination/sorting/filters 联动
- [ ] 审计日志页切换为服务端模式（每次只拉 50 条）
- [ ] 龙虾执行记录页切换为服务端模式
- [ ] 后端 `PaginatedResponse` 基础类统一所有列表 API 格式
- [ ] 切换排序后自动重新拉取（pageIndex 重置为 0）
- [ ] 切换过滤条件后自动重新拉取（pageIndex 重置为 0）
- [ ] 加载中显示 Skeleton（不闪白）

---

*Codex Task | 来源：TANSTACK_TABLE_BORROWING_ANALYSIS.md P1-#1 | 2026-04-02*
