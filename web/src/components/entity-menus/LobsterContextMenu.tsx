'use client';

import { useRouter } from 'next/navigation';
import { DangerActionGuard } from '@/components/DangerActionGuard';
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
} from '@/components/ui/ContextMenu';
import { executeLobster, updateLobsterLifecycle } from '@/services/endpoints/ai-subservice';
import type { Lifecycle, LobsterStatus } from '@/types/lobster';
import { triggerErrorToast, triggerSuccessToast } from '@/services/api';

type LobsterContextTarget = {
  id: string;
  name: string;
  display_name?: string;
  lifecycle?: Lifecycle;
  status?: LobsterStatus | string;
  affected_tenant_count?: number;
};

export function LobsterContextMenu({
  lobster,
  children,
  onRefresh,
}: {
  lobster: LobsterContextTarget;
  children: React.ReactNode;
  onRefresh?: () => void | Promise<void>;
}) {
  const router = useRouter();
  const displayName = lobster.display_name || lobster.name;
  const lifecycle = lobster.lifecycle || 'production';
  const isUnavailable = lifecycle === 'deprecated' || lobster.status === 'offline';

  const refresh = async () => {
    await onRefresh?.();
  };

  const copyToClipboard = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      triggerSuccessToast(`已复制${label}`);
    } catch {
      triggerErrorToast(`复制${label}失败`);
    }
  };

  const handleRun = async () => {
    try {
      if (isUnavailable) return;
      const prompt = window.prompt(`要让 ${displayName} 立即执行什么任务？`, '请先输出当前状态与建议动作');
      if (!prompt?.trim()) return;
      const result = await executeLobster(lobster.id, {
        prompt: prompt.trim(),
        session_mode: 'per-peer',
      });
      if (!result.ok || result.error) {
        throw new Error(result.error || '执行失败');
      }
      triggerSuccessToast(`${displayName} 已开始执行`);
    } catch (error) {
      triggerErrorToast(error instanceof Error ? error.message : '龙虾执行失败');
    }
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-60">
        <ContextMenuItem disabled={isUnavailable} onSelect={() => void handleRun()}>
          ▶ 立即执行
          <ContextMenuShortcut>Ctrl+R</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => router.push(`/lobsters/${lobster.id}`)}>
          👀 查看详情
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => router.push(`/lobsters/${lobster.id}?tab=config`)}>
          ⚙ 进入配置
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => router.push(`/lobsters/${lobster.id}?tab=runs`)}>
          📊 查看运行记录
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuSub>
          <ContextMenuSubTrigger>📋 复制</ContextMenuSubTrigger>
          <ContextMenuSubContent>
            <ContextMenuItem onSelect={() => void copyToClipboard(lobster.id, '龙虾 ID')}>
              复制龙虾 ID
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => void copyToClipboard(displayName, '龙虾名称')}>
              复制龙虾名称
            </ContextMenuItem>
            <ContextMenuItem
              onSelect={() =>
                void copyToClipboard(`${window.location.origin}/api/v1/lobsters/${lobster.id}`, 'API 端点')
              }
            >
              复制 API 端点
            </ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSeparator />
        {lifecycle !== 'deprecated' ? (
          <DangerActionGuard
            trigger={
              <ContextMenuItem
                className="text-rose-300 focus:bg-rose-500/10 focus:text-rose-200"
                onSelect={(event) => event.preventDefault()}
              >
                ⛔ 废弃此龙虾
              </ContextMenuItem>
            }
            title={`废弃龙虾：${displayName}`}
            description={`${displayName} 将进入 deprecated 状态，新任务会停止调度。请先确认替代方案与受影响租户。`}
            affectedCount={lobster.affected_tenant_count}
            affectedType="租户"
            confirmText="DEPRECATE"
            confirmLabel="确认废弃"
            successMessage={`${displayName} 已标记为废弃`}
            onConfirm={async () => {
              await updateLobsterLifecycle(lobster.id, {
                new_lifecycle: 'deprecated',
                reason: 'context_menu_deprecate',
              });
              await refresh();
            }}
          />
        ) : null}
      </ContextMenuContent>
    </ContextMenu>
  );
}
