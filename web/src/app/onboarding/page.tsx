'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  CheckCircle2,
  Building2,
  Users,
  Zap,
  BarChart3,
  ChevronRight,
  Clock,
} from 'lucide-react';

const BORDER = 'rgba(71,85,105,0.42)';
const PANEL_BG = '#16243b';

// Onboarding wizard — stub, awaiting backend F-P1-03 implementation
const STEPS = [
  {
    id: 'industry',
    label: '01 · 选择行业',
    description: '选定行业大类和子行业，系统自动加载 2,628 个行业知识包中对应的规则和金样例。',
    icon: <Building2 className="h-5 w-5" />,
    status: 'current',
    fields: ['industry_category', 'industry_sub'],
  },
  {
    id: 'profile',
    label: '02 · 客户画像',
    description: '补齐门店痛点、可交付结果、品牌背景和差异化优势，让龙虾理解你是谁。',
    icon: <Users className="h-5 w-5" />,
    status: 'pending',
    fields: ['pain_points', 'solutions', 'persona_background', 'advantages'],
  },
  {
    id: 'seats',
    label: '03 · 席位配置',
    description: '绑定社交媒体账号（抖音 / 小红书 / 视频号 / 公众号），每个账号为一席。',
    icon: <Zap className="h-5 w-5" />,
    status: 'pending',
    fields: ['seat_accounts'],
  },
  {
    id: 'tasks',
    label: '04 · 生成首批任务',
    description: '系统按行业与画像自动生成第一批可执行任务，龙虾团队待命。',
    icon: <BarChart3 className="h-5 w-5" />,
    status: 'pending',
    fields: [],
  },
];

type StepStatus = 'current' | 'done' | 'pending';

const STEP_COLORS: Record<StepStatus, { border: string; text: string; bg: string }> = {
  current: { border: '#22d3ee', text: '#22d3ee', bg: 'rgba(34,211,238,0.08)' },
  done: { border: '#34d399', text: '#34d399', bg: 'rgba(52,211,153,0.08)' },
  pending: { border: 'rgba(71,85,105,0.42)', text: '#64748b', bg: 'transparent' },
};

