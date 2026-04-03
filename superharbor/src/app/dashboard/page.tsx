'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useDashboardStore } from '@/store';
import type { EdgeNode } from '@/types';
import { Server, Zap, ListTodo, MapPin } from 'lucide-react';
import { cn } from '@/lib/utils';

const MOCK_NODES: EdgeNode[] = [
  { nodeId: 'node-001', status: 'online', ipOrDeviceId: '192.168.1.101', region: '华东·上海', loadPercent: 23, lastSeenAt: new Date().toISOString() },
  { nodeId: 'node-002', status: 'online', ipOrDeviceId: '192.168.1.102', region: '华南·深圳', loadPercent: 67, lastSeenAt: new Date().toISOString() },
  { nodeId: 'node-003', status: 'offline', ipOrDeviceId: '192.168.1.103', region: '华北·北京', lastSeenAt: new Date(Date.now() - 120000).toISOString() },
];

export default function DashboardPage() {
  const { onlineNodeCount, tokensConsumedToday, tasksDispatchedToday, nodes, setNodes, setMetrics } = useDashboardStore();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setNodes(MOCK_NODES);
    setMetrics({
      onlineNodeCount: MOCK_NODES.filter((n) => n.status === 'online').length,
      tokensConsumedToday: 12480,
      tasksDispatchedToday: 156,
    });
    setMounted(true);
  }, [setNodes, setMetrics]);

  return (
    <div className="p-6">
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight">总览大盘</h1>
        <p className="text-muted-foreground">实时物理节点与今日消耗概览</p>
      </div>

      <div className="mb-8 grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">在线物理节点（可用 IP 数）</CardTitle>
            <Server className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{mounted ? onlineNodeCount : '—'}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">今日已消耗 API Token</CardTitle>
            <Zap className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{mounted ? tokensConsumedToday.toLocaleString() : '—'}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">今日成功派发任务数</CardTitle>
            <ListTodo className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{mounted ? tasksDispatchedToday : '—'}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>边缘节点列表</CardTitle>
          <p className="text-sm text-muted-foreground">连接到底层设备的实时状态</p>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="pb-3 font-medium">节点 ID</th>
                  <th className="pb-3 font-medium">状态</th>
                  <th className="pb-3 font-medium">IP / 设备</th>
                  <th className="pb-3 font-medium">归属地</th>
                  <th className="pb-3 font-medium">当前负载</th>
                </tr>
              </thead>
              <tbody>
                {nodes.map((n) => (
                  <tr key={n.nodeId} className="border-b">
                    <td className="py-3 font-mono">{n.nodeId}</td>
                    <td className="py-3">
                      <span
                        className={cn(
                          'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                          n.status === 'online' ? 'bg-green-500/20 text-green-600 dark:text-green-400' : 'bg-muted text-muted-foreground'
                        )}
                      >
                        {n.status === 'online' ? '在线' : '离线'}
                      </span>
                    </td>
                    <td className="py-3 font-mono">{n.ipOrDeviceId}</td>
                    <td className="py-3">{n.region ?? '—'}</td>
                    <td className="py-3">{n.loadPercent != null ? `${n.loadPercent}%` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
