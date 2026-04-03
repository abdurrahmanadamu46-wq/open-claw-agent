# CODEX TASK: ContextMenu 右键菜单 — 列表页快捷操作

**优先级：P1**  
**来源借鉴：Radix UI ContextMenu（列表实体快捷操作提升运营效率）**  
**参考分析：`docs/RADIX_PRIMITIVES_BORROWING_ANALYSIS.md` 第三节 3.1**

---

## 背景

当前龙虾/工作流/渠道账号列表页，用户需要点击进入详情页才能执行操作（执行/配置/删除）。随着实体数量增长，这个流程越来越低效。

Radix ContextMenu 提供开箱即用的无障碍右键菜单。参考 Linear、GitHub 等产品的设计，在列表页右键直接弹出快捷操作菜单，高频操作无需进详情页。

---

## 任务目标

1. 新建 `web/src/components/entity-menus/LobsterContextMenu.tsx`
2. 新建 `web/src/components/entity-menus/WorkflowContextMenu.tsx`
3. 新建 `web/src/components/entity-menus/EdgeNodeContextMenu.tsx`
4. 集成到对应列表页

---

## 一、龙虾右键菜单（`LobsterContextMenu.tsx`）

```typescript
// web/src/components/entity-menus/LobsterContextMenu.tsx

'use client';

import { useRouter } from 'next/navigation';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { DangerActionGuard } from '@/components/DangerActionGuard';
import { toast } from '@/components/ui/use-toast';
import type { Lobster } from '@/types/lobster';

interface LobsterContextMenuProps {
  lobster: Lobster;
  children: React.ReactNode;  // 被右键的元素（如 LobsterCard）
  onRefresh?: () => void;     // 操作后刷新列表
}

export function LobsterContextMenu({ lobster, children, onRefresh }: LobsterContextMenuProps) {
  const router = useRouter();
  
  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: `✅ 已复制${label}`, duration: 2000 });
  };
  
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        {children}
      </ContextMenuTrigger>
      
      <ContextMenuContent className="w-52">
        {/* 主要操作 */}
        <ContextMenuItem
          onClick={() => router.push(`/lobsters/${lobster.id}?tab=runs&action=run`)}
          disabled={lobster.status === 'offline' || lobster.lifecycle === 'deprecated'}
        >
          ▶ 立即执行
          <ContextMenuShortcut>⌘R</ContextMenuShortcut>
        </ContextMenuItem>
        
        <ContextMenuItem
          onClick={() => router.push(`/lobsters/${lobster.id}`)}
        >
          👁 查看详情
        </ContextMenuItem>
        
        <ContextMenuSeparator />
        
        {/* 复制操作 */}
        <ContextMenuSub>
          <ContextMenuSubTrigger>📋 复制</ContextMenuSubTrigger>
          <ContextMenuSubContent>
            <ContextMenuItem onClick={() => copyToClipboard(lobster.id, '龙虾 ID')}>
              复制龙虾 ID
            </ContextMenuItem>
            <ContextMenuItem onClick={() => copyToClipboard(lobster.name, '龙虾名称')}>
              复制龙虾名称
            </ContextMenuItem>
            <ContextMenuItem
              onClick={() => copyToClipboard(
                `${window.location.origin}/api/v1/lobsters/${lobster.id}`,
                'API 端点'
              )}
            >
              复制 API 端点
            </ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>
        
        <ContextMenuSeparator />
        
        {/* 配置操作 */}
        <ContextMenuItem
          onClick={() => router.push(`/lobsters/${lobster.id}?tab=config`)}
        >
          🔧 进入配置
        </ContextMenuItem>
        
        <ContextMenuItem
          onClick={() => router.push(`/lobsters/${lobster.id}?tab=runs`)}
        >
          📊 查看执行记录
        </ContextMenuItem>
        
        <ContextMenuItem
          onClick={() => router.push(`/lobsters/${lobster.id}?tab=knowledge`)}
        >
          📚 查看知识库
        </ContextMenuItem>
        
        <ContextMenuSeparator />
        
        {/* 危险操作（仅 production 状态可废弃）*/}
        {lobster.lifecycle !== 'deprecated' && (
          <DangerActionGuard
            trigger={
              <ContextMenuItem
                className="text-destructive focus:text-destructive focus:bg-destructive/10"
                onSelect={(e) => e.preventDefault()} // 阻止菜单关闭（由 DangerActionGuard 控制）
              >
                🚫 废弃此龙虾
              </ContextMenuItem>
            }
            title={`废弃龙虾：${lobster.display_name}`}
            description={`此操作不可逆。${lobster.display_name} 将在 30 天后正式下线，届时所有依赖此龙虾的工作流步骤将失败。`}
            affectedCount={lobster.affected_tenant_count}
            affectedType="租户"
            confirmText="DEPRECATE"
            confirmLabel="确认废弃"
            successMessage={`${lobster.display_name} 已标记为废弃`}
            onConfirm={async () => {
              await fetch(`/api/v1/lobsters/${lobster.id}/lifecycle`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ new_lifecycle: 'deprecated' })
              });
              onRefresh?.();
            }}
          />
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
```

