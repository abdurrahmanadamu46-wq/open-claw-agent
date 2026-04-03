'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';

export interface LobsterScorerFormValue {
  task_description: string;
  competitor_count: number;
  edge_target_count: number;
  risk_level: string;
  tool_count: number;
}

interface ScorerFormProps {
  onSubmit: (value: LobsterScorerFormValue) => void;
  submitting?: boolean;
}

export function ScorerForm({ onSubmit, submitting = false }: ScorerFormProps) {
  const [form, setForm] = useState<LobsterScorerFormValue>({
    task_description: '帮我批量分析 10 个竞品账号的爆款公式',
    competitor_count: 10,
    edge_target_count: 3,
    risk_level: 'P1',
    tool_count: 4,
  });

  return (
    <form
      className="space-y-4 rounded-2xl border border-white/10 bg-white/[0.04] p-5"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(form);
      }}
    >
      <div>
        <label className="mb-2 block text-sm font-medium text-gray-200">任务描述</label>
        <textarea
          value={form.task_description}
          onChange={(e) => setForm((prev) => ({ ...prev, task_description: e.target.value }))}
          rows={5}
          className="w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-sm text-gray-100"
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <NumberField
          label="竞品数量"
          value={form.competitor_count}
          onChange={(value) => setForm((prev) => ({ ...prev, competitor_count: value }))}
        />
        <NumberField
          label="边缘目标数"
          value={form.edge_target_count}
          onChange={(value) => setForm((prev) => ({ ...prev, edge_target_count: value }))}
        />
        <NumberField
          label="工具数量"
          value={form.tool_count}
          onChange={(value) => setForm((prev) => ({ ...prev, tool_count: value }))}
        />
        <div>
          <label className="mb-2 block text-sm font-medium text-gray-200">风险等级</label>
          <select
            value={form.risk_level}
            onChange={(e) => setForm((prev) => ({ ...prev, risk_level: e.target.value }))}
            className="w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-sm text-gray-100"
          >
            <option value="P0">P0</option>
            <option value="P1">P1</option>
            <option value="P2">P2</option>
            <option value="P3">P3</option>
          </select>
        </div>
      </div>

      <Button type="submit" className="h-11 px-5" disabled={submitting}>
        {submitting ? '评分中...' : '开始模拟评分'}
      </Button>
    </form>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div>
      <label className="mb-2 block text-sm font-medium text-gray-200">{label}</label>
      <input
        type="number"
        min={0}
        value={value}
        onChange={(e) => onChange(Number.parseInt(e.target.value || '0', 10))}
        className="w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-sm text-gray-100"
      />
    </div>
  );
}
