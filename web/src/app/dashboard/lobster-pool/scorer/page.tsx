'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { LobsterBindingPanel } from '@/components/lobster/LobsterBindingPanel';
import { DimensionRadar } from '@/components/lobster/DimensionRadar';
import { ScorerForm, type LobsterScorerFormValue } from '@/components/lobster/ScorerForm';
import { SurfaceStateCard } from '@/components/operations/SurfacePrimitives';
import { getLobsterScoringBindingPlan, simulateLobsterScoring, tierColor, tierLabel } from '@/lib/lobster-api';
import { triggerErrorToast } from '@/services/api';

export default function LobsterPoolScorerPage() {
  const [result, setResult] = useState<Awaited<ReturnType<typeof simulateLobsterScoring>> | null>(null);
  const [errorText, setErrorText] = useState('');
  const plannedBinding = getLobsterScoringBindingPlan();

  function normalizeError(error: unknown) {
    const maybe = error as { response?: { data?: { message?: string; detail?: string } }; message?: string };
    return maybe?.response?.data?.message || maybe?.response?.data?.detail || maybe?.message || '评分请求失败';
  }

  const mutation = useMutation({
    mutationFn: (payload: LobsterScorerFormValue) => simulateLobsterScoring(payload),
    onSuccess: (data) => {
      setErrorText('');
      setResult(data);
    },
    onError: (error) => {
      const message = normalizeError(error);
      setErrorText(message);
      triggerErrorToast(message);
    },
  });

  return (
    <div className="space-y-6 bg-gray-950 p-6 text-gray-100">
      <section className="rounded-[30px] border border-white/10 bg-white/[0.04] p-6">
        <div className="text-xs uppercase tracking-[0.18em] text-cyan-300">Lobster Scorer</div>
        <h1 className="mt-3 text-4xl font-semibold text-white">任务评分模拟器</h1>
        <p className="mt-3 max-w-3xl text-sm leading-7 text-gray-300">
          先输入任务描述、竞品数量、边缘目标数和风险等级，系统会估算任务层级、置信度以及应该路由给哪只龙虾。
        </p>
      </section>

      {errorText ? (
        <SurfaceStateCard
          kind="error"
          title="评分模拟器当前不可用"
          description={`当前页面已经优先走 live backend 评分接口，不再 silently fallback。错误信息：${errorText}`}
        />
      ) : null}

      <LobsterBindingPanel
        title="评分模拟器接线计划"
        items={[
          { label: 'simulation', binding: result?.binding ?? plannedBinding },
        ]}
      />

      {result ? (
        <LobsterBindingPanel
          title="评分模拟器接线深度"
          items={[
            { label: 'simulation', binding: result.binding },
          ]}
        />
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[0.96fr_1.04fr]">
        <ScorerForm onSubmit={(value) => mutation.mutate(value)} submitting={mutation.isPending} />

        <div className="space-y-4">
          <Card className="border border-white/10 bg-white/[0.04] shadow-none">
            <CardHeader>
              <CardTitle className="text-white">评分结果</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {!result ? (
                <div className="rounded-2xl border border-dashed border-white/10 bg-black/20 p-5 text-sm text-gray-400">
                  先提交一个模拟任务，这里会显示层级、分数、置信度和推荐龙虾。
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <span
                      className="rounded-full px-3 py-1 text-sm font-medium text-white"
                      style={{ backgroundColor: tierColor(result.tier) }}
                    >
                      {tierLabel(result.tier)}
                    </span>
                    <div className="text-sm text-gray-300">raw score {result.raw_score.toFixed(2)}</div>
                    <div className="text-sm text-gray-300">confidence {result.confidence.toFixed(2)}</div>
                  </div>

                  <div>
                    <div className="mb-2 text-sm text-gray-400">原始分数</div>
                    <div className="h-3 overflow-hidden rounded-full bg-gray-800">
                      <div className="h-full bg-cyan-400" style={{ width: `${Math.round(result.raw_score * 100)}%` }} />
                    </div>
                  </div>

                  <div>
                    <div className="mb-2 text-sm text-gray-400">置信度</div>
                    <div className="h-3 overflow-hidden rounded-full bg-gray-800">
                      <div className="h-full bg-green-400" style={{ width: `${Math.round(result.confidence * 100)}%` }} />
                    </div>
                  </div>

                  <div className="rounded-2xl border border-white/8 bg-black/20 p-4">
                    <div className="text-sm font-semibold text-white">推荐龙虾</div>
                    <div className="mt-3 flex items-center gap-3">
                      <span className="text-3xl">{result.routed_lobster.icon}</span>
                      <div>
                        <div className="text-lg font-semibold text-white">{result.routed_lobster.name}</div>
                        <div className="text-sm text-gray-400">{result.routed_lobster.role}</div>
                      </div>
                    </div>
                    <p className="mt-3 text-sm leading-7 text-gray-300">{result.routed_lobster.reason}</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {result && <DimensionRadar dimensions={result.dimensions} />}
        </div>
      </div>
    </div>
  );
}
