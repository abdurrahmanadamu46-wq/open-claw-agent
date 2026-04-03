# CODEX TASK: DangerActionGuard — 危险操作统一确认组件

**优先级：P1**  
**来源借鉴：Radix UI AlertDialog 最佳实践（生产级危险操作保护）**  
**参考分析：`docs/RADIX_PRIMITIVES_BORROWING_ANALYSIS.md` 第三节 3.1**

---

## 背景

Radix AlertDialog 与普通 Dialog 的核心区别：危险操作确认框不可意外关闭（点击遮罩无效、Esc 无效），默认焦点在"取消"按钮防止误触，屏幕阅读器朗读警告文本。

我们的 Operations Console 有大量危险操作（废弃龙虾/删除工作流/全局熔断/清除数据），当前各处实现不统一，缺少：
- 影响范围说明（受影响 N 家租户）
- 输入确认文字（高风险操作需手动输入 "DELETE"）
- 操作中的 loading 状态
- 操作完成的反馈

---

## 任务目标

新建 `web/src/components/DangerActionGuard.tsx` — 统一危险操作确认组件，并在所有危险操作场景中替换现有实现。

---

## 一、核心组件：`DangerActionGuard.tsx`

```typescript
// web/src/components/DangerActionGuard.tsx

'use client';

import { useState, useRef } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';

// ============================================================
// 类型定义
// ============================================================

export interface DangerActionGuardProps {
  /** 触发危险操作的元素（通常是一个红色按钮）*/
  trigger: React.ReactNode;
  
  /** 危险操作标题（简短，如"废弃龙虾"）*/
  title: string;
  
  /** 危险描述（详细说明后果，如"此操作不可逆..."）*/
  description: string;
  
  /** 受影响实体数量（如 32 家租户）*/
  affectedCount?: number;
  
  /** 受影响实体类型（如"租户"、"工作流"）*/
  affectedType?: string;
  
  /** 
   * 高风险确认：用户需要手动输入此文字才能确认
   * 留空则无需输入确认
   * 示例：confirmText="DELETE" 或 confirmText="龙虾名称"
   */
  confirmText?: string;
  
  /** 确认按钮文字（默认："确认删除"）*/
  confirmLabel?: string;
  
  /** 确认回调（异步，成功时 resolve，失败时 reject）*/
  onConfirm: () => Promise<void>;
  
  /** 操作完成后的成功提示（默认："操作已完成"）*/
  successMessage?: string;
  
  /** 是否禁用触发器（如 loading 状态）*/
  disabled?: boolean;
}

// ============================================================
// 主组件
// ============================================================

export function DangerActionGuard({
  trigger,
  title,
  description,
  affectedCount,
  affectedType = '实体',
  confirmText,
  confirmLabel = '确认',
  onConfirm,
  successMessage = '操作已完成',
  disabled = false,
}: DangerActionGuardProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  
  // 是否可以确认（有 confirmText 时必须输入完整）
  const canConfirm = !confirmText || inputValue === confirmText;
  
  const handleConfirm = async () => {
    if (!canConfirm) return;
    
    setLoading(true);
    try {
      await onConfirm();
      setOpen(false);
      setInputValue('');
      toast({
        title: '✅ ' + successMessage,
        duration: 3000,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '操作失败，请重试';
      toast({
        title: '❌ 操作失败',
        description: message,
        variant: 'destructive',
        duration: 5000,
      });
    } finally {
      setLoading(false);
    }
  };
  
  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      // 关闭时重置输入
      setInputValue('');
    }
    setOpen(newOpen);
  };
  
  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogTrigger asChild disabled={disabled}>
        {trigger}
      </AlertDialogTrigger>
      
      <AlertDialogContent
        className="max-w-md"
        // AlertDialog 默认不允许点击遮罩关闭
        // Radix AlertDialog 的 onPointerDownOutside 默认 preventDefault
      >
        <AlertDialogHeader>
          {/* 危险图标 + 标题 */}
          <AlertDialogTitle className="flex items-center gap-2 text-destructive">
            <span className="text-xl">⚠️</span>
            {title}
          </AlertDialogTitle>
          
          {/* 危险描述 */}
          <AlertDialogDescription className="text-sm text-foreground leading-relaxed">
            {description}
          </AlertDialogDescription>
        </AlertDialogHeader>
        
        {/* 影响范围提示 */}
        {affectedCount !== undefined && affectedCount > 0 && (
          <div className="my-2 flex items-center gap-2 rounded-md bg-destructive/10 border border-destructive/20 px-3 py-2">
            <span className="text-destructive text-sm font-medium">影响范围：</span>
            <Badge variant="destructive">{affectedCount} 个{affectedType}</Badge>
            <span className="text-sm text-muted-foreground">将受到影响</span>
          </div>
        )}
        
        {/* 高风险：输入确认文字 */}
        {confirmText && (
          <div className="my-3 space-y-2">
            <Label className="text-sm text-muted-foreground">
              请输入 <code className="bg-muted px-1.5 py-0.5 rounded text-destructive font-mono font-bold">{confirmText}</code> 以确认此操作：
            </Label>
            <Input
              ref={inputRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder={confirmText}
              className={cn(
                'font-mono',
                inputValue && inputValue !== confirmText && 'border-destructive focus-visible:ring-destructive'
              )}
              aria-label={`输入 ${confirmText} 以确认操作`}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        )}
        
        <AlertDialogFooter>
          {/* 取消按钮（默认焦点，防止误触确认）*/}
          <AlertDialogCancel disabled={loading}>
            取消
          </AlertDialogCancel>
          
          {/* 确认按钮（危险红色）*/}
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault(); // 阻止 AlertDialog 自动关闭，由我们手动控制
              handleConfirm();
            }}
            disabled={!canConfirm || loading}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                执行中...
              </span>
            ) : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

---

## 二、使用场景示例

### 2.1 废弃龙虾（lifecycle → deprecated）

```typescript
// 龙虾详情页 Config 标签（LobsterConfigTab.tsx）

