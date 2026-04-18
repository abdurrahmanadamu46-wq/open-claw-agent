import type { ReactNode } from 'react';
import { CheckCircle2, Clock3, XCircle } from 'lucide-react';
import type { GroupCollabRecord, GroupCollabRecordStatus } from '@/services/endpoints/group-collab';

function statusTone(status: GroupCollabRecordStatus) {
  if (status === 'approved' || status === 'confirmed' || status === 'delivered' || status === 'acknowledged') {
    return 'border-emerald-500/25 bg-emerald-500/10 text-emerald-200';
  }
  if (status === 'awaiting_approval' || status === 'awaiting_confirmation' || status === 'sent' || status === 'queued') {
    return 'border-amber-500/25 bg-amber-500/10 text-amber-100';
  }
  if (status === 'failed' || status === 'rejected') {
    return 'border-rose-500/25 bg-rose-500/10 text-rose-100';
  }
  return 'border-white/10 bg-white/[0.04] text-slate-200';
}

function statusLabel(status: GroupCollabRecordStatus) {
  switch (status) {
    case 'queued':
      return '排队中';
    case 'sent':
      return '已发出';
    case 'delivered':
      return '已送达';
    case 'awaiting_approval':
      return '待审批';
    case 'approved':
      return '已审批';
    case 'rejected':
      return '已拒绝';
    case 'awaiting_confirmation':
      return '待确认';
    case 'confirmed':
      return '已确认';
    case 'acknowledged':
      return '已收悉';
    case 'failed':
      return '失败';
    default:
      return status;
  }
}

function statusIcon(status: GroupCollabRecordStatus) {
  if (status === 'approved' || status === 'confirmed' || status === 'delivered' || status === 'acknowledged') {
    return <CheckCircle2 className="h-4 w-4" />;
  }
  if (status === 'failed' || status === 'rejected') {
    return <XCircle className="h-4 w-4" />;
  }
  return <Clock3 className="h-4 w-4" />;
}

export function CollabRecordCard({
  record,
  actions,
}: {
  record: GroupCollabRecord;
  actions?: ReactNode;
}) {
  const targetLabel = record.route.targetName || record.route.chatId || record.route.channelId || '未指定群';
  const latestEvent = record.history[record.history.length - 1];

  return (
    <article className="rounded-2xl border border-white/10 bg-slate-950/35 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-white">{record.title}</div>
          <div className="mt-1 text-xs text-slate-400">
            {record.objectType} / {record.route.provider} / {targetLabel}
          </div>
        </div>
        <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs ${statusTone(record.status)}`}>
          {statusIcon(record.status)}
          {statusLabel(record.status)}
        </span>
      </div>

      <div className="mt-3 text-sm leading-6 text-slate-300">{record.summary}</div>

      {record.receipt ? (
        <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-slate-300">
          回执：{record.receipt.state}
          {record.receipt.detail ? ` / ${record.receipt.detail}` : ''}
        </div>
      ) : (
        <div className="mt-3 rounded-xl border border-dashed border-white/10 bg-white/[0.02] px-3 py-2 text-xs text-slate-500">
          当前还没有回执，说明这条记录只有 dispatch，缺少 thread / receipt 回流。
        </div>
      )}

      {latestEvent ? (
        <div className="mt-3 text-xs text-slate-500">
          最近事件：{latestEvent.eventType} / {latestEvent.status}
        </div>
      ) : null}

      {actions ? <div className="mt-4 flex flex-wrap gap-2">{actions}</div> : null}

      <div className="mt-3 text-xs text-slate-500">trace: {record.traceId}</div>
    </article>
  );
}