---

## 二、工作流右键菜单（`WorkflowContextMenu.tsx`）

```typescript
// web/src/components/entity-menus/WorkflowContextMenu.tsx

export function WorkflowContextMenu({ workflow, children, onRefresh }) {
  const router = useRouter();
  
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        
        {/* 执行操作 */}
        <ContextMenuItem
          onClick={() => router.push(`/workflows/${workflow.id}/run`)}
          disabled={workflow.lifecycle !== 'active'}
        >
          ▶ 立即运行
        </ContextMenuItem>
        
        <ContextMenuItem onClick={() => router.push(`/workflows/${workflow.id}`)}>
          👁 查看详情
        </ContextMenuItem>
        
        <ContextMenuSeparator />
        
        {/* 状态操作 */}
        {workflow.lifecycle === 'active' && (
          <ContextMenuItem
            onClick={async () => {
              await fetch(`/api/v1/workflows/${workflow.id}/lifecycle`, {
                method: 'PUT',
                body: JSON.stringify({ new_lifecycle: 'paused' })
              });
              toast({ title: '⏸ 工作流已暂停' });
              onRefresh?.();
            }}
          >
            ⏸ 暂停工作流
          </ContextMenuItem>
        )}
        
        {workflow.lifecycle === 'paused' && (
          <ContextMenuItem
            onClick={async () => {
              await fetch(`/api/v1/workflows/${workflow.id}/lifecycle`, {
                method: 'PUT',
                body: JSON.stringify({ new_lifecycle: 'active' })
              });
              toast({ title: '▶ 工作流已恢复' });
              onRefresh?.();
            }}
          >
            ▶ 恢复工作流
          </ContextMenuItem>
        )}
        
        <ContextMenuItem onClick={() => router.push(`/workflows/${workflow.id}/edit`)}>
          📝 编辑
        </ContextMenuItem>
        
        <ContextMenuItem onClick={() => {
          navigator.clipboard.writeText(workflow.id);
          toast({ title: '已复制工作流 ID' });
        }}>
          📋 复制 ID
        </ContextMenuItem>
        
        <ContextMenuSeparator />
        
        {/* 删除 */}
        <DangerActionGuard
          trigger={
            <ContextMenuItem
              className="text-destructive focus:text-destructive focus:bg-destructive/10"
              onSelect={(e) => e.preventDefault()}
            >
              🗑 删除工作流
            </ContextMenuItem>
          }
          title={`删除工作流：${workflow.name}`}
          description="删除后不可恢复。所有使用此工作流的定时任务将立即停止运行。"
          affectedCount={workflow.schedule_count}
          affectedType="定时任务"
          confirmText="DELETE"
          confirmLabel="删除工作流"
          successMessage="工作流已删除"
          onConfirm={async () => {
            await fetch(`/api/v1/workflows/${workflow.id}`, { method: 'DELETE' });
            onRefresh?.();
          }}
        />
      </ContextMenuContent>
    </ContextMenu>
  );
}
```

---

## 三、边缘节点右键菜单（`EdgeNodeContextMenu.tsx`）

