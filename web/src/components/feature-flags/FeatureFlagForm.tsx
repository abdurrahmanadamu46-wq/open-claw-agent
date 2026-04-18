'use client';

import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/Form';
import { Input } from '@/components/ui/Input';
import { Slider } from '@/components/ui/Slider';
import { Switch } from '@/components/ui/Switch';
import { Textarea } from '@/components/ui/Textarea';
import { Button } from '@/components/ui/Button';
import type { FeatureFlag, StrategyType } from '@/types/feature-flags';

export const featureFlagSchema = z.object({
  name: z
    .string()
    .min(1, '标识不能为空')
    .regex(/^[a-z][a-z0-9_.-]*$/, '只能使用小写字母、数字、点、横线与下划线，且必须以字母开头'),
  description: z.string().max(500, '描述最多 500 个字符').optional().default(''),
  environment: z.enum(['dev', 'staging', 'prod']),
  strategyType: z.enum(['all', 'gradualRollout', 'tenantWhitelist', 'lobsterWhitelist', 'edgeNodeTag'] as const),
  rolloutPercent: z.coerce.number().min(0, '最少 0').max(100, '最多 100'),
  enabled: z.boolean(),
});

export type FeatureFlagFormValues = z.infer<typeof featureFlagSchema>;

export function FeatureFlagForm({
  mode,
  initialFlag,
  onSubmit,
  onCancel,
}: {
  mode: 'create' | 'edit';
  initialFlag?: FeatureFlag | null;
  onSubmit: (values: FeatureFlagFormValues) => Promise<void>;
  onCancel?: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const defaultValues = useMemo<FeatureFlagFormValues>(() => {
    const firstStrategy = initialFlag?.strategies?.[0];
    const rollout = Number(firstStrategy?.parameters?.['rollout'] || 0);
    return {
      name: initialFlag?.name || '',
      description: initialFlag?.description || '',
      environment: initialFlag?.environment || 'prod',
      strategyType: (firstStrategy?.type || 'all') as StrategyType,
      rolloutPercent: Number.isFinite(rollout) ? rollout : 0,
      enabled: initialFlag?.enabled ?? true,
    };
  }, [initialFlag]);

  const form = useForm<FeatureFlagFormValues>({
    resolver: zodResolver(featureFlagSchema),
    defaultValues,
  });

  const strategyType = form.watch('strategyType');

  // Avoid hydration mismatch: Switch/Slider render different DOM based on values
  // which react-hook-form initializes client-side only.
  if (!mounted) {
    return <div className="space-y-5 animate-pulse"><div className="h-10 rounded-2xl bg-slate-800/60" /><div className="h-10 rounded-2xl bg-slate-800/60" /><div className="h-10 rounded-2xl bg-slate-800/60" /></div>;
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
        <div className="grid gap-4 md:grid-cols-2">
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>开关标识</FormLabel>
                <FormControl>
                  <Input {...field} disabled={mode === 'edit'} placeholder="lobster.inkwriter.prompt_v2" />
                </FormControl>
                <FormDescription>创建后标识不建议再改。</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="environment"
            render={({ field }) => (
              <FormItem>
                <FormLabel>环境</FormLabel>
                <FormControl>
                  <select
                    value={field.value}
                    onChange={(event) => field.onChange(event.target.value)}
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/65 px-4 py-3 text-sm text-slate-100 outline-none focus:border-cyan-400/40 focus:ring-2 focus:ring-cyan-400/15"
                  >
                    <option value="dev">dev</option>
                    <option value="staging">staging</option>
                    <option value="prod">prod</option>
                  </select>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>描述</FormLabel>
              <FormControl>
                <Textarea {...field} rows={3} placeholder="说明这个开关控制的行为与使用范围。" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid gap-4 md:grid-cols-2">
          <FormField
            control={form.control}
            name="strategyType"
            render={({ field }) => (
              <FormItem>
                <FormLabel>策略类型</FormLabel>
                <FormControl>
                  <select
                    value={field.value}
                    onChange={(event) => field.onChange(event.target.value)}
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/65 px-4 py-3 text-sm text-slate-100 outline-none focus:border-cyan-400/40 focus:ring-2 focus:ring-cyan-400/15"
                  >
                    <option value="all">all</option>
                    <option value="gradualRollout">gradualRollout</option>
                    <option value="tenantWhitelist">tenantWhitelist</option>
                    <option value="lobsterWhitelist">lobsterWhitelist</option>
                    <option value="edgeNodeTag">edgeNodeTag</option>
                  </select>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="enabled"
            render={({ field }) => (
              <FormItem className="flex items-center justify-between rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                <div>
                  <FormLabel>立即启用</FormLabel>
                  <FormDescription>保存后是否立刻生效。</FormDescription>
                </div>
                <FormControl>
                  <Switch checked={field.value} onCheckedChange={field.onChange} aria-label="立即启用" />
                </FormControl>
              </FormItem>
            )}
          />
        </div>

        {strategyType === 'gradualRollout' ? (
          <FormField
            control={form.control}
            name="rolloutPercent"
            render={({ field }) => (
              <FormItem>
                <FormLabel>灰度比例：{field.value}%</FormLabel>
                <FormControl>
                  <Slider
                    min={0}
                    max={100}
                    step={5}
                    value={[field.value]}
                    onValueChange={([value]) => field.onChange(value)}
                    aria-label="灰度比例"
                  />
                </FormControl>
                <FormDescription>只对部分租户逐步放量时使用。</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        ) : null}

        <div className="flex justify-end gap-3">
          {onCancel ? (
            <Button type="button" variant="ghost" onClick={onCancel}>
              取消
            </Button>
          ) : null}
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? '保存中...' : mode === 'create' ? '创建开关' : '保存修改'}
          </Button>
        </div>
      </form>
    </Form>
  );
}
