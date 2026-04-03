'use client';

import { useEffect, useState } from 'react';
import { History, RefreshCw, Trash2 } from 'lucide-react';
import {
  clearSession,
  fetchSessionHistory,
  fetchSessions,
  type SessionHistoryMessage,
  type SessionSummary,
} from '@/services/endpoints/ai-subservice';

const BORDER = 'rgba(71,85,105,0.42)';
const PANEL_BG = '#16243b';

function formatDateTime(value?: string | null): string {
  if (!value) return '-';
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return value;
  return dt.toLocaleString('zh-CN', {
    hour12: false,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function normalizeAxiosError(error: unknown): string {
  const maybe = error as { response?: { status?: number; data?: { message?: string; detail?: string } }; message?: string };
  const status = maybe?.response?.status;
  const detail = maybe?.response?.data?.message || maybe?.response?.data?.detail;
  if (status && detail) return `请求失败 (${status}): ${detail}`;
  if (status) return `请求失败 (${status})`;
  return maybe?.message || '请求失败';
}

export default function SessionsPage() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [historyBySession, setHistoryBySession] = useState<Record<string, SessionHistoryMessage[]>>({});
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');
  const [errorText, setErrorText] = useState('');

  const load = async () => {
    setLoading(true);
    setErrorText('');
    try {
      const data = await fetchSessions();
      setSessions(data.sessions || []);
      setNotice(`已同步 ${data.count} 个活跃会话。`);
    } catch (error) {
      setErrorText(normalizeAxiosError(error));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const toggleHistory = async (sessionId: string) => {
    if (expandedSessionId === sessionId) {
      setExpandedSessionId(null);
      return;
    }
    setExpandedSessionId(sessionId);
    if (historyBySession[sessionId]) {
      return;
    }
    try {
      const data = await fetchSessionHistory(sessionId, 50);
      setHistoryBySession((prev) => ({ ...prev, [sessionId]: data.messages || [] }));
    } catch (error) {
      setErrorText(normalizeAxiosError(error));
    }
  };

  const handleClear = async (sessionId: string) => {
    try {
      await clearSession(sessionId);
      setNotice(`已清除会话 ${sessionId}。`);
      setHistoryBySession((prev) => {
        const next = { ...prev };
        delete next[sessionId];
        return next;
      });
      if (expandedSessionId === sessionId) {
        setExpandedSessionId(null);
      }
      await load();
    } catch (error) {
      setErrorText(normalizeAxiosError(error));
    }
  };

  return (
    <div className="min-h-[calc(100vh-5rem)] bg-[#07111f] p-6 text-slate-100">
      <div className="mx-auto max-w-6xl space-y-5">
        <section
          className="rounded-[30px] border p-6"
          style={{ background: 'linear-gradient(135deg, rgba(20,34,58,0.98), rgba(11,21,35,0.98))', borderColor: BORDER }}
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-3xl">
              <div className="text-xs uppercase tracking-[0.18em] text-cyan-300">Sessions</div>
              <h1 className="mt-3 text-3xl font-semibold text-white">会话隔离面板</h1>
              <p className="mt-3 text-sm leading-7 text-slate-300">
                查看当前 shared / per-peer / isolated 三种会话模式分别沉淀了哪些上下文，并按需清理。
              </p>
            </div>
            <button
              type="button"
              onClick={() => void load()}
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-600 px-4 py-2 text-sm text-slate-100 hover:bg-slate-800/70"
            >
              <RefreshCw className="h-4 w-4" />
              {loading ? '刷新中...' : '刷新'}
            </button>
          </div>
          {notice ? <div className="mt-4 text-sm text-cyan-200">{notice}</div> : null}
          {errorText ? <div className="mt-4 text-sm text-rose-200">{errorText}</div> : null}
        </section>

        <div className="space-y-3">
          {sessions.map((session) => {
            const expanded = expandedSessionId === session.session_id;
            const history = historyBySession[session.session_id] || [];
            return (
              <article
                key={session.session_id}
                className="rounded-[28px] border p-5"
                style={{ backgroundColor: PANEL_BG, borderColor: BORDER }}
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="flex flex-wrap gap-2">
                      <span className="rounded-full bg-cyan-400/10 px-3 py-1 text-xs text-cyan-200">{session.mode}</span>
                      <span className="rounded-full bg-white/5 px-3 py-1 text-xs text-slate-300">{session.channel}</span>
                      <span className="rounded-full bg-white/5 px-3 py-1 text-xs text-slate-300">{session.lobster_id}</span>
                    </div>
                    <div className="mt-3 text-lg font-semibold text-white">{session.peer_id}</div>
                    <div className="mt-2 text-sm text-slate-400">
                      session_id: {session.session_id} · 消息数 {session.message_count} · 最近活跃 {formatDateTime(session.last_active_at)}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void toggleHistory(session.session_id)}
                      className="inline-flex items-center gap-2 rounded-2xl border border-slate-600 px-4 py-2 text-sm text-slate-100 hover:bg-slate-800/70"
                    >
                      <History className="h-4 w-4" />
                      {expanded ? '收起历史' : '查看历史'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleClear(session.session_id)}
                      className="inline-flex items-center gap-2 rounded-2xl border border-rose-500/40 px-4 py-2 text-sm text-rose-200 hover:bg-rose-500/10"
                    >
                      <Trash2 className="h-4 w-4" />
                      清除
                    </button>
                  </div>
                </div>

                {expanded ? (
                  <div className="mt-4 space-y-3">
                    {history.length ? (
                      history.map((message, index) => (
                        <div
                          key={`${session.session_id}-${index}`}
                          className="rounded-2xl border border-slate-700/70 bg-slate-950/40 p-4"
                        >
                          <div className="text-xs uppercase tracking-[0.16em] text-slate-400">{message.role}</div>
                          <div className="mt-2 whitespace-pre-wrap text-sm leading-7 text-slate-200">{message.content}</div>
                          {message.timestamp ? (
                            <div className="mt-2 text-xs text-slate-500">{formatDateTime(message.timestamp)}</div>
                          ) : null}
                        </div>
                      ))
                    ) : (
                      <div className="rounded-2xl border border-dashed border-slate-700/80 bg-slate-950/30 px-4 py-6 text-sm text-slate-400">
                        暂无历史消息。
                      </div>
                    )}
                  </div>
                ) : null}
              </article>
            );
          })}

          {!sessions.length && !loading ? (
            <div className="rounded-[28px] border border-dashed border-slate-700/80 bg-slate-950/30 px-6 py-10 text-center text-sm text-slate-400">
              当前还没有活跃会话。
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