```typescript
// web/src/components/entity-menus/EdgeNodeContextMenu.tsx

export function EdgeNodeContextMenu({ node, children, onRefresh }) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        
        <ContextMenuItem
          onClick={async () => {
            await fetch(`/api/v1/edge-nodes/${node.id}/reconnect`, { method: 'POST' });
            toast({ title: '🔄 重连指令已发送' });
          }}
          disabled={node.status === 'online'}
        >
          🔄 尝试重连
        </ContextMenuItem>
        
        <ContextMenuItem
          onClick={() => window.open(`/edge-nodes/${node.id}/logs`, '_blank')}
        >
          📡 查看实时日志
        </ContextMenuItem>
        
        <ContextMenuItem
          onClick={() => {
            navigator.clipboard.writeText(node.id);
            toast({ title: '已复制节点 ID' });
          }}
        >
          📋 复制节点 ID
        </ContextMenuItem>
        
        <ContextMenuSeparator />
        
        <ContextMenuItem
          onClick={() => router.push(`/edge-nodes/${node.id}/config`)}
        >
          🔧 配置节点
        </ContextMenuItem>
        
        <ContextMenuSeparator />
        
        <DangerActionGuard
          trigger={
            <ContextMenuItem
              className="text-destructive focus:text-destructive focus:bg-destructive/10"
              onSelect={(e) => e.preventDefault()}
            >
              🔌 强制断开
            </ContextMenuItem>
          }
          title="强制断开边缘节点"
          description={`节点 ${node.name} 将被强制断开连接，该节点上的所有进行中任务将中断。`}
          confirmLabel="强制断开"
          successMessage="节点已断开连接"
          onConfirm={async () => {
            await fetch(`/api/v1/edge-nodes/${node.id}/disconnect`, { method: 'POST' });
            onRefresh?.();
          }}
        />
      </ContextMenuContent>
    </ContextMenu>
  );
}
```

---

## 四、集成到列表页

### 4.1 龙虾列表页（`/lobsters/page.tsx`）

```typescript
// 在 LobsterCard 外层包裹 LobsterContextMenu
{lobsters.map(lobster => (
  <LobsterContextMenu
    key={lobster.id}
    lobster={lobster}
    onRefresh={refetch}
  >
    <LobsterCard lobster={lobster} />
  </LobsterContextMenu>
))}
```

### 4.2 工作流列表页（`/workflows/page.tsx`）

```typescript
{workflows.map(workflow => (
  <WorkflowContextMenu
    key={workflow.id}
    workflow={workflow}
    onRefresh={refetch}
  >
    <WorkflowRow workflow={workflow} />
  </WorkflowContextMenu>
))}
```

### 4.3 边缘节点页（`/edge-nodes/page.tsx`）

```typescript
{nodes.map(node => (
  <EdgeNodeContextMenu
    key={node.id}
    node={node}
    onRefresh={refetch}
  >
    <EdgeNodeCard node={node} />
  </EdgeNodeContextMenu>
))}
```

---

## 五、PROJECT_CONTROL_CENTER.md 同步更新

完成后：

1. **第十节"前端对齐索引"** 增加：
   ```
   | 右键菜单 | 各实体 CRUD API | entity-menus/* | 龙虾/工作流/边缘节点列表 | ✅ |
   ```

2. **第七节"已落地借鉴清单"** 增加：
   ```
   | Radix UI Primitives | ContextMenu 列表页右键快捷操作（运营效率提升）| ✅ | LobsterContextMenu, WorkflowContextMenu, EdgeNodeContextMenu |
   ```

---

## 验收标准

- [ ] `LobsterContextMenu.tsx` 实现（8个菜单项，含废弃危险操作）
- [ ] `WorkflowContextMenu.tsx` 实现（删除危险操作集成 DangerActionGuard）
- [ ] `EdgeNodeContextMenu.tsx` 实现（强制断开危险操作）
- [ ] 依赖 `CODEX_TASK_DANGER_ACTION_GUARD.md` 的 DangerActionGuard 组件
- [ ] 龙虾列表页所有 LobsterCard 外层包裹 LobsterContextMenu
- [ ] 工作流列表页所有行包裹 WorkflowContextMenu
- [ ] 边缘节点列表页包裹 EdgeNodeContextMenu
- [ ] 复制操作调用 `navigator.clipboard.writeText` 并 Toast 通知
- [ ] 暂停/恢复立即调用 API 并刷新列表（无需进详情页）
- [ ] 键盘导航（↑↓ 移动，Enter 执行，Esc 关闭）
- [ ] deprecated 的龙虾禁用"立即执行"菜单项

---

*Codex Task | 来源：RADIX_PRIMITIVES_BORROWING_ANALYSIS.md P1-#2 | 2026-04-02*
