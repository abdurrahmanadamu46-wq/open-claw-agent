'use client';

import { useRouter } from 'next/navigation';
import { DangerActionGuard } from '@/components/DangerActionGuard';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from '@/components/ui/ContextMenu';
import {
  fetchWorkflowLifecycle,
  startWorkflowRun,
  updateWorkflowLifecycle,
} from '@/services/endpoints/ai-subservice';
import type { WorkflowDefinitionSummary, WorkflowLifecycle } from '@/types/workflow-engine';
import { triggerErrorToast, triggerSuccessToast } from '@/services/api';

type WorkflowContextTarget = WorkflowDefinitionSummary & {
  lifecycle?: WorkflowLifecycle;
};

export function WorkflowContextMenu({
  workflow,
  children,
  onRefresh,
}: {
  workflow: WorkflowContextTarget;
  children: React.ReactNode;
  onRefresh?: () => void | Promise<void>;
}) {
  const router = useRouter();
  const lifecycle = workflow.lifecycle || 'active';

  const refresh = async () => {
    await onRefresh?.();
  };

  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(workflow.id);
      triggerSuccessToast('已复制工作流 ID');
    } catch {
      triggerErrorToast('复制工作流 ID 失败');
    }
  };

  const handleRun = async () => {
    try {
      if (lifecycle !== 'active') return;
      const task = window.prompt(`要让工作流 ${workflow.name} 立即运行什么任务？`, `${workflow.name} 演示执行`);
      if (!task?.trim()) return;
      const result = await startWorkflowRun({
        workflow_id: workflow.id,
        task: task.trim(),
        context: {},
      });
      triggerSuccessToast(`工作流已启动：${result.run_id}`);
    } catch (error) {
      triggerErrorToast(error instanceof Error ? error.message : '工作流启动失败');
    }
  };

  const handleToggleLifecycle = async (nextLifecycle: WorkflowLifecycle) => {
    try {
      await updateWorkflowLifecycle(workflow.id, {
        new_lifecycle: nextLifecycle,
        reason: 'context_menu_toggle',
      });
      await refresh();
      const current = await fetchWorkflowLifecycle(workflow.id);
      triggerSuccessToast(`工作流状态已更新为 ${current.lifecycle}`);
    } catch (error) {
      triggerErrorToast(error instanceof Error ? error.message : '工作流状态更新失败');
    }
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-60">
        <ContextMenuItem disabled={lifecycle !== 'active'} onSelect={() => void handleRun()}>
          ▶ 立即运行
          <ContextMenuShortcut>Enter</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => router.push(`/operations/workflows/${encodeURIComponent(workflow.id)}/executions`)}>
          👀 查看详情
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => void copyId()}>
          📋 复制 ID
        </ContextMenuItem>
        <ContextMenuSeparator />
        {lifecycle === 'active' ? (
          <ContextMenuItem onSelect={() => void handleToggleLifecycle('paused')}>
            ⏸ 暂停工作流
          </ContextMenuItem>
        ) : null}
        {lifecycle === 'paused' ? (
          <ContextMenuItem onSelect={() => void handleToggleLifecycle('active')}>
            ▶ 恢复工作流
          </ContextMenuItem>
        ) : null}
        <ContextMenuItem onSelect={() => router.push(`/operations/workflows/${encodeURIComponent(workflow.id)}/edit`)}>
          ✏ 编辑视图
        </ContextMenuItem>
        <ContextMenuSeparator />
        {lifecycle !== 'archived' ? (
          <DangerActionGuard
            trigger={
              <ContextMenuItem
                className="text-rose-300 focus:bg-rose-500/10 focus:text-rose-200"
                onSelect={(event) => event.preventDefault()}
              >
                🗃 归档工作流
              </ContextMenuItem>
            }
            title={`归档工作流：${workflow.name}`}
            description="归档后该工作流不会再参与新任务编排。现有历史记录保留，但请先确认没有依赖它的人工运营流程。"
            affectedCount={workflow.step_count}
            affectedType="工作流步骤"
            confirmText="ARCHIVE"
            confirmLabel="确认归档"
            successMessage="工作流已归档"
            onConfirm={async () => {
              await updateWorkflowLifecycle(workflow.id, {
                new_lifecycle: 'archived',
                reason: 'context_menu_archive',
              });
              await refresh();
            }}
          />
        ) : null}
      </ContextMenuContent>
    </ContextMenu>
  );
}
