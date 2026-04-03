'use client';

import * as React from 'react';

type DialogContextValue = { open: boolean; onOpenChange: (open: boolean) => void };
const DialogContext = React.createContext<DialogContextValue | null>(null);

export function Dialog({
  open,
  onOpenChange,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <DialogContext.Provider value={{ open, onOpenChange }}>
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
        <div
          className="fixed inset-0 bg-black/70 backdrop-blur-sm"
          aria-hidden
          onClick={() => onOpenChange(false)}
        />
        <div className="relative z-[101] w-full max-w-4xl">{children}</div>
      </div>
    </DialogContext.Provider>
  );
}

export function DialogContent({
  className = '',
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`rounded-[28px] border shadow-2xl backdrop-blur-md ${className}`}
      style={{
        backgroundColor: 'var(--claw-surface-strong)',
        borderColor: 'var(--claw-card-border)',
        boxShadow: 'var(--claw-shadow-panel)',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {children}
    </div>
  );
}

export function DialogHeader({ children }: { children: React.ReactNode }) {
  return <div className="border-b px-6 py-5" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>{children}</div>;
}

export function DialogTitle({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <h2 className={`text-lg font-semibold ${className}`.trim()} style={{ color: '#F8FAFC' }}>{children}</h2>;
}

export function DialogClose({ onClose }: { onClose: () => void }) {
  return (
    <button
      type="button"
      onClick={onClose}
      className="absolute right-4 top-4 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm leading-none text-slate-300 transition hover:bg-white/10 hover:text-white"
      aria-label="关闭"
    >
      ×
    </button>
  );
}
