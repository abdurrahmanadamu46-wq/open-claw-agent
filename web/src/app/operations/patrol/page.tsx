'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  CircleHelp,
  Pause,
  Play,
  PlusCircle,
  Radar,
  ShieldCheck,
  Sparkles,
  Timer,
  Trash2,
} from 'lucide-react';
import type { PatrolRule, PatrolStatus } from '@/types/patrol';
import { fetchCommercialReadiness } from '@/services/endpoints/ai-subservice';

const BORDER = 'rgba(71,85,105,0.4)';
const CARD_BG = '#1E293B';
const MUTED = '#94A3B8';
const GOLD = '#E5A93D';
const STORAGE_KEY = 'lobster_patrol_rules_v2';

type PatrolTemplate = {
  key: string;
  name: string;
  description: string;
  targetPlatform: string;
  intervalMinutes: number;
  triggerPercent: number;
  guideScript: string;
};

const PLATFORM_OPTIONS = ['抖音', '小红书', '视频号', '快手', '全平台'];

const TEMPLATES: PatrolTemplate[] = [
  {
    key: 'comment-intercept',
    name: '评论求购拦截',
    description: '识别“怎么买、多少钱、求链接”等高意向评论，优先推入线索池。',
    targetPlatform: '抖音',
    intervalMinutes: 15,
    triggerPercent: 30,
    guideScript: '先确认需求场景，再补充核心差异，最后引导进入私信或留资链路。',
  },
  {
    key: 'risk-warning',
    name: '账号风险预警',
    description: '监控限流、验证码、异常评论风向，优先触发排障和人工复核。',
    targetPlatform: '全平台',
    intervalMinutes: 30,
    triggerPercent: 18,
    guideScript: '发现风险信号后先记录证据，再触发排障和审批，不直接自动执行高风险动作。',
  },
  {
    key: 'private-message',
    name: '私信意向巡检',
    description: '批量扫描私信中的采购意图，命中后自动打标签并抬高优先级。',
    targetPlatform: '小红书',
    intervalMinutes: 20,
    triggerPercent: 25,
    guideScript: '先判断预算、时效与决策角色，再决定是否进入电话回访或销售跟进。',
  },
];

const DEFAULT_RULES: PatrolRule[] = [
  {
    id: 'r1',
    name: '美妆评论高意向巡检',
    targetCount: 12,
    targetPlatform: '抖音',
    status: 'running',
    guideScript: '先同理，再提问，再给下一步动作；命中高意向词后同步线索池并提醒销售。',
    intervalMinutes: 15,
    triggerPercent: 30,
    createdAt: new Date().toISOString(),
  },
  {
    id: 'r2',
    name: '私信采购意向识别',
    targetCount: 8,
    targetPlatform: '小红书',
    status: 'running',
    guideScript: '识别预算、时效与决策权，命中后标记优先级并保留审计轨迹。',
    intervalMinutes: 20,
    triggerPercent: 25,
    createdAt: new Date().toISOString(),
  },
];

