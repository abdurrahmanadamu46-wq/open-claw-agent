'use client';

import { DangerActionGuard } from '@/components/DangerActionGuard';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/ContextMenu';
import type { RemoteNode } from '@/types';
import { triggerErrorToast, triggerSuccessToast } from '@/services/api';

export function EdgeNodeContextMenu({
  node,
  children,
  onRefresh,
  onOpenTerminal,
  onDispatch,
  onForceOffline,
}: {
  node: RemoteNode;
  children: React.ReactNode;
  onRefresh?: () => void | Promise<void>;
  onOpenTerminal: () => void;
  onDispatch: () => Promise<void> | void;
  onForceOffline: () => Promise<void> | void;
}) {
  const copyToClipboard = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      triggerSuccessToast(`已复制${label}`);
    } catch {
      triggerErrorToast(`复制${label}失败`);
    }
  };

  const refresh = async () => {
    await onRefresh?.();
    triggerSuccessToast('节点状态已刷新');
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-60">
        <ContextMenuItem onSelect={() => onOpenTerminal()}>
          📜 查看实时日志 / 终端
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => void onDispatch()}>
          ▶ 下发演示任务
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => void refresh()}>
          🔄 刷新节点状态
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => void copyToClipboard(node.nodeId, '节点 ID')}>
          📋 复制节点 ID
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => void copyToClipboard(node.tenantId || '', '租户 ID')}>
          🏷 复制租户 ID
        </ContextMenuItem>
        <ContextMenuSeparator />
        {node.status !== 'OFFLINE' ? (
          <DangerActionGuard
            trigger={
              <ContextMenuItem
                className="text-rose-300 focus:bg-rose-500/10 focus:text-rose-200"
                onSelect={(event) => event.preventDefault()}
              >
                ⛔ 强制下线
              </ContextMenuItem>
            }
            title={`强制下线节点：${node.clientName}`}
            description="节点下线后，当前运行中的任务可能中断。建议先查看终端输出或确认没有关键任务在执行。"
            confirmLabel="确认下线"
            successMessage="节点已强制下线"
            onConfirm={async () => {
              await onForceOffline();
            }}
          />
        ) : null}
      </ContextMenuContent>
    </ContextMenu>
  );
}