export default function OnboardingPage() {
  const [currentStep, setCurrentStep] = useState(0);
  const [industryCategory, setIndustryCategory] = useState('');
  const [industrySub, setIndustrySub] = useState('');
  const [painPoints, setPainPoints] = useState('');
  const [solutions, setSolutions] = useState('');

  const steps = STEPS.map((s, i) => ({
    ...s,
    status: (i < currentStep ? 'done' : i === currentStep ? 'current' : 'pending') as StepStatus,
  }));

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* Header */}
      <div
        className="rounded-2xl border p-6"
        style={{ borderColor: BORDER, backgroundColor: PANEL_BG }}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-xs text-cyan-200">
              <Zap className="h-3.5 w-3.5" />
              新商家引导流程
            </div>
            <h1 className="mt-4 text-2xl font-semibold text-white">商家首启向导</h1>
            <p className="mt-2 text-sm leading-7 text-slate-400">
              4 步完成基础配置，让龙虾团队了解你的行业、客户和目标，然后自动生成第一批可执行任务。
            </p>
          </div>
          <span className="shrink-0 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-300">
            后端接入中 · 演示布局
          </span>
        </div>

        {/* Progress bar */}
        <div className="mt-6 flex items-center gap-2">
          {STEPS.map((s, i) => (
            <div key={s.id} className="flex flex-1 items-center gap-2">
              <div
                className="h-1.5 flex-1 rounded-full transition-all duration-500"
                style={{
                  backgroundColor:
                    i < currentStep ? '#34d399' : i === currentStep ? '#22d3ee' : 'rgba(71,85,105,0.3)',
                }}
              />
            </div>
          ))}
        </div>
        <div className="mt-2 text-right text-xs text-slate-500">
          步骤 {currentStep + 1} / {STEPS.length}
        </div>
      </div>

      {/* Step list + Content */}
      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        {/* Left: step nav */}
        <div className="flex flex-col gap-2">
          {steps.map((step, i) => {
            const c = STEP_COLORS[step.status];
            return (
              <button
                key={step.id}
                type="button"
                onClick={() => step.status !== 'pending' && setCurrentStep(i)}
                className="flex items-start gap-3 rounded-xl border p-3 text-left transition"
                style={{ borderColor: c.border, backgroundColor: c.bg, cursor: step.status === 'pending' ? 'default' : 'pointer' }}
              >
                <span style={{ color: c.text }} className="mt-0.5 shrink-0">
                  {step.status === 'done' ? <CheckCircle2 className="h-4 w-4" /> : step.icon}
                </span>
                <div>
                  <div className="text-sm font-medium" style={{ color: c.text }}>
                    {step.label}
                  </div>
                  {step.status === 'current' && (
                    <div className="mt-1 text-xs leading-5 text-slate-400">{step.description}</div>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {/* Right: current step content */}
        <div
          className="rounded-2xl border p-6"
          style={{ borderColor: BORDER, backgroundColor: PANEL_BG }}
        >
          {currentStep === 0 && (
            <StepIndustry
              category={industryCategory}
              sub={industrySub}
              onNext={(cat, sub) => {
                setIndustryCategory(cat);
                setIndustrySub(sub);
                setCurrentStep(1);
              }}
            />
          )}
          {currentStep === 1 && (
            <StepProfile
              painPoints={painPoints}
              solutions={solutions}
              onBack={() => setCurrentStep(0)}
              onNext={(pp, sol) => {
                setPainPoints(pp);
                setSolutions(sol);
                setCurrentStep(2);
              }}
            />
          )}
          {currentStep === 2 && (
            <StepSeats onBack={() => setCurrentStep(1)} onNext={() => setCurrentStep(3)} />
          )}
          {currentStep === 3 && (
            <StepTasks
              industry={industrySub || industryCategory}
              onBack={() => setCurrentStep(2)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function StepIndustry({
  category,
  sub,
  onNext,
}: {
  category: string;
  sub: string;
  onNext: (cat: string, sub: string) => void;
}) {
  const [cat, setCat] = useState(category);
  const [s, setS] = useState(sub);

  const CATEGORIES = [
    '餐饮服务', '美业健康', '教育培训', '汽车服务', '家居装修',
    '本地零售', '生活服务', '医疗健康', '企业服务', '文旅休闲',
    '电商出海', '酒店民宿', '建筑行业',
  ];

  return (
    <div className="space-y-5">
      <div>
        <div className="text-base font-semibold text-white">选择行业大类</div>
        <div className="mt-1 text-sm text-slate-400">选对行业后，系统自动匹配知识包、规则和金样例</div>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {CATEGORIES.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setCat(c)}
            className="rounded-xl border px-3 py-2.5 text-sm transition"
            style={{
              borderColor: cat === c ? '#22d3ee' : BORDER,
              backgroundColor: cat === c ? 'rgba(34,211,238,0.08)' : 'transparent',
              color: cat === c ? '#22d3ee' : '#94a3b8',
            }}
          >
            {c}
          </button>
        ))}
      </div>
      <div className="mt-4">
        <label className="block text-sm text-slate-300">子行业（可选，精确匹配知识包）</label>
        <input
          className="mt-2 w-full rounded-xl border bg-transparent px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-cyan-400/50"
          style={{ borderColor: BORDER }}
          placeholder="例：美容院、火锅店、考研培训..."
          value={s}
          onChange={(e) => setS(e.target.value)}
        />
      </div>
      <div className="flex justify-end">
        <button
          type="button"
          disabled={!cat}
          onClick={() => onNext(cat, s)}
          className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-medium transition disabled:opacity-40"
          style={{ backgroundColor: cat ? '#22d3ee' : undefined, color: cat ? '#0f172a' : '#94a3b8' }}
        >
          下一步
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function StepProfile({
  painPoints,
  solutions,
  onBack,
  onNext,
}: {
  painPoints: string;
  solutions: string;
  onBack: () => void;
  onNext: (pp: string, sol: string) => void;
}) {
  const [pp, setPp] = useState(painPoints);
  const [sol, setSol] = useState(solutions);

  return (
    <div className="space-y-5">
      <div>
        <div className="text-base font-semibold text-white">填写客户画像</div>
        <div className="mt-1 text-sm text-slate-400">越具体，龙虾执行越精准</div>
      </div>
      <div className="space-y-4">
        <div>
          <label className="block text-sm text-slate-300">主要痛点</label>
          <textarea
            rows={3}
            className="mt-2 w-full rounded-xl border bg-transparent px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-cyan-400/50 resize-none"
            style={{ borderColor: BORDER }}
            placeholder="例：客户获客成本高、内容生产慢、代运营效果不稳定..."
            value={pp}
            onChange={(e) => setPp(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-sm text-slate-300">可交付的结果</label>
          <textarea
            rows={3}
            className="mt-2 w-full rounded-xl border bg-transparent px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-cyan-400/50 resize-none"
            style={{ borderColor: BORDER }}
            placeholder="例：每月稳定产出 20 条短视频、线索转化率提升 30%..."
            value={sol}
            onChange={(e) => setSol(e.target.value)}
          />
        </div>
      </div>
      <div className="flex justify-between">
        <button
          type="button"
          onClick={onBack}
          className="rounded-xl border px-5 py-2.5 text-sm text-slate-300 transition hover:bg-white/[0.04]"
          style={{ borderColor: BORDER }}
        >
          上一步
        </button>
        <button
          type="button"
          onClick={() => onNext(pp, sol)}
          className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-medium"
          style={{ backgroundColor: '#22d3ee', color: '#0f172a' }}
        >
          下一步
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function StepSeats({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const PLATFORMS = ['抖音', '小红书', '视频号', '公众号'];
  const [selected, setSelected] = useState<string[]>([]);

  const toggle = (p: string) =>
    setSelected((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));

  return (
    <div className="space-y-5">
      <div>
        <div className="text-base font-semibold text-white">配置席位账号</div>
        <div className="mt-1 text-sm text-slate-400">
          1 席 = 1 个社交媒体账号，每席包含 20 条视频 + 30 张图片 + 500 次客服互动/月
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {PLATFORMS.map((p) => {
          const active = selected.includes(p);
          return (
            <button
              key={p}
              type="button"
              onClick={() => toggle(p)}
              className="flex items-center gap-3 rounded-xl border px-4 py-3 text-sm transition"
              style={{
                borderColor: active ? '#22d3ee' : BORDER,
                backgroundColor: active ? 'rgba(34,211,238,0.08)' : 'transparent',
                color: active ? '#22d3ee' : '#94a3b8',
              }}
            >
              {active ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0 opacity-30" />}
              {p}
            </button>
          );
        })}
      </div>
      <div className="rounded-xl border border-slate-700/50 bg-slate-950/30 px-4 py-3 text-sm text-slate-400">
        已选 <span className="text-white font-semibold">{selected.length}</span> 席 ·
        月费 <span className="text-cyan-300 font-semibold">¥{(selected.length * 4800).toLocaleString('zh-CN')}</span>（锚点价）
      </div>
      <div className="flex justify-between">
        <button
          type="button"
          onClick={onBack}
          className="rounded-xl border px-5 py-2.5 text-sm text-slate-300"
          style={{ borderColor: BORDER }}
        >
          上一步
        </button>
        <button
          type="button"
          onClick={onNext}
          className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-medium"
          style={{ backgroundColor: '#22d3ee', color: '#0f172a' }}
        >
          生成首批任务
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function StepTasks({ industry, onBack }: { industry: string; onBack: () => void }) {
  return (
    <div className="space-y-5">
      <div>
        <div className="text-base font-semibold text-white">首批任务已生成</div>
        <div className="mt-1 text-sm text-slate-400">
          基于行业「{industry || '待确认'}」，龙虾团队已准备好首批任务
        </div>
      </div>
      <div className="space-y-2">
        {[
          { id: 'T-001', title: '竞品内容扫描', owner: '触须虾', eta: '30分钟' },
          { id: 'T-002', title: '行业热点信号报告', owner: '触须虾', eta: '1小时' },
          { id: 'T-003', title: '首月内容策略规划', owner: '脑虫虾', eta: '2小时' },
          { id: 'T-004', title: '开篇文案包（5条）', owner: '吐墨虾', eta: '45分钟' },
        ].map((task) => (
          <div
            key={task.id}
            className="flex items-center gap-3 rounded-xl border px-4 py-3"
            style={{ borderColor: BORDER, backgroundColor: 'rgba(15,23,42,0.5)' }}
          >
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
            <div className="flex-1 min-w-0">
              <div className="text-sm text-white">{task.title}</div>
              <div className="text-xs text-slate-500">{task.owner}</div>
            </div>
            <div className="flex items-center gap-1 text-xs text-slate-500">
              <Clock className="h-3.5 w-3.5" />
              {task.eta}
            </div>
          </div>
        ))}
      </div>
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-300">
        当前为演示数据。后端接入后将从 Commander 真实调度并返回任务列表。
      </div>
      <div className="flex justify-between">
        <button
          type="button"
          onClick={onBack}
          className="rounded-xl border px-5 py-2.5 text-sm text-slate-300"
          style={{ borderColor: BORDER }}
        >
          上一步
        </button>
        <Link
          href="/campaigns"
          className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-medium"
          style={{ backgroundColor: '#22d3ee', color: '#0f172a' }}
        >
          进入任务列表
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </div>
  );
}
