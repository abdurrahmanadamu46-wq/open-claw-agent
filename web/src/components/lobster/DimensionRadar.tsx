'use client';

import { PolarAngleAxis, PolarGrid, Radar, RadarChart, ResponsiveContainer } from 'recharts';
import type { LobsterScoringDimension } from '@/lib/lobster-api';

export function DimensionRadar({ dimensions }: { dimensions: LobsterScoringDimension[] }) {
  const data = dimensions.map((item) => ({
    subject: item.label,
    score: Math.round(item.score * 100),
  }));

  return (
    <div className="h-[320px] rounded-2xl border border-white/8 bg-gray-900/60 p-4">
      <div className="mb-3 text-sm font-semibold text-gray-100">10 维评分雷达图</div>
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart data={data}>
          <PolarGrid stroke="rgba(148,163,184,0.18)" />
          <PolarAngleAxis dataKey="subject" tick={{ fill: '#cbd5e1', fontSize: 11 }} />
          <Radar dataKey="score" stroke="#22d3ee" fill="#22d3ee" fillOpacity={0.28} />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}