function nextRunText(intervalMinutes: number): string {
  const dt = new Date(Date.now() + intervalMinutes * 60 * 1000);
  const hh = String(dt.getHours()).padStart(2, '0');
  const mm = String(dt.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function parseTargets(text: string): string[] {
  return text
    .split(/\n|,|;/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function statusText(status: PatrolStatus): string {
  return status === 'running' ? '运行中' : '已暂停';
}

function statusTone(status: PatrolStatus) {
  return status === 'running'
    ? {
        color: '#34d399',
        backgroundColor: 'rgba(52,211,153,0.15)',
      }
    : {
        color: '#94A3B8',
        backgroundColor: 'rgba(148,163,184,0.15)',
      };
}

export default function PatrolPage() {
  const [rules, setRules] = useState<PatrolRule[]>(DEFAULT_RULES);
  const [sheetOpen, setSheetOpen] = useState(false);

  const [formName, setFormName] = useState('');
  const [formPlatform, setFormPlatform] = useState('抖音');
  const [formTargetUrls, setFormTargetUrls] = useState('');
  const [formGuideScript, setFormGuideScript] = useState(
    '先同理，再提问，最后给出下一步动作，避免机械化回复。',
  );
  const [formInterval, setFormInterval] = useState(15);
  const [formTriggerPercent, setFormTriggerPercent] = useState(30);
  const [selectedTemplate, setSelectedTemplate] = useState('');

  const readinessQuery = useQuery({
    queryKey: ['patrol', 'commercial-readiness'],
    queryFn: fetchCommercialReadiness,
    retry: false,
  });

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as PatrolRule[];
      if (Array.isArray(parsed) && parsed.length > 0) {
        setRules(parsed);
      }
    } catch {
      // ignore malformed local cache
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(rules));
  }, [rules]);

  const readiness = readinessQuery.data?.readiness;
  const blockerCount = Number(readiness?.blocker_count ?? 0);
  const readinessScore = Number(readiness?.score ?? 0);

  const summary = useMemo(() => {
    const runningRules = rules.filter((rule) => rule.status === 'running').length;
    const totalTargets = rules.reduce((acc, item) => acc + item.targetCount, 0);
    const avgInterval =
      rules.length > 0
        ? Math.round(rules.reduce((acc, item) => acc + item.intervalMinutes, 0) / rules.length)
        : 0;
    const avgTrigger =
      rules.length > 0
        ? Math.round(rules.reduce((acc, item) => acc + item.triggerPercent, 0) / rules.length)
        : 0;
    return { runningRules, totalTargets, avgInterval, avgTrigger };
  }, [rules]);

  const schedulePreview = useMemo(
    () =>
      rules
        .filter((rule) => rule.status === 'running')
        .map((rule) => ({
          id: rule.id,
          name: rule.name,
          nextRunAt: nextRunText(rule.intervalMinutes),
          interval: `${rule.intervalMinutes} 分钟`,
          threshold: `${rule.triggerPercent}%`,
          platform: rule.targetPlatform,
        })),
    [rules],
  );

  const targetPreview = useMemo(() => parseTargets(formTargetUrls), [formTargetUrls]);

  const canSubmit = useMemo(
    () =>
      formName.trim().length > 1 &&
      formPlatform.trim().length > 0 &&
      formGuideScript.trim().length > 0 &&
      formInterval >= 5 &&
      formInterval <= 120 &&
      formTriggerPercent >= 1 &&
      formTriggerPercent <= 100,
    [formGuideScript, formInterval, formName, formPlatform, formTriggerPercent],
  );

  function toggleRuleStatus(id: string) {
    setRules((prev) =>
      prev.map((rule) =>
        rule.id === id
          ? { ...rule, status: (rule.status === 'running' ? 'paused' : 'running') as PatrolStatus }
          : rule,
      ),
    );
  }

  function deleteRule(id: string) {
    setRules((prev) => prev.filter((rule) => rule.id !== id));
  }

  function applyTemplate(template: PatrolTemplate) {
    setSelectedTemplate(template.key);
    setFormPlatform(template.targetPlatform);
    setFormInterval(template.intervalMinutes);
    setFormTriggerPercent(template.triggerPercent);
    setFormGuideScript(template.guideScript);
    if (!formName.trim()) {
      setFormName(template.name);
    }
  }

  function handleCreateRule() {
    const targets = parseTargets(formTargetUrls);
    const created: PatrolRule = {
      id: `r-${Date.now()}`,
      name: formName.trim(),
      targetCount: targets.length || 1,
      targetPlatform: formPlatform,
      status: 'running',
      guideScript: formGuideScript.trim(),
      intervalMinutes: formInterval,
      triggerPercent: formTriggerPercent,
      createdAt: new Date().toISOString(),
    };

    setRules((prev) => [created, ...prev]);
    setFormName('');
    setFormPlatform('抖音');
    setFormTargetUrls('');
    setFormGuideScript('先同理，再提问，最后给出下一步动作，避免机械化回复。');
    setFormInterval(15);
    setFormTriggerPercent(30);
    setSelectedTemplate('');
    setSheetOpen(false);
  }

  return (
    <div className="min-h-[calc(100vh-6rem)] space-y-5 p-4 md:p-6" style={{ backgroundColor: '#0F172A' }}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: '#F8FAFC' }}>
            自动巡检策略
          </h1>
          <p className="mt-1 text-sm" style={{ color: MUTED }}>
            定义“多久巡一次、命中什么条件、命中后怎么处理”，让云端调度和边缘执行之间保持清晰分工。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/operations/log-audit"
            className="inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-sm"
            style={{ borderColor: BORDER, color: '#cbd5e1' }}
          >
            日志审核
            <ArrowRight className="h-4 w-4" />
          </Link>
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-white"
            style={{ background: 'var(--claw-gradient)' }}
          >
            <PlusCircle className="h-4 w-4" />
            新建策略
          </button>
        </div>
      </div>

      <section
        className="rounded-2xl border px-5 py-5"
        style={{
          borderColor: blockerCount > 0 ? 'rgba(251,146,60,0.35)' : 'rgba(34,197,94,0.35)',
          background:
            'radial-gradient(circle at top right, rgba(34,211,238,0.14), transparent 34%), linear-gradient(180deg, rgba(15,23,42,0.92) 0%, rgba(2,6,23,0.9) 100%)',
        }}
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-sm font-medium text-slate-100">
              <ShieldCheck size={16} className="text-cyan-300" />
              巡检前置门槛
            </div>
            <p className="mt-2 max-w-3xl text-sm text-slate-300">
              巡检策略可以先跑，但外部商业化发布仍受支付、通知、Feishu 回调和 ICP 就绪度约束。高风险动作默认继续走审批链路。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="rounded-2xl border border-slate-700/70 bg-slate-950/70 px-4 py-3 text-center">
              <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">score</div>
              <div className="mt-1 text-2xl font-semibold text-slate-100">{readinessScore}</div>
            </div>
            <div
              className={`rounded-2xl border px-4 py-3 text-sm ${
                blockerCount > 0
                  ? 'border-amber-500/35 bg-amber-500/10 text-amber-200'
                  : 'border-emerald-500/35 bg-emerald-500/10 text-emerald-200'
              }`}
            >
              {blockerCount > 0 ? `${blockerCount} 个发布阻塞项` : '可进入发布彩排'}
            </div>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-3 text-sm">
          <Link
            href="/settings/commercial-readiness"
            className="rounded-xl border border-cyan-500/40 bg-cyan-500/10 px-4 py-2 text-cyan-200"
          >
            打开商业化 cockpit
          </Link>
          <Link href="/operations/autopilot/trace" className="rounded-xl border border-slate-600 px-4 py-2 text-slate-200">
            查看 Trace 排障
          </Link>
        </div>
      </section>

      <section className="rounded-xl border p-4" style={{ borderColor: BORDER, backgroundColor: CARD_BG }}>
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold" style={{ color: '#F8FAFC' }}>
          <CircleHelp className="h-4 w-4 text-cyan-300" />
          这页负责什么
        </div>
        <div className="grid grid-cols-1 gap-2 text-xs md:grid-cols-3" style={{ color: '#cbd5e1' }}>
          <div>
            <span className="font-medium text-cyan-300">巡检间隔：</span>
            每隔 N 分钟扫描一次评论或私信。间隔越小，响应越快，但资源占用越高。
          </div>
          <div>
            <span className="font-medium text-cyan-300">触发阈值：</span>
            只有命中概率达到阈值才会进入下一步动作，阈值越高越保守。
          </div>
          <div>
            <span className="font-medium text-cyan-300">引导脚本：</span>
            命中后交给回声龙虾和铁网龙虾执行的处理准则，决定回复风格与线索流转。
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border p-4" style={{ borderColor: BORDER, backgroundColor: CARD_BG }}>
          <div className="text-xs" style={{ color: MUTED }}>
            运行中策略
          </div>
          <div className="mt-2 text-2xl font-semibold" style={{ color: '#F8FAFC' }}>
            {summary.runningRules}
          </div>
        </div>
        <div className="rounded-xl border p-4" style={{ borderColor: BORDER, backgroundColor: CARD_BG }}>
          <div className="text-xs" style={{ color: MUTED }}>
            监控目标总量
          </div>
          <div className="mt-2 text-2xl font-semibold" style={{ color: '#F8FAFC' }}>
            {summary.totalTargets}
          </div>
        </div>
        <div className="rounded-xl border p-4" style={{ borderColor: BORDER, backgroundColor: CARD_BG }}>
          <div className="text-xs" style={{ color: MUTED }}>
            平均巡检间隔
          </div>
          <div className="mt-2 text-2xl font-semibold" style={{ color: '#F8FAFC' }}>
            {summary.avgInterval} 分钟
          </div>
        </div>
        <div className="rounded-xl border p-4" style={{ borderColor: BORDER, backgroundColor: CARD_BG }}>
          <div className="text-xs" style={{ color: MUTED }}>
            平均触发阈值
          </div>
          <div className="mt-2 text-2xl font-semibold" style={{ color: '#F8FAFC' }}>
            {summary.avgTrigger}%
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <section className="xl:col-span-2">
          <div className="rounded-xl border" style={{ borderColor: BORDER, backgroundColor: CARD_BG }}>
            <div className="flex items-center gap-2 border-b px-4 py-3" style={{ borderColor: BORDER }}>
              <Bot className="h-4 w-4 text-cyan-300" />
              <h2 className="text-sm font-semibold" style={{ color: '#F8FAFC' }}>
                巡检策略列表
              </h2>
            </div>
            <div className="space-y-3 p-4">
              {rules.length === 0 ? (
                <div className="rounded-xl border border-dashed p-6 text-center text-sm" style={{ borderColor: BORDER, color: MUTED }}>
                  还没有巡检策略，点击右上角“新建策略”开始配置。
                </div>
              ) : null}

              {rules.map((rule) => {
                const running = rule.status === 'running';
                return (
                  <article
                    key={rule.id}
                    className="rounded-xl border p-4"
                    style={{ borderColor: BORDER, backgroundColor: '#0f172a' }}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h3 className="text-sm font-semibold" style={{ color: '#F8FAFC' }}>
                          {rule.name}
                        </h3>
                        <p className="mt-1 text-xs" style={{ color: MUTED }}>
                          平台：{rule.targetPlatform} · 目标：{rule.targetCount} 个 · 下次执行：{nextRunText(rule.intervalMinutes)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span
                          className="rounded-full px-2 py-0.5 text-xs font-medium"
                          style={statusTone(rule.status)}
                        >
                          {statusText(rule.status)}
                        </span>
                        <button
                          type="button"
                          onClick={() => toggleRuleStatus(rule.id)}
                          className="rounded p-1.5 text-slate-300 hover:bg-white/10"
                          title={running ? '暂停策略' : '恢复策略'}
                        >
                          {running ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteRule(rule.id)}
                          className="rounded p-1.5 text-slate-300 hover:bg-white/10"
                          title="删除策略"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                    <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
                      <div>
                        <div className="text-[11px]" style={{ color: MUTED }}>
                          巡检间隔
                        </div>
                        <div className="mt-1 text-sm" style={{ color: '#F8FAFC' }}>
                          <Timer className="mr-1 inline h-4 w-4" />
                          {rule.intervalMinutes} 分钟
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px]" style={{ color: MUTED }}>
                          触发阈值
                        </div>
                        <div className="mt-1 text-sm" style={{ color: '#F8FAFC' }}>
                          <ShieldCheck className="mr-1 inline h-4 w-4" />
                          {rule.triggerPercent}%
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px]" style={{ color: MUTED }}>
                          引导脚本
                        </div>
                        <div className="mt-1 line-clamp-2 text-sm" style={{ color: '#cbd5e1' }}>
                          {rule.guideScript}
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section className="space-y-4">
          <div className="rounded-xl border p-4" style={{ borderColor: BORDER, backgroundColor: CARD_BG }}>
            <h2 className="text-sm font-semibold" style={{ color: '#F8FAFC' }}>
              执行节奏预览
            </h2>
            <div className="mt-3 space-y-2">
              {schedulePreview.length === 0 ? (
                <p className="text-xs" style={{ color: MUTED }}>
                  当前没有运行中的巡检策略。
                </p>
              ) : null}
              {schedulePreview.map((item) => (
                <div
                  key={item.id}
                  className="rounded-lg border px-3 py-2 text-xs"
                  style={{ borderColor: BORDER, backgroundColor: '#0f172a', color: '#cbd5e1' }}
                >
                  <div className="font-medium" style={{ color: '#F8FAFC' }}>
                    {item.name}
                  </div>
                  <div className="mt-1">
                    下次：{item.nextRunAt} · 间隔：{item.interval} · 阈值：{item.threshold} · 平台：{item.platform}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border p-4" style={{ borderColor: BORDER, backgroundColor: CARD_BG }}>
            <h2 className="flex items-center gap-2 text-sm font-semibold" style={{ color: GOLD }}>
              <Radar className="h-4 w-4" />
              边界与协作
            </h2>
            <ul className="mt-2 space-y-2 text-xs" style={{ color: '#cbd5e1' }}>
              <li>1. 这页负责定义巡检规则、开关状态和执行节奏。</li>
              <li>2. Trace 排障页负责跨队列链路、审批状态和回滚细节。</li>
              <li>3. 日志审核页负责异常检索、trace 关联和行为审计。</li>
              <li>4. 高风险动作默认继续进入 HITL，不在巡检侧直接放开自动执行。</li>
            </ul>
          </div>

          <div className="rounded-xl border p-4" style={{ borderColor: BORDER, backgroundColor: CARD_BG }}>
            <h2 className="flex items-center gap-2 text-sm font-semibold" style={{ color: '#F8FAFC' }}>
              <Sparkles className="h-4 w-4 text-cyan-300" />
              模板建议
            </h2>
            <div className="mt-3 space-y-2">
              {TEMPLATES.map((template) => (
                <div
                  key={template.key}
                  className="rounded-lg border px-3 py-3 text-xs"
                  style={{ borderColor: BORDER, backgroundColor: '#0f172a', color: '#cbd5e1' }}
                >
                  <div className="font-medium" style={{ color: '#F8FAFC' }}>
                    {template.name}
                  </div>
                  <div className="mt-1">{template.description}</div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>

      {sheetOpen ? (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 bg-black/60"
            aria-label="关闭新建策略面板"
            onClick={() => setSheetOpen(false)}
          />
          <div
            className="fixed right-0 top-0 z-50 flex h-full w-full max-w-xl flex-col border-l shadow-2xl"
            style={{ backgroundColor: '#0f172a', borderColor: BORDER }}
          >
            <div className="flex items-center justify-between border-b px-5 py-4" style={{ borderColor: BORDER }}>
              <h2 className="text-lg font-semibold" style={{ color: '#F8FAFC' }}>
                新建自动巡检策略
              </h2>
              <button
                type="button"
                onClick={() => setSheetOpen(false)}
                className="rounded p-2 hover:bg-white/10"
                style={{ color: MUTED }}
              >
                关闭
              </button>
            </div>
            <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
              <div>
                <label className="mb-2 block text-xs font-medium" style={{ color: MUTED }}>
                  快速模板
                </label>
                <div className="flex flex-wrap gap-2">
                  {TEMPLATES.map((template) => (
                    <button
                      key={template.key}
                      type="button"
                      onClick={() => applyTemplate(template)}
                      className="rounded-full border px-3 py-1.5 text-xs"
                      style={{
                        borderColor: selectedTemplate === template.key ? 'rgba(56,189,248,0.6)' : BORDER,
                        backgroundColor: selectedTemplate === template.key ? 'rgba(56,189,248,0.15)' : '#111827',
                        color: '#e2e8f0',
                      }}
                      title={template.description}
                    >
                      {template.name}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium" style={{ color: MUTED }}>
                  策略名称
                </label>
                <input
                  type="text"
                  value={formName}
                  onChange={(event) => setFormName(event.target.value)}
                  placeholder="例如：中餐门店评论求购巡检"
                  className="w-full rounded-lg border px-3 py-2 text-sm"
                  style={{ backgroundColor: '#1e293b', borderColor: BORDER, color: '#F8FAFC' }}
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium" style={{ color: MUTED }}>
                  目标平台
                </label>
                <select
                  value={formPlatform}
                  onChange={(event) => setFormPlatform(event.target.value)}
                  className="w-full rounded-lg border px-3 py-2 text-sm"
                  style={{ backgroundColor: '#1e293b', borderColor: BORDER, color: '#F8FAFC' }}
                >
                  {PLATFORM_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium" style={{ color: MUTED }}>
                  监控目标（每行一个 URL 或账号标识）
                </label>
                <textarea
                  value={formTargetUrls}
                  onChange={(event) => setFormTargetUrls(event.target.value)}
                  rows={4}
                  placeholder="https://v.douyin.com/xxxx&#10;xiaohongshu:user:abc"
                  className="w-full resize-y rounded-lg border px-3 py-2 text-sm"
                  style={{ backgroundColor: '#1e293b', borderColor: BORDER, color: '#F8FAFC' }}
                />
                <div className="mt-1 text-xs" style={{ color: MUTED }}>
                  当前识别目标数：{targetPreview.length || 1}
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium" style={{ color: MUTED }}>
                  引导脚本要求（命中后执行逻辑）
                </label>
                <textarea
                  value={formGuideScript}
                  onChange={(event) => setFormGuideScript(event.target.value)}
                  rows={3}
                  className="w-full resize-y rounded-lg border px-3 py-2 text-sm"
                  style={{ backgroundColor: '#1e293b', borderColor: BORDER, color: '#F8FAFC' }}
                />
              </div>

              <div className="rounded-lg border p-4" style={{ borderColor: BORDER, backgroundColor: '#1e293b' }}>
                <div className="mb-2 text-xs font-medium" style={{ color: GOLD }}>
                  灵敏度参数
                </div>
                <div className="grid grid-cols-1 gap-4">
                  <label className="text-xs" style={{ color: '#cbd5e1' }}>
                    巡检间隔（分钟）
                    <input
                      type="range"
                      min={5}
                      max={120}
                      step={5}
                      value={formInterval}
                      onChange={(event) => setFormInterval(Number(event.target.value))}
                      className="mt-1 w-full"
                    />
                    <span className="mt-1 block" style={{ color: MUTED }}>
                      当前：{formInterval} 分钟，越小越实时。
                    </span>
                  </label>
                  <label className="text-xs" style={{ color: '#cbd5e1' }}>
                    触发阈值（%）
                    <input
                      type="range"
                      min={1}
                      max={100}
                      step={1}
                      value={formTriggerPercent}
                      onChange={(event) => setFormTriggerPercent(Number(event.target.value))}
                      className="mt-1 w-full"
                    />
                    <span className="mt-1 block" style={{ color: MUTED }}>
                      当前：{formTriggerPercent}%，越高越保守。
                    </span>
                  </label>
                </div>
              </div>

              <div className="rounded-lg border p-3 text-xs" style={{ borderColor: BORDER, backgroundColor: '#0b1220', color: '#cbd5e1' }}>
                预览：该策略将在 <span className="text-cyan-300">{nextRunText(formInterval)}</span> 首次执行，
                监控 <span className="text-cyan-300">{targetPreview.length || 1}</span> 个目标，
                命中概率达到 <span className="text-cyan-300">{formTriggerPercent}%</span> 才会触发下一步动作。
              </div>

              {blockerCount > 0 ? (
                <div className="rounded-lg border border-amber-500/35 bg-amber-500/10 p-3 text-xs text-amber-100">
                  <div className="flex items-center gap-2 font-medium">
                    <AlertTriangle className="h-4 w-4" />
                    当前仍有 {blockerCount} 个商业化阻塞项
                  </div>
                  <div className="mt-2">
                    可以先配置和演练巡检策略，但外部发布前仍需完成商业化切真。
                  </div>
                </div>
              ) : null}
            </div>
            <div className="border-t px-5 py-4" style={{ borderColor: BORDER }}>
              <button
                type="button"
                onClick={handleCreateRule}
                disabled={!canSubmit}
                className="w-full rounded-lg px-4 py-2.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                style={{ background: 'var(--claw-gradient)' }}
              >
                保存并启用策略
              </button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
