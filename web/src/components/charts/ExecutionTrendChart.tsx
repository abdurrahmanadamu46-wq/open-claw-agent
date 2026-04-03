'use client';

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, XAxis, YAxis } from 'recharts';
import { AnnotationLegend, ChartAnnotationLines } from '@/components/charts/ChartAnnotations';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import { useChartAnnotations } from '@/hooks/useChartAnnotations';

const chartConfig = {
  runs: { label: '执行次数', color: '#22d3ee' },
  success: { label: '稳定完成', color: '#f59e0b' },
} satisfies ChartConfig;

export function ExecutionTrendChart({
  data,
  title = '执行活跃趋势',
  description,
  lobsterId,
}: {
  data: Array<{ date: string; runs: number; success?: number }>;
  title?: string;
  description?: string;
  lobsterId?: string;
}) {
  const normalized = data.map((item) => ({
    ...item,
    success: typeof item.success === 'number' ? item.success : item.runs,
  }));
  const annotationsQuery = useChartAnnotations({
    start_time: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    end_time: new Date().toISOString(),
    lobster_id: lobsterId,
    limit: 100,
  });
  const annotations = annotationsQuery.data?.annotations ?? [];

  return (
    <div className="rounded-[24px] border border-white/10 bg-white/[0.04] p-5">
      <div className="mb-4">
        <div className="text-lg font-semibold text-white">{title}</div>
        {description ? <p className="mt-1 text-sm text-slate-400">{description}</p> : null}
      </div>
      <ChartContainer config={chartConfig} className="h-[280px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={normalized} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
            <defs>
              <linearGradient id="runsFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--color-runs)" stopOpacity={0.32} />
                <stop offset="95%" stopColor="var(--color-runs)" stopOpacity={0.03} />
              </linearGradient>
              <linearGradient id="successFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--color-success)" stopOpacity={0.24} />
                <stop offset="95%" stopColor="var(--color-success)" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.14)" />
            <XAxis dataKey="date" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <ChartAnnotationLines annotations={annotations} toXAxisValue={(timestamp) => timestamp.slice(5, 10)} />
            <Area type="monotone" dataKey="runs" name="执行次数" stroke="var(--color-runs)" fill="url(#runsFill)" strokeWidth={2} />
            <Area type="monotone" dataKey="success" name="稳定完成" stroke="var(--color-success)" fill="url(#successFill)" strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </ChartContainer>
      <AnnotationLegend annotations={annotations} />
    </div>
  );
}
