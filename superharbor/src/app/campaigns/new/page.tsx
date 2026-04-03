'use client';

/**
 * 战役创建中心 (Campaign Builder) — SuperHarbor 核心表单
 * 提交后通过统一业务网关触发云端 AI 编排工作流（元老院 → 任务队列与打包器 → WSS 调度）
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select } from '@/components/ui/select';
import { createCampaign } from '@/lib/api';
import { useCampaignsStore } from '@/store';
import type { CampaignCreatePayload } from '@/types';
import { SOP_TEMPLATES } from '@/constants/sop-templates';
import { Swords, Loader2 } from 'lucide-react';

const initialForm: CampaignCreatePayload = {
  targetAccountUrls: '',
  productName: '',
  sellPoints: '',
  sopTemplateId: SOP_TEMPLATES[0]?.id ?? '',
};

export default function CampaignBuilderPage() {
  const router = useRouter();
  const addCampaign = useCampaignsStore((s) => s.addCampaign);
  const [form, setForm] = useState<CampaignCreatePayload>(initialForm);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await createCampaign(form);
      addCampaign({
        campaignId: res.campaignId,
        campaignName: form.productName || '未命名战役',
        status: 'Generating',
        progress: 0,
        totalSlots: SOP_TEMPLATES.find((t) => t.id === form.sopTemplateId)?.clips,
        createdAt: new Date().toISOString(),
      });
      router.push('/tasks');
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-6">
      <div className="mb-8">
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <Swords className="h-7 w-7 text-primary" />
          战役创建中心
        </h1>
        <p className="text-muted-foreground">
          填写目标与卖点，选择 SOP 模版，提交后由云端 AI 编排并下发至边缘节点执行
        </p>
      </div>

      <form onSubmit={handleSubmit}>
        <Card className="max-w-2xl">
          <CardHeader>
            <CardTitle>新建营销战役</CardTitle>
            <CardDescription>目标对标账号、推广产品、核心卖点与 SOP 模版</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="targetAccountUrls">目标对标账号 URL</Label>
              <Textarea
                id="targetAccountUrls"
                placeholder="一行一个，例如：&#10;https://www.xiaohongshu.com/user/profile/xxx&#10;https://www.douyin.com/user/yyy"
                value={form.targetAccountUrls}
                onChange={(e) => setForm((f) => ({ ...f, targetAccountUrls: e.target.value }))}
                rows={4}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="productName">推广产品名称</Label>
              <Input
                id="productName"
                placeholder="例：XX 品牌口红 #03 色号"
                value={form.productName}
                onChange={(e) => setForm((f) => ({ ...f, productName: e.target.value }))}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="sellPoints">核心卖点</Label>
              <Textarea
                id="sellPoints"
                placeholder="每行一个卖点，例如：&#10;显白不拔干&#10;黄皮亲妈&#10;持妆 8 小时"
                value={form.sellPoints}
                onChange={(e) => setForm((f) => ({ ...f, sellPoints: e.target.value }))}
                rows={4}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="sopTemplateId">SOP 模版</Label>
              <Select
                id="sopTemplateId"
                value={form.sopTemplateId}
                onChange={(e) => setForm((f) => ({ ...f, sopTemplateId: e.target.value }))}
                required
              >
                {SOP_TEMPLATES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </Select>
            </div>

            {error && (
              <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <Button type="submit" disabled={submitting}>
                {submitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    提交中…
                  </>
                ) : (
                  '提交并触发 AI 编排'
                )}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => router.push('/tasks')}
              >
                取消
              </Button>
            </div>
          </CardContent>
        </Card>
      </form>
    </div>
  );
}
