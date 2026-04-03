'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Rocket, Target, Zap } from 'lucide-react';
import type { CampaignTaskType, ScheduleMode } from '@/types/orchestrator';
import { getFleetNodes, deployCommandToNode } from '@/services/node.service';
import { createCampaign } from '@/services/endpoints/campaign';
import { triggerErrorToast, triggerSuccessToast } from '@/services/api';

const BORDER = 'rgba(71,85,105,0.4)';
const CARD_BG = '#1E293B';
const MUTED = '#94A3B8';
const GOLD = '#E5A93D';

const TASK_TYPE_LABELS: Record<CampaignTaskType, string> = {
  video_distribute: '全域视频分发',
  comment_patrol: '评论巡检与互动',
  competitor_crawl: '竞品账号拆解',
};

const SCHEDULE_MODE_LABELS: Record<ScheduleMode, string> = {
  immediate: '立即执行',
  scheduled: '定时执行',
  ai_smart: 'AI 智能排期',
};

function splitLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function platformLabel(platform?: string): string {
  if (platform === 'douyin') return '抖音';
  if (platform === 'xiaohongshu') return '小红书';
  if (platform === 'wechat') return '微信';
  return platform || '未知';
}

export default function TaskOrchestratorPage() {
  const router = useRouter();
  const [taskName, setTaskName] = useState('');
  const [taskType, setTaskType] = useState<CampaignTaskType>('video_distribute');
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>('ai_smart');
  const [industryTemplateId, setIndustryTemplateId] = useState('industry.default');
  const [targetUrlsText, setTargetUrlsText] = useState('');
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set());
  const [dailyLimit, setDailyLimit] = useState(10);
  const [submitting, setSubmitting] = useState(false);

  const { data: nodes = [], isLoading, refetch } = useQuery({
    queryKey: ['orchestrator', 'fleet-nodes'],
    queryFn: getFleetNodes,
    staleTime: 30_000,
  });

  const selectedNodes = useMemo(() => nodes.filter((node) => selectedNodeIds.has(node.nodeId)), [nodes, selectedNodeIds]);

  const availableNodeCount = nodes.filter((node) => node.status === 'ONLINE' || node.status === 'BUSY').length;
  const selectedCount = selectedNodeIds.size;

  function toggleNode(nodeId: string) {
    setSelectedNodeIds((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedNodeIds((prev) => {
      if (prev.size === nodes.length) return new Set<string>();
      return new Set(nodes.map((node) => node.nodeId));
    });
  }

  async function launchTask() {
    const targetUrls = splitLines(targetUrlsText);
    if (!industryTemplateId.trim()) {
      triggerErrorToast('请填写行业模板 ID');
      return;
    }
    if (targetUrls.length === 0) {
      triggerErrorToast('请至少填写 1 条目标链接');
      return;
    }

    setSubmitting(true);
    try {
      const created = await createCampaign({
        industry_template_id: industryTemplateId.trim(),
        target_urls: targetUrls,
        content_strategy: {
          template_type: taskType,
          min_clips: 5,
          max_clips: 15,
        },
        publish_strategy: {
          daily_limit: Math.max(1, Number(dailyLimit) || 10),
          active_hours: scheduleMode === 'immediate' ? ['00-23'] : ['09-12', '19-22'],
        },
      });

      const campaignId = created.campaign_id;
      if (selectedNodeIds.size > 0) {
        await Promise.all(
          [...selectedNodeIds].map((nodeId) =>
            deployCommandToNode({
              targetNodeId: nodeId,
              actionType: 'START_CAMPAIGN',
              payload: {
                campaignId,
                taskName: taskName.trim() || '未命名任务',
                taskType,
                scheduleMode,
                industryTemplateId,
                targetUrls,
              },
            }),
          ),
        );
      }

      triggerSuccessToast(`任务已创建：${campaignId}`);
      router.push('/campaigns');
    } catch (error) {
      const message = error instanceof Error ? error.message : '创建任务失败，请检查后端服务';
      triggerErrorToast(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-0 space-y-6 p-4 md:p-6" style={{ backgroundColor: '#0F172A' }}>
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-50">全域任务总控</h1>
        <p className="mt-1 text-sm" style={{ color: MUTED }}>
          任务编排 + 真后端下发（全部实时链路）。
        </p>
      </div>

      <div className="rounded-xl border p-4" style={{ borderColor: BORDER, backgroundColor: CARD_BG }}>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider" style={{ color: GOLD }}>
          线索转化流水线
        </h2>
        <div className="flex flex-wrap items-center gap-2 md:gap-4">
          <span className="rounded-lg border px-3 py-2 text-sm text-slate-100" style={{ borderColor: BORDER }}>
            线索入库
          </span>
          <span className="text-slate-500">→</span>
          <span className="rounded-lg border px-3 py-2 text-sm text-slate-100" style={{ borderColor: BORDER }}>
            转化策略
          </span>
          <span className="text-slate-500">→</span>
          <span className="rounded-lg border px-3 py-2 text-sm text-slate-100" style={{ borderColor: 'rgba(229,169,61,0.6)', backgroundColor: 'rgba(229,169,61,0.08)' }}>
            任务下发
          </span>
          <span className="text-slate-500">→</span>
          <span className="rounded-lg border px-3 py-2 text-sm text-rose-300" style={{ borderColor: 'rgba(244,63,94,0.6)' }}>
            AI 跟进与回传
          </span>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr,320px]">
        <div className="space-y-6">
          <section className="rounded-xl border p-5" style={{ borderColor: BORDER, backgroundColor: CARD_BG }}>
            <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider" style={{ color: GOLD }}>
              <Zap className="h-4 w-4" />
              战役目标与参数
            </h2>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium" style={{ color: MUTED }}>
                  任务名称
                </label>
                <input
                  value={taskName}
                  onChange={(event) => setTaskName(event.target.value)}
                  placeholder="例如：火锅门店 7 天引流"
                  className="w-full rounded-lg border px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-amber-500/50"
                  style={{ borderColor: BORDER, backgroundColor: '#0f172a' }}
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium" style={{ color: MUTED }}>
                  行业模板 ID
                </label>
                <input
                  value={industryTemplateId}
                  onChange={(event) => setIndustryTemplateId(event.target.value)}
                  placeholder="如：kb_hotpot_store"
                  className="w-full rounded-lg border px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-amber-500/50"
                  style={{ borderColor: BORDER, backgroundColor: '#0f172a' }}
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium" style={{ color: MUTED }}>
                  任务类型
                </label>
                <select
                  value={taskType}
                  onChange={(event) => setTaskType(event.target.value as CampaignTaskType)}
                  className="w-full rounded-lg border px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-amber-500/50"
                  style={{ borderColor: BORDER, backgroundColor: '#0f172a' }}
                >
                  {Object.entries(TASK_TYPE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium" style={{ color: MUTED }}>
                  每日发布上限
                </label>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={dailyLimit}
                  onChange={(event) => setDailyLimit(Number(event.target.value || 10))}
                  className="w-full rounded-lg border px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-amber-500/50"
                  style={{ borderColor: BORDER, backgroundColor: '#0f172a' }}
                />
              </div>
            </div>

            <div className="mt-4">
              <label className="mb-1 block text-xs font-medium" style={{ color: MUTED }}>
                目标链接（每行一条）
              </label>
              <textarea
                rows={4}
                value={targetUrlsText}
                onChange={(event) => setTargetUrlsText(event.target.value)}
                placeholder={'https://example.com/account-a\nhttps://example.com/account-b'}
                className="w-full rounded-lg border px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-amber-500/50"
                style={{ borderColor: BORDER, backgroundColor: '#0f172a' }}
              />
            </div>
          </section>

          <section className="rounded-xl border p-5" style={{ borderColor: BORDER, backgroundColor: CARD_BG }}>
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider" style={{ color: GOLD }}>
              目标节点（真实在线）
            </h2>
            <div className="mb-2 flex justify-between">
              <button type="button" onClick={toggleSelectAll} className="text-xs font-medium" style={{ color: GOLD }}>
                {selectedCount === nodes.length ? '取消全选' : '全选'}
              </button>
              <button type="button" onClick={() => refetch()} className="text-xs font-medium" style={{ color: MUTED }}>
                刷新节点
              </button>
            </div>

            <ul className="max-h-72 space-y-1 overflow-y-auto rounded-lg border p-2" style={{ borderColor: BORDER, backgroundColor: '#0f172a' }}>
              {isLoading ? (
                <li className="px-3 py-2 text-sm" style={{ color: MUTED }}>正在加载节点...</li>
              ) : nodes.length === 0 ? (
                <li className="px-3 py-2 text-sm" style={{ color: MUTED }}>暂无可用边缘节点</li>
              ) : (
                nodes.map((node) => {
                  const checked = selectedNodeIds.has(node.nodeId);
                  return (
                    <li key={node.nodeId}>
                      <label className={`flex cursor-pointer gap-3 rounded-lg px-2 py-2 ${checked ? 'bg-amber-500/10' : 'hover:bg-white/5'}`}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleNode(node.nodeId)}
                          className="mt-0.5 h-4 w-4 accent-amber-500"
                        />
                        <div className="min-w-0 flex-1 text-sm">
                          <div className="font-medium text-slate-100">{node.clientName}</div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs" style={{ color: MUTED }}>
                            <span>{platformLabel(node.systemMetrics?.platforms?.[0])}</span>
                            <span>·</span>
                            <span>节点: {node.nodeId}</span>
                            <span>·</span>
                            <span>状态: {node.status}</span>
                          </div>
                        </div>
                      </label>
                    </li>
                  );
                })
              )}
            </ul>
          </section>
        </div>

        <aside className="rounded-xl border p-5" style={{ borderColor: BORDER, backgroundColor: CARD_BG }}>
          <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider" style={{ color: GOLD }}>
            <Target className="h-4 w-4" />
            指挥官控制台
          </h2>

          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <span style={{ color: MUTED }}>在线节点</span>
              <strong className="text-slate-100">{availableNodeCount} 个</strong>
            </div>
            <div className="flex items-center justify-between">
              <span style={{ color: MUTED }}>已选择节点</span>
              <strong className="text-slate-100">{selectedCount} 个</strong>
            </div>
            <div className="flex items-center justify-between">
              <span style={{ color: MUTED }}>排期模式</span>
              <strong className="text-slate-100">{SCHEDULE_MODE_LABELS[scheduleMode]}</strong>
            </div>
          </div>

          <div className="mt-4 rounded-lg border p-3" style={{ borderColor: BORDER, backgroundColor: '#0f172a' }}>
            <label className="mb-2 block text-xs font-medium" style={{ color: MUTED }}>
              排期模式
            </label>
            <select
              value={scheduleMode}
              onChange={(event) => setScheduleMode(event.target.value as ScheduleMode)}
              className="w-full rounded-md border px-2 py-2 text-sm text-slate-100 focus:outline-none"
              style={{ borderColor: BORDER, backgroundColor: '#0b1220' }}
            >
              {Object.entries(SCHEDULE_MODE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            disabled={submitting}
            onClick={launchTask}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold text-slate-900 transition disabled:cursor-not-allowed disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, #E5A93D 0%, #F59E0B 100%)' }}
          >
            <Rocket className="h-4 w-4" />
            {submitting ? '正在创建任务...' : '立即创建并下发任务'}
          </button>
        </aside>
      </div>
    </div>
  );
}
