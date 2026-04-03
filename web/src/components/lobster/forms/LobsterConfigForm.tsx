'use client';

import { useMemo } from 'react';
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
import type { LobsterEntity } from '@/types/lobster';

export const lobsterConfigSchema = z.object({
  display_name: z.string().min(1, '显示名称不能为空').max(32, '最多 32 个字符'),
  description: z.string().max(240, '描述最多 240 个字符'),
  max_tokens: z.coerce.number().min(100, '最少 100').max(8192, '最大 8192'),
  temperature: z.coerce.number().min(0, '最低 0').max(2, '最高 2'),
  prompt_version: z.string().min(1, '请选择 Prompt 版本'),
  edge_compatible: z.boolean(),
  max_concurrent: z.coerce.number().int().min(1, '最少 1').max(10, '最多 10'),
});

export type LobsterConfigValues = z.infer<typeof lobsterConfigSchema>;

const DEFAULTS: LobsterConfigValues = {
  display_name: '',
  description: '',
  max_tokens: 2048,
  temperature: 0.7,
  prompt_version: 'stable',
  edge_compatible: true,
  max_concurrent: 3,
};

function parseDraft(value?: string): Partial<LobsterConfigValues> {
  if (!value) return {};
  try {
    return JSON.parse(value) as Partial<LobsterConfigValues>;
  } catch {
    return {};
  }
}

export function LobsterConfigForm({
  lobster,
  onSave,
}: {
  lobster: LobsterEntity;
  onSave: (values: LobsterConfigValues) => Promise<void>;
}) {
  const defaultValues = useMemo<LobsterConfigValues>(() => {
    const config = parseDraft(lobster.annotations?.['openclaw/config-draft']);
    return {
      ...DEFAULTS,
      ...config,
      display_name: config.display_name || lobster.display_name || lobster.name,
      description: config.description || lobster.description || '',
      prompt_version: config.prompt_version || lobster.annotations?.['openclaw/prompt-version'] || 'stable',
      edge_compatible:
        typeof config.edge_compatible === 'boolean'
          ? config.edge_compatible
          : lobster.annotations?.['openclaw/edge-compatible'] !== 'false',
    };
  }, [lobster]);

  const form = useForm<LobsterConfigValues>({
    resolver: zodResolver(lobsterConfigSchema),
    defaultValues,
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSave)} className="space-y-5">
        <div className="grid gap-4 md:grid-cols-2">
          <FormField
            control={form.control}
            name="display_name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>显示名称</FormLabel>
                <FormControl>
                  <Input {...field} placeholder="例如：触须虾 Radar" />
                </FormControl>
                <FormDescription>当前控制台中展示的龙虾名称。</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="prompt_version"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Prompt 版本</FormLabel>
                <FormControl>
                  <select
                    value={field.value}
                    onChange={(event) => field.onChange(event.target.value)}
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/65 px-4 py-3 text-sm text-slate-100 outline-none focus:border-cyan-400/40 focus:ring-2 focus:ring-cyan-400/15"
                  >
                    <option value="stable">stable</option>
                    <option value="v1">v1</option>
                    <option value="v2">v2</option>
                    <option value="experiment">experiment</option>
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
                <Textarea {...field} rows={3} placeholder="补充这只龙虾的职责、边界和当前使用偏好。" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid gap-4 md:grid-cols-2">
          <FormField
            control={form.control}
            name="max_tokens"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Max Tokens</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    value={field.value}
                    onChange={(event) => field.onChange(Number(event.target.value))}
                  />
                </FormControl>
                <FormDescription>当前仓库暂无后端持久化接口，先保存为本地草稿。</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="max_concurrent"
            render={({ field }) => (
              <FormItem>
                <FormLabel>最大并发</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    value={field.value}
                    onChange={(event) => field.onChange(Number(event.target.value))}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="temperature"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Temperature：{field.value.toFixed(1)}</FormLabel>
              <FormControl>
                <Slider
                  min={0}
                  max={2}
                  step={0.1}
                  value={[field.value]}
                  onValueChange={([value]) => field.onChange(value)}
                  aria-label="Temperature"
                />
              </FormControl>
              <FormDescription>越高越发散，越低越稳定。</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="edge_compatible"
          render={({ field }) => (
            <FormItem className="flex items-center justify-between rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
              <div>
                <FormLabel>边缘兼容</FormLabel>
                <FormDescription>开启后，这只龙虾可用于边缘执行链路。</FormDescription>
              </div>
              <FormControl>
                <Switch checked={field.value} onCheckedChange={field.onChange} aria-label="边缘兼容" />
              </FormControl>
            </FormItem>
          )}
        />

        <div className="flex justify-end gap-3">
          <Button type="button" variant="ghost" onClick={() => form.reset(defaultValues)}>
            重置
          </Button>
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? '保存中...' : '保存配置草稿'}
          </Button>
        </div>
      </form>
    </Form>
  );
}
