import { NextResponse } from 'next/server';

import { fetchScopeRolloutTrendServer } from '@/server/agent-dashboard.service';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const data = await fetchScopeRolloutTrendServer();
    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to proxy scope rollout trend';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
