/**
 * API Routes — 故事→分镜：直接调用外部 AI 适配层（智谱/OpenAI 等）
 */

import { NextRequest, NextResponse } from 'next/server';
import { storyToStoryboard } from '@/server/ai/external';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const story = body.story ?? body.text ?? '';
    const clips = Math.min(20, Math.max(1, Number(body.clips) || 5));

    const result = await storyToStoryboard(story, { clips });
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Storyboard failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
