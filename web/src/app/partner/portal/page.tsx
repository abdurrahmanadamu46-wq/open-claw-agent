'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Building2, Palette, Percent, Users } from 'lucide-react';
import { MainlineStageHeader } from '@/components/business/MainlineStageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import {
  confirmPartnerStatement,
  createPartnerSubAgent,
  disputePartnerStatement,
  fetchPartnerDashboard,
  fetchPartnerSeats,
  fetchPartnerStatements,
  fetchPartnerSubAgentTree,
  updatePartnerWhiteLabel,
} from '@/services/endpoints/partner';
import { triggerErrorToast, triggerSuccessToast } from '@/services/api';

export default function PartnerPortalPage() {
  const [agentId, setAgentId] = useState('agent_demo');
  const dashboardQuery = useQuery({
    queryKey: ['partner', 'dashboard', agentId],
    queryFn: () => fetchPartnerDashboard(agentId),
    enabled: agentId.trim().length > 0,
  });
  const seatsQuery = useQuery({
    queryKey: ['partner', 'seats', agentId],
    queryFn: () => fetchPartnerSeats(agentId),
    enabled: agentId.trim().length > 0,
  });
  const treeQuery = useQuery({
    queryKey: ['partner', 'sub-agents', agentId],
    queryFn: () => fetchPartnerSubAgentTree(agentId),
    enabled: agentId.trim().length > 0,
  });
  const statementsQuery = useQuery({
    queryKey: ['partner', 'statements', agentId],
    queryFn: () => fetchPartnerStatements(agentId),
    enabled: agentId.trim().length > 0,
  });

  const dashboard = dashboardQuery.data?.dashboard;
  const seats = seatsQuery.data?.items ?? [];
  const subAgents = treeQuery.data?.tree.children ?? [];
  const statements = statementsQuery.data?.items ?? [];
  const financeMax = Math.max(
    1,
    dashboard?.platform_cost ?? 0,
    dashboard?.monthly_revenue ?? 0,
    dashboard?.estimated_net_profit ?? 0,
  );
  const kpis = useMemo(
    () => [
      { label: '管理席位', value: `${dashboard?.active_seats ?? 0}/${dashboard?.total_seats ?? 0}`, icon: <Users className="h-4 w-4 text-cyan-300" /> },
      { label: '本月净利', value: `¥${(dashboard?.estimated_net_profit ?? 0).toLocaleString('zh-CN')}`, icon: <Percent className="h-4 w-4 text-emerald-300" /> },
      { label: '白标品牌', value: String(dashboard?.white_label?.brand_name ?? '-'), icon: <Palette className="h-4 w-4 text-amber-300" /> },
      { label: '子代理', value: String(subAgents.length), icon: <Building2 className="h-4 w-4 text-violet-300" /> },
    ],
    [dashboard, subAgents.length],
  );

  async function handleSaveBrand() {
    if (!dashboard?.white_label) return;
    try {
      await updatePartnerWhiteLabel(agentId, {
        brand_name: dashboard.white_label.brand_name,
        primary_color: dashboard.white_label.primary_color,
        logo_url: dashboard.white_label.logo_url,
        lobster_names: dashboard.white_label.lobster_names,
      });
      triggerSuccessToast('白标配置已更新');
      await dashboardQuery.refetch();
    } catch (error) {
      triggerErrorToast(error instanceof Error ? error.message : '白标更新失败');
    }
  }

  async function handleCreateSubAgent() {
    try {
      await createPartnerSubAgent(agentId, {
        company_name: '新子代理',
        contact_name: '待填写',
        region: '待分配区域',
        allocated_seats: 5,
      });
      triggerSuccessToast('子代理已创建');
      await treeQuery.refetch();
    } catch (error) {
      triggerErrorToast(error instanceof Error ? error.message : '子代理创建失败');
    }
  }

  async function handleConfirmStatement(period: string) {
    try {
      await confirmPartnerStatement(agentId, period, 'portal_user');
      triggerSuccessToast('对账单已确认');
      await statementsQuery.refetch();
    } catch (error) {
      triggerErrorToast(error instanceof Error ? error.message : '确认失败');
    }
  }

  async function handleDisputeStatement(period: string) {
    try {
      await disputePartnerStatement(agentId, period, '需要复核本月活跃席位数');
      triggerSuccessToast('已提交争议');
      await statementsQuery.refetch();
    } catch (error) {
      triggerErrorToast(error instanceof Error ? error.message : '争议提交失败');
    }
  }

  return (
    <div className="space-y-6 p-6">
      <MainlineStageHeader
        currentKey="commercial"
        step="代理经营台"
        title="Partner Portal"
        description="聚合席位、利润、白标与子代理，给 20+ 席代理一套可直接经营的后台。"
      />

      <Card>
        <CardHeader>
          <CardTitle>代理查询</CardTitle>
        </CardHeader>
        <CardContent className="flex gap-3">
          <Input value={agentId} onChange={(e) => setAgentId(e.target.value)} placeholder="agent_xxx" />
          <Button onClick={() => { void dashboardQuery.refetch(); void seatsQuery.refetch(); void treeQuery.refetch(); }}>
            刷新
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-4">
        {kpis.map((item) => (
          <Card key={item.label}>
            <CardContent className="flex items-center justify-between p-5">
              <div>
                <div className="text-xs text-slate-400">{item.label}</div>
                <div className="mt-2 text-lg font-semibold text-white">{item.value}</div>
              </div>
              {item.icon}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.3fr_0.7fr]">
        <Card>
          <CardHeader><CardTitle>席位列表</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {seats.length === 0 ? <div className="text-sm text-slate-400">暂无席位数据</div> : seats.map((seat) => (
              <div key={seat.seat_id} className="rounded-2xl border border-white/10 p-4 text-sm text-slate-200">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium text-white">{seat.seat_name || seat.seat_id}</div>
                    <div className="text-xs text-slate-400">{seat.platform || '未绑定平台'} / {seat.client_name || '未分配客户'}</div>
                  </div>
                  <div className="rounded-full bg-slate-900 px-3 py-1 text-xs">{seat.overall_health}</div>
                </div>
                <div className="mt-3 grid gap-2 md:grid-cols-3">
                  {Object.entries(seat.quotas).slice(0, 3).map(([key, quota]) => (
                    <div key={key} className="rounded-xl bg-slate-950/60 px-3 py-2 text-xs">
                      <div className="text-slate-400">{key}</div>
                      <div className="mt-1 text-white">{quota.used}/{quota.limit} ({quota.usage_pct}%)</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>财务 / 白标 / 子代理</CardTitle></CardHeader>
          <CardContent className="space-y-4 text-sm text-slate-200">
            <div className="rounded-2xl border border-white/10 p-4">
              <div className="text-xs text-slate-400">采购成本 vs 转售收入</div>
              <div className="mt-3 space-y-3">
                <BarRow label="采购成本" value={dashboard?.platform_cost ?? 0} maxValue={financeMax} color="bg-rose-400/70" />
                <BarRow label="转售收入" value={dashboard?.monthly_revenue ?? 0} maxValue={financeMax} color="bg-cyan-400/70" />
                <BarRow label="预估净利" value={dashboard?.estimated_net_profit ?? 0} maxValue={financeMax} color="bg-emerald-400/70" />
              </div>
            </div>
            <div className="rounded-2xl border border-white/10 p-4">
              <div className="text-xs text-slate-400">品牌名</div>
              <div className="mt-2 font-medium text-white">{dashboard?.white_label?.brand_name ?? '-'}</div>
              <div className="mt-2 text-xs text-slate-400">主题色：{dashboard?.white_label?.primary_color ?? '-'}</div>
              <Button className="mt-3 w-full" onClick={() => void handleSaveBrand()}>保存白标配置</Button>
            </div>
            <div className="rounded-2xl border border-white/10 p-4">
              <div className="flex items-center justify-between">
                <div className="font-medium text-white">子代理</div>
                <Button variant="ghost" onClick={() => void handleCreateSubAgent()}>新增</Button>
              </div>
              <div className="mt-3 space-y-2">
                {subAgents.length === 0 ? <div className="text-xs text-slate-500">暂无子代理</div> : subAgents.map((item) => (
                  <div key={item.sub_agent_id} className="rounded-xl bg-slate-950/60 px-3 py-2 text-xs">
                    <div className="text-white">{item.company_name}</div>
                    <div className="text-slate-400">{item.region} / {item.allocated_seats} 席</div>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>月度对账单</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm text-slate-200">
          {statements.length === 0 ? (
            <div className="text-slate-400">暂无月度对账单，可由平台侧先触发一次结算。</div>
          ) : statements.map((stmt) => (
            <div key={stmt.id} className="rounded-2xl border border-white/10 p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="font-medium text-white">{stmt.period}</div>
                  <div className="mt-1 text-xs text-slate-400">
                    管理 {stmt.seats_purchased} 席 / 活跃 {stmt.seats_active} 席 / 净利 ¥{stmt.net_profit.toLocaleString('zh-CN')}
                  </div>
                  <div className="mt-2 text-xs text-slate-400">
                    平台成本 ¥{stmt.total_purchase_cost.toLocaleString('zh-CN')} / 转售收入 ¥{stmt.total_resell_revenue.toLocaleString('zh-CN')}
                  </div>
                  {stmt.bonus_achieved ? (
                    <div className="mt-2 rounded-full bg-amber-400/10 px-3 py-1 text-xs text-amber-200">{stmt.bonus_description}</div>
                  ) : null}
                </div>
                <div className="space-y-2 text-right">
                  <div className="text-xs text-slate-400">{stmt.status}</div>
                  {stmt.status === 'calculated' ? (
                    <div className="flex gap-2">
                      <Button onClick={() => void handleConfirmStatement(stmt.period)}>确认</Button>
                      <Button variant="ghost" onClick={() => void handleDisputeStatement(stmt.period)}>争议</Button>
                    </div>
                  ) : null}
                  {stmt.invoice_url ? (
                    <a className="text-xs text-cyan-300 underline" href={stmt.invoice_url} target="_blank" rel="noreferrer">
                      下载发票
                    </a>
                  ) : null}
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function BarRow({ label, value, maxValue, color }: { label: string; value: number; maxValue: number; color: string }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs text-slate-400">
        <span>{label}</span>
        <span>¥{value.toLocaleString('zh-CN')}</span>
      </div>
      <div className="h-2 rounded-full bg-slate-900">
        <div className={`h-2 rounded-full ${color}`} style={{ width: `${Math.min(100, (value / Math.max(1, maxValue)) * 100)}%` }} />
      </div>
    </div>
  );
}