<DangerActionGuard
  trigger={
    <Button variant="destructive" size="sm">
      🚫 废弃此龙虾
    </Button>
  }
  title="废弃龙虾：墨小雅（InkWriter）"
  description="此操作不可逆。墨小雅将在 30 天后正式下线，届时所有工作流中的 inkwriter 步骤将自动跳过或失败。建议提前通知受影响租户迁移到替代方案。"
  affectedCount={32}
  affectedType="租户"
  confirmText="DEPRECATE"
  confirmLabel="确认废弃"
  successMessage="龙虾已标记为废弃，将在30天后下线"
  onConfirm={async () => {
    await api.put(`/api/v1/lobsters/${lobster.id}/lifecycle`, {
      new_lifecycle: 'deprecated',
      reason: '运营决策下线'
    });
  }}
/>
```

### 2.2 删除工作流

```typescript
<DangerActionGuard
  trigger={<Button variant="ghost" size="sm" className="text-destructive">🗑 删除</Button>}
  title={`删除工作流：${workflow.name}`}
  description="删除后不可恢复。所有使用此工作流的定时任务将立即停止运行。"
  affectedCount={workflow.subscriber_count}
  affectedType="定时任务"
  confirmText="DELETE"
  confirmLabel="删除工作流"
  successMessage="工作流已删除"
  onConfirm={async () => {
    await api.delete(`/api/v1/workflows/${workflow.id}`);
    router.push('/workflows');
  }}
/>
```

### 2.3 全局龙虾紧急熔断（Feature Flag 总开关）

```typescript
<DangerActionGuard
  trigger={
    <Button variant="destructive" className="w-full">
      🚨 紧急关闭所有龙虾
    </Button>
  }
  title="紧急关闭所有龙虾"
  description="此操作将立即停止所有龙虾的任务执行，所有在线租户将无法使用 AI 功能。请仅在出现严重故障时使用此功能。"
  affectedCount={onlineTenantCount}
  affectedType="在线租户"
  confirmText="EMERGENCY STOP"
  confirmLabel="确认紧急关闭"
  successMessage="所有龙虾已紧急关闭，请尽快排查故障"
  onConfirm={async () => {
    await api.post('/api/v1/feature-flags/lobster.pool.all_enabled/disable');
  }}
