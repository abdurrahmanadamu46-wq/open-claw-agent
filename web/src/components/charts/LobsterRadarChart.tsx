'use client';

import { PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, ResponsiveContainer } from 'recharts';
import { ChartContainer, ChartLegend, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';

const chartConfig = {
  score: { label: '当前评分', color: '#22d3ee' },
  target: { label: '目标评分', color: '#f59e0b' },
} satisfies ChartConfig;

export function LobsterRadarChart({
  skills,
  title = '技能雷达图',
}: {
  skills: Array<{ skill_name: string; score: number; target?: number }>;
  title?: string;
}) {
  const normalized = skills.map((item) => ({
    skill_name: item.skill_name,
    score: item.score,
    target: item.target ?? Math.max(item.score, 5),
  }));

  return (
    <div className="rounded-[24px] border border-white/10 bg-white/[0.04] p-5">
      <div className="mb-4 text-lg font-semibold text-white">{title}</div>
      <ChartContainer config={chartConfig} className="h-[320px]">
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart data={normalized}>
            <PolarGrid stroke="rgba(148,163,184,0.18)" />
            <PolarAngleAxis dataKey="skill_name" tick={{ fill: '#cbd5e1', fontSize: 11 }} />
            <PolarRadiusAxis angle={90} domain={[0, 5]} tick={{ fill: '#64748b', fontSize: 10 }} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <ChartLegend />
            <Radar name="当前评分" dataKey="score" stroke="var(--color-score)" fill="var(--color-score)" fillOpacity={0.3} />
            <Radar name="目标评分" dataKey="target" stroke="var(--color-target)" fill="var(--color-target)" fillOpacity={0.08} strokeDasharray="4 4" />
          </RadarChart>
        </ResponsiveContainer>
      </ChartContainer>
    </div>
  );
}
