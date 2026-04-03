/**
 * ClawCommerce LLM 抽象层 — 统一导出
 * 业务侧：import { getLLMProvider } from '@/textsrc/llm' 或相对路径
 */

export type { LLMProvider, LLMMessage, ChatOptions, StructuredJsonOptions } from './provider.interface.js';
export { getLLMProvider, resetLLMProvider } from './adapters/index.js';
export { buildSchemaInstruction, extractAndParseJson, extractAndParseJsonWithRetry } from './structured-output.js';