/>
```

### 2.4 删除渠道账号（绑定了发布计划）

```typescript
<DangerActionGuard
  trigger={<DropdownMenuItem className="text-destructive">删除账号</DropdownMenuItem>}
  title={`删除渠道账号：${account.name}`}
  description={`此账号已绑定 ${account.schedule_count} 个发布计划，删除后这些计划将停止执行。`}
  affectedCount={account.schedule_count}
  affectedType="发布计划"
  // 无 confirmText = 低风险，点击确认即可
  confirmLabel="删除账号"
  successMessage="渠道账号已删除"
  onConfirm={async () => {
    await api.delete(`/api/v1/channels/${account.id}`);
  }}
/>
```

### 2.5 GDPR 数据删除（租户申请注销）

```typescript
<DangerActionGuard
  trigger={<Button variant="destructive">删除我的所有数据</Button>}
  title="永久删除账户数据"
  description="所有数据（工作流、渠道账号、执行记录、龙虾配置）将被永久删除，无法恢复。此操作将在 24 小时内完成处理。"
  confirmText={tenant.name}  // 输入租户名称确认
  confirmLabel="永久删除"
  successMessage="数据删除申请已提交，24小时内完成"
  onConfirm={async () => {
    await api.post(`/api/v1/tenants/${tenant.id}/gdpr-delete`);
    signOut();
  }}
/>
```

---

## 三、集成到所有危险操作入口

需要全局替换以下场景的现有确认逻辑（统一使用 DangerActionGuard）：

```
搜索关键词：确认是否要删除 / window.confirm / confirm( / 删除后不可恢复
替换为：<DangerActionGuard ... />
```

**需要集成的页面/组件清单：**
- [ ] 龙虾详情页 Config 标签 → 废弃龙虾
- [ ] 工作流列表 → 删除工作流
- [ ] 渠道账号列表 → 删除账号
- [ ] 边缘节点管理 → 强制断开节点
- [ ] Feature Flag 面板 → 全局熔断开关
- [ ] 租户管理 → 删除租户
- [ ] 审计日志 → 清除日志（超管功能）

---

## 四、TypeScript 类型文件

导出类型供其他组件使用：

```typescript
// web/src/components/DangerActionGuard.tsx 已包含类型定义

// 全局导出（web/src/components/index.ts 或 web/src/lib/danger.ts）
export { DangerActionGuard } from './DangerActionGuard';
export type { DangerActionGuardProps } from './DangerActionGuard';
```

---

## 五、PROJECT_CONTROL_CENTER.md 同步更新

完成后：

1. **第十节"前端对齐索引"** 增加：
   ```
   | 危险操作确认 | onConfirm: () => Promise<void> | DangerActionGuardProps | DangerActionGuard | ✅ |
   ```

2. **第七节"已落地借鉴清单"** 增加：
   ```
   | Radix UI Primitives | DangerActionGuard 统一危险操作确认（AlertDialog 最佳实践）| ✅ | DangerActionGuard.tsx |
   ```

---

## 验收标准

- [ ] `DangerActionGuard.tsx` 实现完整
- [ ] AlertDialog 点击遮罩和 Esc 均不可关闭
- [ ] 默认焦点在"取消"按钮
- [ ] 有 `confirmText` 时，输入不匹配则确认按钮禁用
- [ ] 确认中显示 loading spinner（确认按钮和取消按钮均禁用）
- [ ] 成功时 Toast 通知
- [ ] 失败时 destructive Toast 通知
- [ ] 关闭时 input 自动重置
- [ ] 5个使用示例全部可以复制使用（废弃龙虾/删除工作流/全局熔断/删除渠道/GDPR删除）
- [ ] 龙虾详情页至少集成1处 DangerActionGuard

---

*Codex Task | 来源：RADIX_PRIMITIVES_BORROWING_ANALYSIS.md P1-#1 | 2026-04-02*
