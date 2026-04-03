# CODEX TASK: 全局搜索（Cmd+K）— 跨实体统一搜索面板

**优先级：P1**  
**来源借鉴：Backstage Search Plugin（SearchModal + 多类型搜索结果）**  
**参考分析：`docs/BACKSTAGE_BORROWING_ANALYSIS.md` 第二节 2.1**

---

## 背景

Backstage 的全局搜索是 IDP 必备能力：顶部快捷键（`/`或`Cmd+K`）弹出全屏搜索面板，跨所有实体类型统一查询，结果按类型分组展示，高亮匹配词。

我们的 Operations Console 各页面有独立搜索框，随着龙虾/工作流/渠道账号数量增长，全局搜索是刚需。

---

## 任务目标

1. 前端：`Cmd/Ctrl + K` 快捷键触发全局搜索面板（`GlobalSearch.tsx`）
2. 后端：统一搜索 API（`/api/v1/search`）
3. 搜索范围：龙虾 / 工作流 / 渠道账号 / 审计事件 / 租户

---

## 一、前端：`GlobalSearch.tsx`

### 1.1 快捷键注册（全局）

```typescript
// web/src/components/GlobalSearch.tsx

'use client';

import { useEffect, useState } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Command, CommandInput, CommandList, CommandEmpty,
         CommandGroup, CommandItem } from '@/components/ui/command';

export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);

  // Cmd+K / Ctrl+K 快捷键
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen(prev => !prev);
      }
    };
    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, []);

  // 防抖搜索
  useEffect(() => {
    if (!query || query.length < 2) {
      setResults(null);
      return;
    }
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/v1/search?q=${encodeURIComponent(query)}&limit=5`);
        setResults(await res.json());
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [query]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-2xl p-0 overflow-hidden">
        <Command className="rounded-lg border-0">
          <CommandInput
            placeholder="搜索龙虾、工作流、渠道账号..."
            value={query}
            onValueChange={setQuery}
            autoFocus
          />
          <CommandList className="max-h-[60vh] overflow-y-auto p-2">
            {loading && (
              <div className="py-6 text-center text-sm text-muted-foreground">
                搜索中...
              </div>
            )}
            
            {!loading && results && (
              <>
                {/* 龙虾 */}
                {results.lobsters.length > 0 && (
                  <CommandGroup heading="龙虾">
                    {results.lobsters.map(item => (
                      <SearchResultItem
                        key={item.id}
                        icon="🦞"
                        title={item.display_name}
                        subtitle={item.description}
                        badge={item.lifecycle}
                        href={`/lobsters/${item.id}`}
                        query={query}
                        onSelect={() => setOpen(false)}
                      />
                    ))}
                  </CommandGroup>
                )}
                
                {/* 工作流 */}
                {results.workflows.length > 0 && (
                  <CommandGroup heading="工作流">
                    {results.workflows.map(item => (
                      <SearchResultItem
                        key={item.id}
                        icon="⚙️"
                        title={item.name}
                        subtitle={`${item.step_count} 步骤 · ${item.status}`}
                        href={`/workflows/${item.id}`}
                        query={query}
                        onSelect={() => setOpen(false)}
                      />
                    ))}
                  </CommandGroup>
                )}
                
                {/* 渠道账号 */}
                {results.channels.length > 0 && (
                  <CommandGroup heading="渠道账号">
                    {results.channels.map(item => (
                      <SearchResultItem
                        key={item.id}
                        icon="📱"
                        title={item.account_name}
                        subtitle={`${item.platform} · ${item.status}`}
                        href={`/channels/${item.id}`}
                        query={query}
                        onSelect={() => setOpen(false)}
                      />
                    ))}
                  </CommandGroup>
                )}
                
                {/* 租户 */}
                {results.tenants?.length > 0 && (
                  <CommandGroup heading="租户">
                    {results.tenants.map(item => (
                      <SearchResultItem
                        key={item.id}
                        icon="🏢"
                        title={item.name}
                        subtitle={item.plan}
                        href={`/tenants/${item.id}`}
                        query={query}
                        onSelect={() => setOpen(false)}
                      />
                    ))}
                  </CommandGroup>
                )}
                
                {Object.values(results).every(arr => arr.length === 0) && (
                  <CommandEmpty>未找到 "{query}" 相关内容</CommandEmpty>
                )}
              </>
            )}
            
            {/* 未输入时的默认提示 */}
            {!query && (
              <div className="py-8 text-center">
                <p className="text-sm text-muted-foreground mb-4">快速跳转</p>
                <div className="flex justify-center gap-2 flex-wrap">
                  {QUICK_LINKS.map(link => (
                    <QuickLinkChip key={link.href} {...link} onSelect={() => setOpen(false)} />
                  ))}
                </div>
              </div>
            )}
          </CommandList>
          
          {/* 底部提示 */}
          <div className="border-t px-3 py-2 flex items-center gap-4 text-xs text-muted-foreground">
            <span><kbd>↵</kbd> 跳转</span>
            <span><kbd>↑↓</kbd> 选择</span>
            <span><kbd>Esc</kbd> 关闭</span>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
```

### 1.2 高亮匹配词组件

```typescript
// web/src/components/search/HighlightText.tsx

