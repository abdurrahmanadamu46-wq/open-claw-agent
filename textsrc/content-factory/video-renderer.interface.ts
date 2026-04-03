/**
 * AI 内容工厂 — 视频渲染抽象接口
 * 可插拔：HeyGen / 腾讯智影 等，传 JSON 剧本 → 返回任务 ID，通过 webhook 或轮询获取 MP4 链接
 * 剧本可来自 script-generator 或 VideoGenerationService.finalScriptToScriptOutput（按语意断句，每镜含 visual_prompt）
 */

import type { ScriptOutput } from './script-generator.js';

/** 提交渲染任务后的返回（多数平台为异步） */
export interface RenderJobSubmitResult {
  /** 平台任务 ID，用于查询或 webhook 关联 */
  jobId: string;
  /** 可选：轮询状态 URL */
  statusUrl?: string;
  /** 可选：webhook 回调 URL（由调用方提供，平台渲染完成后 POST） */
  webhookUrl?: string;
}

/** 渲染结果（轮询或 webhook 回调体） */
export interface RenderJobResult {
  jobId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  /** 完成时的 MP4 下载链接 */
  mp4Url?: string;
  /** 失败原因 */
  errorMessage?: string;
}

/**
 * 视频渲染提供方抽象接口
 * 实现方：HeyGen、腾讯智影等
 */
export interface VideoRendererProvider {
  readonly name: string;

  /**
   * 提交剧本，创建渲染任务
   * @param script 分镜剧本（来自 script-generator）
   * @param options 数字人 ID、音色、背景等（由各实现定义）
   * @returns 任务 ID 及可选 statusUrl / webhookUrl
   */
  submit(script: ScriptOutput, options?: Record<string, unknown>): Promise<RenderJobSubmitResult>;

  /**
   * 轮询任务状态（可选，部分平台仅支持 webhook）
   * @param jobId submit 返回的 jobId
   * @returns 当前状态与完成时的 mp4Url
   */
  getResult?(jobId: string): Promise<RenderJobResult>;
}
