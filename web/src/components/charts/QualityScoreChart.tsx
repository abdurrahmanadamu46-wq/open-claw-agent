'use client';

import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, XAxis, YAxis } from 'recharts';
import { AnnotationLegend, ChartAnnotationLines } from '@/components/charts/ChartAnnotations';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import { useChartAnnotations } from '@/hooks/useChartAnnotations';

const chartConfig = {
  score: { label: '质量评分', color: '#22d3ee' },
} satisfies ChartConfig;

export function QualityScoreChart({
  data,
  title = '质量评分趋势',
  threshold = 7,
  lobsterId,
}: {
  data: Array<{ date: string; score: number }>;
  title?: string;
  threshold?: number;
  lobsterId?: string;
}) {
  const annotationsQuery = useChartAnnotations({
    start_time: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    end_time: new Date().toISOString(),
    lobster_id: lobsterId,
    limit: 100,
  });
  const annotations = annotationsQuery.data?.annotations ?? [];
  return (
    <div className="rounded-[24px] border border-white/10 bg-white/[0.04] p-5">
      <div className="mb-4 text-lg font-semibold text-white">{title}</div>
      <ChartContainer config={chartConfig} className="h-[220px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.14)" />
            <XAxis dataKey="date" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis domain={[0, 10]} tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <ReferenceLine
              y={threshold}
              stroke="#f87171"
              strokeDasharray="4 4"
              label={{ value: `红线 ${threshold}`, fill: '#fda4af', fontSize: 11, position: 'insideTopRight' }}
            />
            <ChartAnnotationLines annotations={annotations} toXAxisValue={(timestamp) => timestamp.slice(5, 10)} />
            <Line type="monotone" dataKey="score" name="质量评分" stroke="var(--color-score)" strokeWidth={2.5} dot={{ r: 3 }} />
          </LineChart>
        </ResponsiveContainer>
      </ChartContainer>
      <AnnotationLegend annotations={annotations} />
    </div>
  );
}
