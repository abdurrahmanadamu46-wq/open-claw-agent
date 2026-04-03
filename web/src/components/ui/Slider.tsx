'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

export function Slider({
  min = 0,
  max = 100,
  step = 1,
  value,
  onValueChange,
  className,
  'aria-label': ariaLabel,
}: {
  min?: number;
  max?: number;
  step?: number;
  value: number[];
  onValueChange: (value: number[]) => void;
  className?: string;
  'aria-label'?: string;
}) {
  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value[0] ?? min}
      aria-label={ariaLabel}
      onChange={(event) => onValueChange([Number(event.target.value)])}
      className={cn('h-2 w-full cursor-pointer accent-cyan-400', className)}
    />
  );
}
