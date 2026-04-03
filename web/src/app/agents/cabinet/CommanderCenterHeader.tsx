'use client';

import { useState, useEffect } from 'react';

const MUTED = 'var(--commander-log-text)';

/** 迷你趋势箭头 SVG */
function TrendArrow({ up }: { up: boolean }) {
  const color = up ? '#34d399' : '#f87171';
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="shrink-0">
      {up ? (
        <path d="M6 9V3M6 3L3 6M6 3l3 3" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <path d="M6 3v6M6 9L3 6M6 9l3-3" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      )}
    </svg>
  );
}

/** 数值 + 迷你趋势 */
function ValueWithTrend({
  value,
  trend,
  valuePrefix = '',
  valueSuffix = '',
}: {
  value: string | number;
  trend: number;
  valuePrefix?: string;
  valueSuffix?: string;
}) {
  const isUp = trend >= 0;
  return (
    <span className="inline-flex items-center gap-1 text-xs">
      <span style={{ color: 'var(--commander-text)' }}>{valuePrefix}{value}{valueSuffix}</span>
      <TrendArrow up={isUp} />
      <span style={{ color: isUp ? '#34d399' : '#f87171' }}>{isUp ? '+' : ''}{trend}%</span>
    </span>
  );
}

function SystemTime() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <span className="font-mono text-sm" style={{ color: 'var(--commander-text)' }}>
      {now.toLocaleTimeString('zh-CN', { hour12: false })}
    </span>
  );
}

export function CommanderCenterHeader() {
  const totalTokensK = 50.5;
  const tokenTrend = 2.1;
  const totalCost = 11.28;
  const costTrend = -0.5;
  const activeCampaign = '双十一美妆矩阵';

  return (
    <header
      className="relative z-10 flex items-center justify-between border-b px-6 py-3"
      style={{
        background: 'var(--commander-header-sidebar-bg)',
        borderColor: 'rgba(255,255,255,0.08)',
        backdropFilter: 'blur(12px)',
      }}
    >
      <div className="flex items-center gap-2">
        <h1
          className="text-lg font-semibold tracking-tight"
          style={{
            background: 'linear-gradient(135deg, #F5C400 0%, #8F5BFB 50%, #00CF92 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
            filter: 'drop-shadow(0 0 8px rgba(245,196,0,0.4))',
          }}
        >
          龙虾智能池 Commander Center
        </h1>
      </div>

      <div className="flex items-center gap-6 text-sm">
        <span className="inline-flex items-center gap-2">
          <span
            className="h-2 w-2 rounded-full animate-pulse"
            style={{ backgroundColor: '#22c55e', boxShadow: '0 0 10px #22c55e, 0 0 20px rgba(34,197,94,0.5)' }}
          />
          <span style={{ color: 'var(--commander-text)' }}>System Operational</span>
        </span>
        <span style={{ color: MUTED }}>战役:</span>
        <span style={{ color: 'var(--commander-brain)' }}>{activeCampaign}</span>
      </div>

      <div className="flex items-center gap-5">
        <span className="inline-flex items-center gap-1.5">
          <span style={{ color: MUTED }}>今日算力</span>
          <ValueWithTrend value={`${totalTokensK}K`} trend={tokenTrend} valueSuffix=" Tokens" />
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span style={{ color: MUTED }}>今日成本</span>
          <ValueWithTrend value={totalCost} trend={costTrend} valuePrefix="¥" />
        </span>
        <span className="inline-flex items-center gap-1.5" style={{ color: MUTED }}>
          Sys Time: <SystemTime />
        </span>
        <div
          className="flex h-8 w-8 items-center justify-center rounded-full border"
          style={{ borderColor: 'rgba(255,255,255,0.2)', color: 'var(--commander-text)' }}
          title="用户"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="8" r="3" />
            <path d="M5 20a7 7 0 0 1 14 0" />
          </svg>
        </div>
      </div>
    </header>
  );
}
