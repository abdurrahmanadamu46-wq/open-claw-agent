'use client';

import { Line, LineChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

export function CostChart({
  data,
}: {
  data: Array<{ hour: string; cost: number }>;
}) {
  return (
    <div className="h-[280px] rounded-2xl border border-white/8 bg-gray-900/60 p-4">
      <div className="mb-3 text-sm font-semibold text-gray-100">成本趋势</div>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.12)" />
          <XAxis dataKey="hour" tick={{ fill: '#94a3b8', fontSize: 11 }} tickFormatter={(value) => String(value).slice(11, 16)} />
          <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} />
          <Tooltip
            contentStyle={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12 }}
            labelStyle={{ color: '#e2e8f0' }}
          />
          <Line type="monotone" dataKey="cost" stroke="#f59e0b" strokeWidth={2.5} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
