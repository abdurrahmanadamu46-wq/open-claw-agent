/**
 * Mock 视频渲染 — 不调用真实 API，返回占位 jobId 与假 mp4Url，用于单测与演示
 */

import type { VideoRendererProvider, RenderJobSubmitResult, RenderJobResult } from '../video-renderer.interface.js';
import type { ScriptOutput } from '../script-generator.js';

export class MockRendererAdapter implements VideoRendererProvider {
  readonly name = 'mock-renderer';

  async submit(script: ScriptOutput, _options?: Record<string, unknown>): Promise<RenderJobSubmitResult> {
    return {
      jobId: `mock-job-${Date.now()}-${script.scenes.length}`,
      statusUrl: undefined,
      webhookUrl: undefined,
    };
  }

  async getResult(jobId: string): Promise<RenderJobResult> {
    return {
      jobId,
      status: 'completed',
      mp4Url: `https://mock-cdn.example.com/rendered/${jobId}.mp4`,
    };
  }
}