export function HighlightText({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  
  const parts = text.split(new RegExp(`(${query})`, 'gi'));
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === query.toLowerCase()
          ? <mark key={i} className="bg-yellow-200 text-yellow-900 rounded px-0.5">{part}</mark>
          : <span key={i}>{part}</span>
      )}
    </>
  );
}
```

### 1.3 快速链接（未输入时显示）

```typescript
const QUICK_LINKS = [
  { label: '所有龙虾', href: '/lobsters', icon: '🦞' },
  { label: '工作流', href: '/workflows', icon: '⚙️' },
  { label: '渠道账号', href: '/channels', icon: '📱' },
  { label: '边缘节点', href: '/edge-nodes', icon: '🖥️' },
  { label: '审计日志', href: '/operations/audit-log', icon: '📋' },
  { label: '功能开关', href: '/operations/feature-flags', icon: '🎚️' },
];
```

### 1.4 集成到导航栏

在 `web/src/components/layout/Navbar.tsx` 中：

```typescript
// 导航栏右侧增加搜索触发器
<Button
  variant="outline"
  size="sm"
  className="w-48 justify-between text-muted-foreground"
  onClick={() => setSearchOpen(true)}
>
  <span>搜索...</span>
  <kbd className="text-xs bg-muted px-1 rounded">⌘K</kbd>
</Button>

<GlobalSearch />
```

---

## 二、后端：统一搜索 API

### 2.1 新增搜索路由

```python
# dragon-senate-saas-v2/search_api.py（新建）

from fastapi import APIRouter, Query, Depends
from tenant_context import TenantContext, get_tenant_context

router = APIRouter(prefix="/api/v1/search")

@router.get("")
async def global_search(
    q: str = Query(..., min_length=2, max_length=100),
    types: str = Query(default="lobster,workflow,channel,tenant"),
    limit: int = Query(default=5, le=20),
    ctx: TenantContext = Depends(get_tenant_context)
) -> SearchResults:
    """
    全局搜索
    
    参数：
      q: 搜索词（最少2字符）
      types: 搜索类型（逗号分隔）
      limit: 每类最多返回条数
    
    搜索策略：
      简单实现：SQL ILIKE（全文匹配，适合中小数据量）
      进阶：接入 ElasticSearch/MeiliSearch（数据量大时升级）
    """
    type_list = types.split(",")
    results = SearchResults(lobsters=[], workflows=[], channels=[], tenants=[])
    
    if "lobster" in type_list:
        results.lobsters = await search_lobsters(q, ctx.tenant_id, limit)
    if "workflow" in type_list:
        results.workflows = await search_workflows(q, ctx.tenant_id, limit)
    if "channel" in type_list:
        results.channels = await search_channels(q, ctx.tenant_id, limit)
    if "tenant" in type_list and "superadmin" in ctx.roles:
        results.tenants = await search_tenants(q, limit)
    
    return results

async def search_lobsters(q: str, tenant_id: str, limit: int) -> list:
    """
    搜索龙虾（名称 + 描述 + 技能名）
    SQL: WHERE name ILIKE '%q%' OR description ILIKE '%q%'
    """
    ...

async def search_workflows(q: str, tenant_id: str, limit: int) -> list:
    """搜索工作流（名称 + 描述）"""
    ...

async def search_channels(q: str, tenant_id: str, limit: int) -> list:
    """搜索渠道账号（账号名 + 平台）"""
    ...
```

### 2.2 TypeScript 类型

新建 `web/src/types/search.ts`：

```typescript
export interface SearchResultItem {
  id: string;
  title: string;
  description?: string;
  href: string;
  type: 'lobster' | 'workflow' | 'channel' | 'tenant' | 'audit';
  badge?: string;
  icon?: string;
}

export interface SearchResults {
  lobsters: LobsterSearchItem[];
  workflows: WorkflowSearchItem[];
  channels: ChannelSearchItem[];
  tenants?: TenantSearchItem[];
}

export interface LobsterSearchItem {
  id: string;
  display_name: string;
  description: string;
  lifecycle: string;
  status: string;
}
```

---

## 三、PROJECT_CONTROL_CENTER.md 同步更新

完成后：

1. **第四节"已完成 API"** 增加：
   ```
   ✅ GET /api/v1/search（全局跨实体搜索）
   ```

2. **第十节"前端对齐索引"** 增加：
   ```
   | 全局搜索 | GET /api/v1/search | web/src/types/search.ts | Cmd+K 面板 | ✅ |
   ```

3. **第七节"已落地借鉴清单"** 增加：
   ```
   | Backstage | 全局搜索 Cmd+K（SearchModal）| ✅ | GlobalSearch.tsx, search_api.py |
   ```

---

## 验收标准

- [ ] `Cmd+K`（Mac）和 `Ctrl+K`（Win）触发搜索面板
- [ ] 输入 2+ 字符后 200ms 防抖自动搜索
- [ ] 搜索结果按龙虾/工作流/渠道账号分组展示
- [ ] 高亮匹配词（HighlightText 组件）
- [ ] 未找到结果时显示 "未找到 xxx"
- [ ] 未输入时显示快速链接面板（6个常用页面）
- [ ] 键盘导航（↑↓ 选择，↵ 跳转，Esc 关闭）
- [ ] 点击结果跳转到对应页面并关闭面板
- [ ] 后端 `/api/v1/search` 按 tenant_id 隔离
- [ ] `web/src/types/search.ts` 类型文件存在

---

*Codex Task | 来源：BACKSTAGE_BORROWING_ANALYSIS.md P1-#2 | 2026-04-02*
