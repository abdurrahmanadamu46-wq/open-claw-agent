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
import { Button } from '@/components/ui/Button';
import type { Tenant } from '@/contexts/TenantContext';

const businessTypes = ['自媒体机构', '营销服务商', '企业市场部', '个人创作者', '其他'] as const;
const teamSizes = ['1-5人', '6-20人', '21-100人', '100人以上'] as const;

export const onboardingStep1Schema = z.object({
  brand_name: z.string().min(2, '品牌名称至少 2 个字').max(50, '最多 50 个字符'),
  contact_name: z.string().min(1, '联系人姓名不能为空').max(30, '最多 30 个字符'),
  contact_email: z.string().email('请输入有效邮箱'),
  contact_phone: z
    .string()
    .regex(/^1[3-9]\d{9}$/, '请输入有效中国手机号')
    .or(z.literal('')),
  domain: z
    .string()
    .regex(/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i, '请输入有效域名，例如 myagency.com')
    .or(z.literal('')),
  business_type: z.enum(businessTypes),
  team_size: z.enum(teamSizes),
  referral_code: z.string().max(20, '最多 20 个字符').optional().default(''),
});

export type OnboardingStep1Values = z.infer<typeof onboardingStep1Schema>;

export function OnboardingStep1Form({
  tenant,
  onNext,
}: {
  tenant?: Tenant | null;
  onNext: (values: OnboardingStep1Values) => Promise<void>;
}) {
  const defaultValues = useMemo<OnboardingStep1Values>(
    () => ({
      brand_name: tenant?.name || '',
      contact_name: '',
      contact_email: '',
      contact_phone: '',
      domain: '',
      business_type: '营销服务商',
      team_size: '6-20人',
      referral_code: '',
    }),
    [tenant],
  );

  const form = useForm<OnboardingStep1Values>({
    resolver: zodResolver(onboardingStep1Schema),
    defaultValues,
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onNext)} className="space-y-5">
        <div className="grid gap-4 md:grid-cols-2">
          <FormField
            control={form.control}
            name="brand_name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>品牌 / 机构名称</FormLabel>
                <FormControl>
                  <Input {...field} placeholder="例如：星跃内容工作室" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="domain"
            render={({ field }) => (
              <FormItem>
                <FormLabel>自有域名</FormLabel>
                <FormControl>
                  <Input {...field} placeholder="myagency.com" />
                </FormControl>
                <FormDescription>用于后续白标与登录域名规划。</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <FormField
            control={form.control}
            name="contact_name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>联系人姓名</FormLabel>
                <FormControl>
                  <Input {...field} placeholder="张经理" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="contact_email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>联系邮箱</FormLabel>
                <FormControl>
                  <Input {...field} type="email" placeholder="contact@example.com" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <FormField
            control={form.control}
            name="contact_phone"
            render={({ field }) => (
              <FormItem>
                <FormLabel>手机号</FormLabel>
                <FormControl>
                  <Input {...field} placeholder="13800138000" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="referral_code"
            render={({ field }) => (
              <FormItem>
                <FormLabel>推荐码</FormLabel>
                <FormControl>
                  <Input {...field} placeholder="可选" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <FormField
            control={form.control}
            name="business_type"
            render={({ field }) => (
              <FormItem>
                <FormLabel>业务类型</FormLabel>
                <FormControl>
                  <select
                    value={field.value}
                    onChange={(event) => field.onChange(event.target.value)}
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/65 px-4 py-3 text-sm text-slate-100 outline-none focus:border-cyan-400/40 focus:ring-2 focus:ring-cyan-400/15"
                  >
                    {businessTypes.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="team_size"
            render={({ field }) => (
              <FormItem>
                <FormLabel>团队规模</FormLabel>
                <FormControl>
                  <select
                    value={field.value}
                    onChange={(event) => field.onChange(event.target.value)}
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/65 px-4 py-3 text-sm text-slate-100 outline-none focus:border-cyan-400/40 focus:ring-2 focus:ring-cyan-400/15"
                  >
                    {teamSizes.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="flex justify-end">
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? '保存中...' : '保存基础信息并继续'}
          </Button>
        </div>
      </form>
    </Form>
  );
}
