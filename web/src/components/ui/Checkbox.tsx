'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

export const Checkbox = React.forwardRef<
  HTMLInputElement,
  Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> & {
    indeterminate?: boolean;
  }
>(function Checkbox({ className, indeterminate, ...props }, ref) {
  const innerRef = React.useRef<HTMLInputElement | null>(null);

  React.useImperativeHandle(ref, () => innerRef.current as HTMLInputElement);

  React.useEffect(() => {
    if (innerRef.current) {
      innerRef.current.indeterminate = Boolean(indeterminate);
    }
  }, [indeterminate]);

  return (
    <input
      ref={innerRef}
      type="checkbox"
      className={cn(
        'h-4 w-4 rounded border border-white/20 bg-slate-950/70 text-cyan-400 accent-cyan-400 outline-none focus:ring-2 focus:ring-cyan-400/20',
        className,
      )}
      {...props}
    />
  );
});
