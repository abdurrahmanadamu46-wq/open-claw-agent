'use client';

import Link from 'next/link';
import { type ReactNode, useEffect, useState } from 'react';
import { ArrowLeft, MessageSquare, RefreshCw, ShieldAlert, UserSearch } from 'lucide-react';
import {
  fetchTenantXhsCatcherFeed,
  fetchTenantXhsEchoerFeed,
  fetchTenantXhsEventSummary,
  fetchTenantXhsEvents,
} from '@/services/endpoints/tenant-xhs';
import { isDemoMode } from '@/services/demo-mode';
import type {
  FleetEdgeEventRecord,
  XhsEventSummaryResponse,
  XhsRoleFeedItem,
  XhsRoleFeedResponse,
} from '@/types/xhs-events';

function normalizeError(error: unknown): string {
  const maybe = error as {
    response?: { data?: { message?: string; detail?: string } };
    message?: string;
  };
  return maybe?.response?.data?.message || maybe?.response?.data?.detail || maybe?.message || '请求失败';
}

export default function XiaohongshuEventPage() {
  const [items, setItems] = useState<FleetEdgeEventRecord[]>([]);
  const [summary, setSummary] = useState<XhsEventSummaryResponse | null>(null);
  const [echoerFeed, setEchoerFeed] = useState<XhsRoleFeedResponse | null>(null);
  const [catcherFeed, setCatcherFeed] = useState<XhsRoleFeedResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');

  const load = async () => {
    if (isDemoMode()) {
      setItems([]);
      setSummary(null);
      setEchoerFeed(null);
      setCatcherFeed(null);
      setNotice('当前处于演示壳模式，这页不主动请求真实 XHS 事件接口；真实联调环境会在这里展示边缘事件流和角色待办。');
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const [eventsData, summaryData, echoerData, catcherData] = await Promise.all([
        fetchTenantXhsEvents({ limit: 50 }),
        fetchTenantXhsEventSummary({ limit: 100 }),
        fetchTenantXhsEchoerFeed({ limit: 8 }),
        fetchTenantXhsCatcherFeed({ limit: 8 }),
      ]);
      const nextItems = eventsData.data.items || [];
      setItems(nextItems);
      setSummary(summaryData);
      setEchoerFeed(echoerData);
      setCatcherFeed(catcherData);
      setNotice(`已同步 ${nextItems.length} 条边缘事件，Echoer 待处理 ${echoerData.total} 条，Catcher 待筛查 ${catcherData.total} 条。`);
    } catch (error) {
      setNotice(normalizeError(error));
      setItems([]);
      setSummary(null);
      setEchoerFeed(null);
      setCatcherFeed(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="p-6 text-slate-100">
      <div className="mx-auto max-w-6xl space-y-6">
        <section className="rounded-[30px] border border-white/10 bg-white/[0.04] p-6">
          <Link
            href="/operations/channels/xiaohongshu"
            className="inline-flex items-center gap-2 text-sm text-slate-300 hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" />
            返回小红书通道主管台
          </Link>
          <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-4 py-2 text-xs text-cyan-100">
            <MessageSquare className="h-4 w-4" />
            XHS Edge Event Feed
          </div>
          <h1 className="mt-4 text-3xl font-semibold text-white md:text-4xl">查看云端收到的小红书互动事件</h1>
          <p className="mt-3 max-w-4xl text-sm leading-7 text-slate-300">
            这里既保留边缘上报的原始事件，也把事件整理成 Echoer 和 Catcher 可直接消费的待办 feed。
            打开这一页，你就能同时看到互动流、风险流和潜在线索流。
          </p>
        </section>

        {summary ? (
          <section className="grid gap-3 md:grid-cols-5">
            <SummaryCard
              title="总事件数"
              value={String(summary.summary.total_events)}
              desc="当前窗口内已经同步到云端的 XHS 互动事件总数。"
            />
            <SummaryCard
              title="高意向评论"
              value={String(summary.summary.high_intent_comment_count)}
              desc="命中高意向关键词，适合进一步做线索判断。"
            />
            <SummaryCard
              title="风险评论"
              value={String(summary.summary.risk_comment_count)}
              desc="命中投诉、退款、避雷等风险关键词。"
            />
            <SummaryCard
              title="未读摘要"
              value={summary.summary.unread_summary_present ? '已收到' : '暂无'}
              desc="边缘已上报未读私信 / 消息摘要状态。"
            />
            <SummaryCard
              title="新增连接"
              value={String(summary.summary.new_connection_count)}
              desc="边缘检测到的新关注 / 新连接事件数。"
            />
          </section>
        ) : null}

        <section className="rounded-[28px] border border-white/10 bg-slate-950/45 p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-lg font-semibold text-white">角色待办视图</div>
              <div className="mt-1 text-sm text-slate-300">
                Echoer 看互动承接，Catcher 看高意向与风险筛查。
              </div>
            </div>
            <button
              type="button"
              onClick={() => void load()}
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-600 px-4 py-2 text-sm text-slate-100 hover:bg-slate-800/70"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              {loading ? '刷新中...' : '刷新'}
            </button>
          </div>
          {notice ? <div className="mt-3 text-sm text-slate-300">{notice}</div> : null}

          <div className="mt-5 grid gap-4 xl:grid-cols-2">
            <RoleFeedPanel
              icon={<MessageSquare className="h-4 w-4 text-cyan-200" />}
              title="Echoer Pending"
              subtitle="互动承接、未读处理、公开区回复和轻量转化入口。"
              borderClassName="border-cyan-500/20 bg-cyan-500/10"
              items={echoerFeed?.items ?? []}
              emptyText="当前没有新的 Echoer 待处理互动。"
            />
            <RoleFeedPanel
              icon={<ShieldAlert className="h-4 w-4 text-amber-200" />}
              title="Catcher Screening"
              subtitle="高意向线索筛查、风险过滤和是否继续流转的判断入口。"
              borderClassName="border-amber-500/20 bg-amber-500/10"
              items={catcherFeed?.items ?? []}
              emptyText="当前没有新的 Catcher 筛查项。"
            />
          </div>
        </section>

        <section className="rounded-[28px] border border-white/10 bg-slate-950/45 p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-lg font-semibold text-white">原始事件列表</div>
              <div className="mt-1 text-sm text-slate-300">
                保留原始事件流，方便核对角色待办来自哪条边缘上报。
              </div>
            </div>
            <div className="text-sm text-slate-400">最近 50 条</div>
          </div>

          <div className="mt-4 space-y-3">
            {items.length ? (
              items.map((item) => (
                <div key={item.eventId} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                    <span className="rounded-full bg-cyan-500/10 px-2 py-0.5 text-cyan-200">{item.eventType}</span>
                    <span>{item.accountId || 'no-account'}</span>
                    <span>{item.nodeId || 'no-node'}</span>
                    <span>{item.createdAt}</span>
                  </div>
                  <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-all text-sm text-white">
                    {JSON.stringify(item.payload, null, 2)}
                  </pre>
                </div>
              ))
            ) : (
              <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.03] p-4 text-sm text-slate-400">
                当前没有可展示的 XHS 边缘事件。
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function RoleFeedPanel({
  icon,
  title,
  subtitle,
  borderClassName,
  items,
  emptyText,
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
  borderClassName: string;
  items: XhsRoleFeedItem[];
  emptyText: string;
}) {
  return (
    <section className={`rounded-2xl border p-4 ${borderClassName}`}>
      <div className="flex items-center gap-2 text-sm font-semibold text-white">
        {icon}
        {title}
      </div>
      <div className="mt-2 text-sm leading-6 text-slate-200">{subtitle}</div>

      <div className="mt-4 space-y-3">
        {items.length ? (
          items.map((item) => <RoleFeedCard key={item.id} item={item} />)
        ) : (
          <div className="rounded-xl bg-black/20 px-3 py-3 text-sm text-slate-300">{emptyText}</div>
        )}
      </div>
    </section>
  );
}

function RoleFeedCard({ item }: { item: XhsRoleFeedItem }) {
  return (
    <article className="rounded-2xl bg-black/20 p-4">
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-300">
        <span className="rounded-full bg-white/10 px-2 py-0.5 text-white">{item.event_type}</span>
        <PriorityBadge priority={item.priority} />
        <RouteBadge route={item.route_hint} />
        <span>{item.created_at}</span>
      </div>

      <div className="mt-3 text-sm font-semibold text-white">{item.reason}</div>
      {item.content ? <div className="mt-2 text-sm leading-6 text-slate-200">{item.content}</div> : null}

      <div className="mt-3 grid gap-2 text-xs text-slate-300 md:grid-cols-2">
        <MetaRow label="建议动作" value={item.suggested_action} />
        <MetaRow label="账号" value={item.account_id || '-'} />
        <MetaRow label="作者" value={item.author_name || '-'} />
        <MetaRow label="线索意向" value={item.lead_intent} />
        <MetaRow label="风险等级" value={item.risk_level} />
        <MetaRow label="来源 URL" value={item.source_url || '-'} />
      </div>
    </article>
  );
}

function SummaryCard({ title, value, desc }: { title: string; value: string; desc: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="text-sm font-semibold text-white">{title}</div>
      <div className="mt-2 text-2xl font-semibold text-cyan-100">{value}</div>
      <div className="mt-2 text-sm leading-6 text-slate-300">{desc}</div>
    </div>
  );
}

function PriorityBadge({ priority }: { priority: XhsRoleFeedItem['priority'] }) {
  const className =
    priority === 'high'
      ? 'bg-rose-500/20 text-rose-100'
      : priority === 'medium'
        ? 'bg-amber-500/20 text-amber-100'
        : 'bg-emerald-500/20 text-emerald-100';
  return <span className={`rounded-full px-2 py-0.5 ${className}`}>{priority}</span>;
}

function RouteBadge({ route }: { route: XhsRoleFeedItem['route_hint'] }) {
  const icon = route === 'catcher' ? <UserSearch className="h-3.5 w-3.5" /> : null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-white">
      {icon}
      {route}
    </span>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white/5 px-3 py-2">
      <div className="text-[11px] uppercase tracking-[0.14em] text-slate-400">{label}</div>
      <div className="mt-1 break-all text-sm text-white">{value}</div>
    </div>
  );
}
