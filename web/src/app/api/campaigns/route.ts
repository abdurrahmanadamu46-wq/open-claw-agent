/**
 * API Routes — 战役创建：接收前端请求，转发业务服务层（含外部 AI 调用）
 */

import { NextRequest, NextResponse } from 'next/server';
import { createCampaign } from '@/server/campaign.service';

const CLIPS_BY_TEMPLATE: Record<string, number> = {
  '10s-viral': 5,
  '15s-story': 7,
  '30s-deep': 10,
  '60s-tutorial': 15,
};

function shouldUseMockCampaignRoute() {
  return process.env.NEXT_PUBLIC_USE_MOCK === 'true';
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const productName = body.product_name ?? body.productName ?? '';
    const sellPoints = body.sell_points ?? body.sellPoints ?? '';
    const sopTemplateId = body.sop_template_id ?? body.sopTemplateId ?? '10s-viral';
    const clips = CLIPS_BY_TEMPLATE[sopTemplateId] ?? 5;

    if (shouldUseMockCampaignRoute()) {
      return NextResponse.json({
        campaignId: `camp_demo_${Date.now()}`,
        storyboard: Array.from({ length: clips }).map((_, index) => ({
          order: index + 1,
          duration_sec: 3,
          scene_desc: `演示镜头 ${index + 1}：${productName || '商品展示'}`,
          voice_over: sellPoints || '演示文案',
        })),
        imageUrl: '/demo/mock-image.png',
        videoUrl: '/demo/mock-video.mp4',
      });
    }

    const result = await createCampaign({
      productName,
      sellPoints,
      sopTemplateId,
      clips,
    });

    return NextResponse.json({
      campaignId: result.campaignId,
      storyboard: result.storyboard,
      imageUrl: result.imageUrl,
      videoUrl: result.videoUrl,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Create campaign failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
