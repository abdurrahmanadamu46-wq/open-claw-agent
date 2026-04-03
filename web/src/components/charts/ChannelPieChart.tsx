'use client';

import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts';
import { ChartContainer, ChartLegend, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';

export function ChannelPieChart({
  data,
  title = '渠道平台分布',
}: {
  data: Array<{ platform: string; count: number }>;
  title?: string;
}) {
  const config = Object.fromEntries(
    data.map((item, index) => [
      item.platform,
      { label: item.platform, color: ['#22d3ee', '#f59e0b', '#34d399', '#fb7185', '#a78bfa', '#60a5fa'][index % 6] },
    ]),
  ) as ChartConfig;

  return (
    <div className="rounded-[24px] border border-white/10 bg-white/[0.04] p-5">
      <div className="mb-4 text-lg font-semibold text-white">{title}</div>
      <ChartContainer config={config} className="h-[280px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <ChartTooltip content={<ChartTooltipContent hideLabel />} />
            <ChartLegend />
            <Pie data={data} dataKey="count" nameKey="platform" cx="50%" cy="50%" innerRadius={56} outerRadius={88} paddingAngle={3}>
              {data.map((entry, index) => (
                <Cell key={entry.platform} fill={config[entry.platform]?.color || ['#22d3ee', '#f59e0b'][index % 2]} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
      </ChartContainer>
    </div>
  );
}
