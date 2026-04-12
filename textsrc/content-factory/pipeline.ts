/**
 * AI 内容工厂 — 全流程 Pipeline
 * 剧本生成 → 可选视频渲染，串联 script-generator 与 video-renderer
 */

import { generateScript, generateScriptFromViral } from './script-generator.js';
import type { ScriptOutput, ScriptDuration } from './script-generator.js';
import { getVideoRenderer } from './renderer-adapters/index.js';
import { getWatermarkRemover } from './watermark-remover-adapters/index.js';
import type { ViralDisassembleResult } from '../radar-brain/content-disassembler.js';

export interface PipelineInput {
  /** 视频时长，决定分镜数 */
  durationSeconds: ScriptDuration;
  /** 主推卖点（必填） */
  sellingPoints: string[];
  /** 可选：爆款拆解结果，用于融梗 */
  viral?: ViralDisassembleResult;
  /** 可选：产品文案补充 */
  productCopy?: string;
  /** 是否提交渲染（默认 true，mock 下可立即拿假 jobId） */
  submitRender?: boolean;
  /** 合规选项：勾选后对生成的视频/图片执行去水印步骤，产出无水印版本 */
  removeWatermark?: boolean;
}

export interface PipelineOutput {
  script: ScriptOutput;
  /** 若 submitRender 且成功提交 */
  renderJobId?: string;
  /** 若 renderer 支持 getResult 且同步完成（mock 可返回） */
  mp4Url?: string;
}

/**
 * 内容工厂全流程：生成剧本 → 可选提交渲染
 */
export async function runContentPipeline(input: PipelineInput): Promise<PipelineOutput> {
  const script = input.viral
    ? await generateScriptFromViral(input.viral, input.durationSeconds, input.productCopy)
    : await generateScript(
        {
          sellingPoints: input.sellingPoints,
          productCopy: input.productCopy,
        },
        input.durationSeconds
      );

  const output: PipelineOutput = { script };

  if (input.submitRender !== false) {
    const renderer = getVideoRenderer();
    const { jobId } = await renderer.submit(script);
    output.renderJobId = jobId;
    if (renderer.getResult) {
      const result = await renderer.getResult(jobId);
      if (result.status === 'completed' && result.mp4Url) {
        let mp4Url = result.mp4Url;
        if (input.removeWatermark) {
          const remover = getWatermarkRemover();
          const { outputUrl } = await remover.remove(mp4Url);
          mp4Url = outputUrl;
        }
        output.mp4Url = mp4Url;
      }
    }
  }

  return output;
}
