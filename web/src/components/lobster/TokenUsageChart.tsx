'use client';

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

export function TokenUsageChart({
  data,
}: {
  data: Array<{ hour: string; input_tokens: number; output_tokens: number }>;
}) {
  return (
    <div className="h-[280px] rounded-2xl border border-white/8 bg-gray-900/60 p-4">
      <div className="mb-3 text-sm font-semibold text-gray-100">Token 用量趋势</div>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data}>
          <defs>
            <linearGradient id="inputFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#22c55e" stopOpacity={0.32} />
              <stop offset="95%" stopColor="#22c55e" stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id="outputFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.32} />
              <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.12)" />
          <XAxis dataKey="hour" tick={{ fill: '#94a3b8', fontSize: 11 }} tickFormatter={(value) => String(value).slice(11, 16)} />
          <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} />
          <Tooltip
            contentStyle={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12 }}
            labelStyle={{ color: '#e2e8f0' }}
          />
          <Area type="monotone" dataKey="input_tokens" stackId="tokens" stroke="#22c55e" fill="url(#inputFill)" />
          <Area type="monotone" dataKey="output_tokens" stackId="tokens" stroke="#3b82f6" fill="url(#outputFill)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
