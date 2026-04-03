import { NextRequest, NextResponse } from 'next/server';
import {
  buildIndustryWorkflowBlueprintPreview,
  buildIndustryWorkflowTaskDescription,
  type IndustryWorkflowRequest,
} from '@/lib/industry-workflow';

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      request?: IndustryWorkflowRequest;
    };

    if (!body?.request) {
      return NextResponse.json({ ok: false, error: 'request is required' }, { status: 400 });
    }

    const workflowRequest = body.request;
    const blueprint = buildIndustryWorkflowBlueprintPreview(workflowRequest);
    const taskDescription = buildIndustryWorkflowTaskDescription(workflowRequest);

    return NextResponse.json({
      ok: true,
      request: workflowRequest,
      blueprint,
      task_description: taskDescription,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Industry workflow preview failed';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
