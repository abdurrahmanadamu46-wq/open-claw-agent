/**
 * AI 内容工厂 — 统一导出
 */

export type { SceneItem, ScriptOutput, ScriptDuration } from './script-generator.js';
export { generateScript, generateScriptFromViral, DURATION_SCENE_MAP } from './script-generator.js';

export type {
  VideoRendererProvider,
  RenderJobSubmitResult,
  RenderJobResult,
} from './video-renderer.interface.js';
export { getVideoRenderer, resetVideoRenderer } from './renderer-adapters/index.js';

export type { PipelineInput, PipelineOutput } from './pipeline.js';
export { runContentPipeline } from './pipeline.js';
