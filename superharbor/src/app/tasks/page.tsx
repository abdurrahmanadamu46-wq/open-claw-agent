'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useCampaignsStore } from '@/store';
import { cn } from '@/lib/utils';
import type { TaskStatus } from '@/types';
import { ListTodo, Clock, Loader2, Send, CheckCircle, XCircle } from 'lucide-react';

const STATUS_MAP: Record<TaskStatus, { label: string; icon: typeof Clock; className: string }> = {
  Pending: { label: '待处理', icon: Clock, className: 'text-muted-foreground' },
  Generating: { label: '生成中', icon: Loader2, className: 'text-amber-500' },
  Dispatching: { label: '下发中', icon: Send, className: 'text-blue-500' },
  Completed: { label: '已完成', icon: CheckCircle, className: 'text-green-500' },
  Failed: { label: '失败', icon: XCircle, className: 'text-destructive' },
};

export default function TaskDispatchPage() {
  const campaigns = useCampaignsStore((s) => s.campaigns);

  return (
    <div className="p-6">
      <div className="mb-8">
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <ListTodo className="h-7 w-7 text-primary" />
          任务调度大厅
        </h1>
        <p className="text-muted-foreground">已创建战役的进度与边缘节点分配情况</p>
      </div>

      <div className="space-y-4">
        {campaigns.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
              <ListTodo className="mb-2 h-10 w-10" />
              <p>暂无战役任务</p>
              <a href="/campaigns/new" className="mt-2 text-primary hover:underline">去创建战役</a>
            </CardContent>
          </Card>
        ) : (
          campaigns.map((c) => {
            const statusMeta = STATUS_MAP[c.status];
            const Icon = statusMeta?.icon ?? Clock;
            return (
              <Card key={c.campaignId}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">{c.campaignName}</CardTitle>
                    <span className={cn('flex items-center gap-1.5 text-sm', statusMeta?.className)}>
                      <Icon className={c.status === 'Generating' ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
                      {statusMeta?.label ?? c.status}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">ID: {c.campaignId}</p>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-muted-foreground">进度</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-secondary">
                      <div
                        className="h-full bg-primary transition-all"
                        style={{ width: `${c.progress}%` }}
                      />
                    </div>
                    <span>{c.progress}%</span>
                  </div>
                  {c.assignedNodeIds && c.assignedNodeIds.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      已分配节点: {c.assignedNodeIds.join(', ')}
                    </p>
                  )}
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}
