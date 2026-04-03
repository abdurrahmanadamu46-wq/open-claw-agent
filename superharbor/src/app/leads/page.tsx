'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useLeadsStore } from '@/store';
import type { Lead, LeadIntentLevel } from '@/types';
import { Users, Bell } from 'lucide-react';
import { cn } from '@/lib/utils';

const MOCK_LEADS: Lead[] = [
  { id: '1', platform: '小红书', userNickname: '用户A', intentLevel: 'hot', rawContent: '求链接！', capturedAt: new Date().toISOString() },
  { id: '2', platform: '抖音', userNickname: '用户B', intentLevel: 'warm', rawContent: '多少钱？', capturedAt: new Date(Date.now() - 3600000).toISOString() },
  { id: '3', platform: '小红书', userNickname: '用户C', intentLevel: 'cold', capturedAt: new Date(Date.now() - 7200000).toISOString() },
];

const INTENT_MAP: Record<LeadIntentLevel, { label: string; className: string }> = {
  hot: { label: '热', className: 'bg-red-500/20 text-red-600 dark:text-red-400' },
  warm: { label: '温', className: 'bg-amber-500/20 text-amber-600 dark:text-amber-400' },
  cold: { label: '冷', className: 'bg-slate-500/20 text-slate-500' },
};

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = Date.now();
  const diff = now - d.getTime();
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
  return d.toLocaleString('zh-CN');
}

export default function LeadsPage() {
  const { leads, setLeads } = useLeadsStore();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setLeads(MOCK_LEADS);
    setMounted(true);
  }, [setLeads]);

  const handleNotifySales = (lead: Lead) => {
    alert(`已通知销售跟进：${lead.userNickname}（${lead.platform}）`);
  };

  return (
    <div className="p-6">
      <div className="mb-8">
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <Users className="h-7 w-7 text-primary" />
          线索 CRM 库
        </h1>
        <p className="text-muted-foreground">边缘节点抓取的精准意向评论与线索</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>线索列表</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="pb-3 font-medium">平台来源</th>
                  <th className="pb-3 font-medium">用户昵称</th>
                  <th className="pb-3 font-medium">意向等级</th>
                  <th className="pb-3 font-medium">抓取时间</th>
                  <th className="pb-3 font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {mounted && leads.map((lead) => {
                  const intent = INTENT_MAP[lead.intentLevel];
                  return (
                    <tr key={lead.id} className="border-b">
                      <td className="py-3">{lead.platform}</td>
                      <td className="py-3">{lead.userNickname}</td>
                      <td className="py-3">
                        <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', intent.className)}>
                          {intent.label}
                        </span>
                      </td>
                      <td className="py-3 text-muted-foreground">{formatTime(lead.capturedAt)}</td>
                      <td className="py-3">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleNotifySales(lead)}
                          className="gap-1"
                        >
                          <Bell className="h-3.5 w-3.5" />
                          通知销售跟进
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
