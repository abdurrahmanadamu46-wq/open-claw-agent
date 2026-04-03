'use client';

export function Progress({
  value,
  className = '',
  indicatorClassName = '',
}: {
  value: number;
  className?: string;
  indicatorClassName?: string;
}) {
  const v = Math.min(100, Math.max(0, value));
  return (
    <div
      className={`h-2 w-full overflow-hidden rounded-full ${className}`}
      style={{ backgroundColor: 'rgba(255,255,255,0.08)' }}
    >
      <div
        className={`h-full rounded-full transition-all duration-300 ${indicatorClassName}`}
        style={{
          width: `${v}%`,
          background:
            v >= 85
              ? 'linear-gradient(90deg, #ef4444, #fb7185)'
              : v >= 60
                ? 'linear-gradient(90deg, #e5a93d, #f59e0b)'
                : 'linear-gradient(90deg, #22c55e, #34d399)',
        }}
      />
    </div>
  );
}
