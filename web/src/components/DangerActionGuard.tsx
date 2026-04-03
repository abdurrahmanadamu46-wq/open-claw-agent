'use client';

import { useEffect, useId, useRef, useState } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/AlertDialog';
import { triggerErrorToast, triggerSuccessToast } from '@/services/api';

export interface DangerActionGuardProps {
  trigger: React.ReactNode;
  title: string;
  description: string;
  affectedCount?: number;
  affectedType?: string;
  confirmText?: string;
  confirmLabel?: string;
  successMessage?: string;
  onConfirm: () => Promise<void>;
  disabled?: boolean;
}

export function DangerActionGuard({
  trigger,
  title,
  description,
  affectedCount,
  affectedType = '实体',
  confirmText,
  confirmLabel = '确认',
  successMessage = '操作已完成',
  onConfirm,
  disabled = false,
}: DangerActionGuardProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const inputId = useId();
  const canConfirm = !confirmText || inputValue.trim() === confirmText;

  useEffect(() => {
    if (open) {
      window.setTimeout(() => cancelRef.current?.focus(), 0);
    }
  }, [open]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (loading) return;
    setOpen(nextOpen);
    if (!nextOpen) {
      setInputValue('');
    }
  };

  const handleConfirm = async () => {
    if (!canConfirm || loading) return;
    setLoading(true);
    try {
      await onConfirm();
      triggerSuccessToast(successMessage);
      setOpen(false);
      setInputValue('');
    } catch (error) {
      triggerErrorToast(error instanceof Error ? error.message : '操作失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogTrigger asChild disabled={disabled}>
        {trigger}
      </AlertDialogTrigger>

      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-rose-200">
            <span className="text-xl">⚠</span>
            {title}
          </AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>

        {typeof affectedCount === 'number' && affectedCount > 0 ? (
          <div className="mt-4 rounded-2xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
            影响范围：{affectedCount} 个{affectedType}
          </div>
        ) : null}

        {confirmText ? (
          <div className="mt-4 space-y-2">
            <label htmlFor={inputId} className="block text-sm text-slate-300">
              请输入 <span className="rounded bg-black/30 px-1.5 py-0.5 font-mono text-rose-200">{confirmText}</span> 以确认本次危险操作
            </label>
            <input
              id={inputId}
              value={inputValue}
              onChange={(event) => setInputValue(event.target.value)}
              className="w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 font-mono text-sm text-white outline-none transition focus:border-rose-400/45"
              aria-label={`输入 ${confirmText} 以确认`}
              placeholder={confirmText}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        ) : null}

        <AlertDialogFooter>
          <AlertDialogCancel
            ref={cancelRef}
            disabled={loading}
            className="inline-flex items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-medium text-slate-200 transition hover:bg-white/[0.08] disabled:opacity-50"
          >
            取消
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              event.preventDefault();
              void handleConfirm();
            }}
            disabled={!canConfirm || loading}
            className="inline-flex items-center justify-center rounded-2xl border border-rose-400/20 bg-rose-500 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-rose-400 disabled:opacity-50"
          >
            {loading ? (
              <span className="inline-flex items-center gap-2">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                执行中...
              </span>
            ) : (
              confirmLabel
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
