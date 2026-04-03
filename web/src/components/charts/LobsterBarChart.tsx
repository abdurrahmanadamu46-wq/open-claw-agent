'use client';

import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, XAxis, YAxis } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';

const COLORS = ['#22d3ee', '#f59e0b', '#34d399', '#fb7185', '#a78bfa', '#60a5fa'];

export function LobsterBarChart({
  data,
  title = '各龙虾执行量对比',
}: {
  data: Array<{ display_name: string; runs: number }>;
  title?: string;
}) {
  return (
    <div className="rounded-[24px] border border-white/10 bg-white/[0.04] p-5">
      <div className="mb-4 text-lg font-semibold text-white">{title}</div>
      <ChartContainer config={{}} className="h-[280px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.14)" vertical={false} />
            <XAxis dataKey="display_name" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} angle={-24} textAnchor="end" height={56} />
            <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
            <ChartTooltip content={<ChartTooltipContent hideLabel />} />
            <Bar dataKey="runs" name="执行次数" radius={[8, 8, 0, 0]}>
              {data.map((_, index) => (
                <Cell key={index} fill={COLORS[index % COLORS.length]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </ChartContainer>
    </div>
  );
}
