'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Building2, Users, Percent, TrendingUp, ChevronRight, ArrowRight, Layers } from 'lucide-react';
import Link from 'next/link';

const BORDER = 'rgba(71,85,105,0.42)';
const PANEL_BG = '#16243b';

// Stub data — real data from B-P1-13 / partner API
const TIER_TIERS = [
  { label: '1-4 席', unit_price: 4800, discount: '-', use_case: '单店直签（锚点价）', color: '#22d3ee', margin: '81.6%' },
  { label: '5-19 席', unit_price: 3800, discount: '79折', use_case: '小品牌/小代理', color: '#a78bfa', margin: '76.7%' },
  { label: '20-49 席', unit_price: 2980, discount: '62折', use_case: '代理起步线', color: '#34d399', margin: '70.3%' },
  { label: '50-99 席', unit_price: 2480, discount: '52折', use_case: '区域代理', color: '#f59e0b', margin: '64.4%' },
  { label: '100-299 席', unit_price: 2180, discount: '45折', use_case: '省级代理', color: '#fb7185', margin: '59.4%' },
  { label: '300 席+', unit_price: 1980, discount: '41折', use_case: '总代理 · 底线价', color: '#60a5fa', margin: '55.4%' },
];

const CASE_STUDIES = [
  {
    title: '代理起步（20 席）',
    cost: 59600,
    revenue: 96000,
    opex: 32000,
    net: 4400,
    note: '建议快速做到 50 席',
  },
  {
    title: '区域代理（50 席）',
    cost: 124000,
    revenue: 190000,
    opex: 50000,
    net: 16000,
    note: '年净利约 ¥19 万',
  },
  {
    title: '省级代理（100 席）',
    cost: 218000,
    revenue: 380000,
    opex: 80000,
    net: 82000,
    note: '年净利约 ¥98 万',
  },
  {
    title: '总代理（300 席）',
    cost: 594000,
    revenue: 894000,
    opex: 200000,
    net: 100000,
    note: '年净利约 ¥120 万',
  },
];

