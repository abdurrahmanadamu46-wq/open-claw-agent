'use client';

import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'danger' | 'ghost';

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  variant?: Variant;
};

export function Button({
  children,
  disabled,
  variant = 'primary',
  className = '',
  type = 'button',
  ...rest
}: Props) {
  const base =
    'inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50';
  const variants: Record<Variant, string> = {
    primary: 'text-white shadow-md hover:translate-y-[-1px] hover:shadow-lg',
    danger: 'bg-[var(--claw-rust)] text-amber-50 hover:opacity-90',
    ghost:
      'border border-[var(--claw-caramel)] bg-transparent text-[var(--claw-caramel)] hover:bg-[var(--claw-gradient-soft)]',
  };
  const style = variant === 'primary' ? { background: 'var(--claw-gradient)' } : undefined;

  return (
    <button
      type={type}
      disabled={disabled}
      className={`${base} ${variants[variant]} ${className}`}
      style={style}
      {...rest}
    >
      {children}
    </button>
  );
}