function StatCard({
  label,
  value,
  sub,
  color = '#e2e8f0',
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
}) {
  return (
    <div
      className="rounded-xl border px-4 py-3"
      style={{ borderColor: BORDER, backgroundColor: PANEL_BG }}
    >
      <div className="text-xs uppercase tracking-widest text-slate-500">{label}</div>
      <div className="mt-2 text-2xl font-semibold" style={{ color }}>
        {value}
      </div>
      {sub && <div className="mt-1 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

export default function ResellerPage() {
  const [activeTab, setActiveTab] = useState<'pricing' | 'profit' | 'apply'>('pricing');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div
        className="rounded-2xl border p-6"
        style={{ borderColor: BORDER, backgroundColor: PANEL_BG }}
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-xs text-cyan-200">
              <Building2 className="h-3.5 w-3.5" />
              代理商招募计划
            </div>
            <h1 className="mt-3 text-2xl font-semibold text-white">Dragon Senate 代理体系</h1>
            <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-400">
              通过代理商体系放大销售覆盖。区域代理年净利 ¥19 万，省级代理年净利 ¥98 万，总代理年净利 ¥120 万。
              底线价 ¥1,980/席确保渠道每席毛利不低于 ¥1,000。
            </p>
          </div>
          <span className="shrink-0 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-300">
            F-P1-05 · 后端接入中 · 演示布局
          </span>
        </div>

        {/* Key stats */}
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="锚点价" value="¥4,800" sub="单席/月" color="#22d3ee" />
          <StatCard label="底线价" value="¥1,980" sub="300席+ 总代" color="#34d399" />
          <StatCard label="AI成本" value="¥884" sub="含损耗缓冲" color="#f59e0b" />
          <StatCard label="底线边际利润" value="55.4%" sub="最低价仍健康" color="#a78bfa" />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-xl border p-1" style={{ borderColor: BORDER, backgroundColor: PANEL_BG }}>
        {([
          { id: 'pricing', label: '价格阶梯' },
          { id: 'profit', label: '利润测算' },
          { id: 'apply', label: '申请代理' },
        ] as const).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className="flex-1 rounded-lg px-4 py-2 text-sm font-medium transition"
            style={{
              backgroundColor: activeTab === tab.id ? 'rgba(34,211,238,0.12)' : 'transparent',
              color: activeTab === tab.id ? '#22d3ee' : '#94a3b8',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'pricing' && (
        <div className="space-y-3">
          <div
            className="overflow-hidden rounded-2xl border"
            style={{ borderColor: BORDER }}
          >
            <table className="min-w-full text-left text-sm">
              <thead
                className="border-b text-xs uppercase tracking-widest text-slate-500"
                style={{ borderColor: BORDER, backgroundColor: 'rgba(15,23,42,0.6)' }}
              >
                <tr>
                  <th className="px-4 py-3">席位档</th>
                  <th className="px-4 py-3">单席月价</th>
                  <th className="px-4 py-3">折扣</th>
                  <th className="px-4 py-3">边际利润率</th>
                  <th className="px-4 py-3">适用场景</th>
                </tr>
              </thead>
              <tbody>
                {TIER_TIERS.map((tier, i) => (
                  <tr
                    key={tier.label}
                    className="border-b last:border-0"
                    style={{ borderColor: 'rgba(71,85,105,0.3)', backgroundColor: i % 2 === 0 ? 'transparent' : 'rgba(15,23,42,0.3)' }}
                  >
                    <td className="px-4 py-3 font-medium" style={{ color: tier.color }}>
                      {tier.label}
                    </td>
                    <td className="px-4 py-3 text-white font-semibold">
                      ¥{tier.unit_price.toLocaleString('zh-CN')}
                    </td>
                    <td className="px-4 py-3 text-slate-300">{tier.discount}</td>
                    <td className="px-4 py-3 text-emerald-300">{tier.margin}</td>
                    <td className="px-4 py-3 text-slate-400">{tier.use_case}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div
            className="rounded-xl border border-slate-700/50 bg-slate-950/30 px-4 py-3 text-xs text-slate-400"
          >
            AI 成本 ¥884 = ¥784 直接成本（Seedance 2.0 + Imagen 4）+ ¥100 损耗缓冲。底线 ¥1,980 在任何情况下不再下调。
          </div>
        </div>
      )}

      {activeTab === 'profit' && (
        <div className="grid gap-4 md:grid-cols-2">
          {CASE_STUDIES.map((c) => {
            const margin = Math.round((c.net / c.revenue) * 100);
            return (
              <div
                key={c.title}
                className="rounded-2xl border p-5"
                style={{ borderColor: BORDER, backgroundColor: PANEL_BG }}
              >
                <div className="text-sm font-semibold text-white">{c.title}</div>
                <div className="mt-4 space-y-2">
                  {[
                    { label: '采购成本', value: c.cost, color: '#fb7185' },
                    { label: '向下游收入', value: c.revenue, color: '#34d399' },
                    { label: '代理运营成本', value: c.opex, color: '#f59e0b' },
                    { label: '月净利', value: c.net, color: '#22d3ee' },
                  ].map((row) => (
                    <div key={row.label} className="flex items-center justify-between text-sm">
                      <span className="text-slate-400">{row.label}</span>
                      <span className="font-semibold" style={{ color: row.color }}>
                        ¥{row.value.toLocaleString('zh-CN')}
                      </span>
                    </div>
                  ))}
                </div>
                <div
                  className="mt-4 flex items-center justify-between rounded-xl border px-3 py-2"
                  style={{ borderColor: 'rgba(52,211,153,0.3)', backgroundColor: 'rgba(52,211,153,0.06)' }}
                >
                  <span className="text-xs text-emerald-300">净利润率</span>
                  <span className="text-sm font-semibold text-emerald-300">{margin}%</span>
                </div>
                <div className="mt-2 text-xs text-slate-500">{c.note}</div>
              </div>
            );
          })}
        </div>
      )}

      {activeTab === 'apply' && (
        <div
          className="rounded-2xl border p-6"
          style={{ borderColor: BORDER, backgroundColor: PANEL_BG }}
        >
          <div className="text-base font-semibold text-white mb-4">申请成为代理商</div>
          <div className="space-y-4">
            {[
              { label: '公司/个人名称', placeholder: '请输入公司或个人全称' },
              { label: '联系人', placeholder: '姓名' },
              { label: '联系方式', placeholder: '手机号 / 微信 / 邮箱' },
              { label: '目标城市/区域', placeholder: '例：广东省广州市，或华南区' },
            ].map((field) => (
              <div key={field.label}>
                <label className="block text-sm text-slate-300 mb-2">{field.label}</label>
                <input
                  className="w-full rounded-xl border bg-transparent px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-cyan-400/50"
                  style={{ borderColor: BORDER }}
                  placeholder={field.placeholder}
                />
              </div>
            ))}
            <div>
              <label className="block text-sm text-slate-300 mb-2">计划管理席位数</label>
              <select
                className="w-full rounded-xl border px-4 py-2.5 text-sm text-slate-300 outline-none"
                style={{ borderColor: BORDER, backgroundColor: 'transparent' }}
              >
                <option value="">请选择...</option>
                <option value="20-49">20-49 席（代理起步）</option>
                <option value="50-99">50-99 席（区域代理）</option>
                <option value="100-299">100-299 席（省级代理）</option>
                <option value="300+">300 席+（总代理）</option>
              </select>
            </div>
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-300">
              当前提交将保存为待审核申请，后端接入后自动路由至 BD 团队处理。
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                className="flex items-center gap-2 rounded-xl px-6 py-2.5 text-sm font-medium"
                style={{ backgroundColor: '#22d3ee', color: '#0f172a' }}
              >
                提交申请
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Link to partner portal */}
      <div
        className="flex items-center justify-between rounded-2xl border px-5 py-4"
        style={{ borderColor: BORDER, backgroundColor: PANEL_BG }}
      >
        <div>
          <div className="text-sm font-medium text-white">已是代理商？</div>
          <div className="mt-0.5 text-xs text-slate-400">进入代理经营台查看席位、结算和下线管理</div>
        </div>
        <Link
          href="/partner/portal"
          className="flex items-center gap-2 rounded-xl border border-cyan-400/25 bg-cyan-400/10 px-4 py-2 text-sm text-cyan-200 transition hover:bg-cyan-400/15"
        >
          代理经营台
          <ChevronRight className="h-4 w-4" />
        </Link>
      </div>
    </div>
  );
}
