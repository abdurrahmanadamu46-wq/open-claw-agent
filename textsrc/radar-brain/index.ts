/**
 * 雷达大脑 — 统一导出
 */

export type {
  CrawlerPlatform,
  CrawlerActionType,
  CrawlerAction,
  CompetitorMonitorTask,
} from './crawler-task.js';
export {
  buildCompetitorMonitorTask,
  serializeCrawlerTask,
  deserializeCrawlerTask,
} from './crawler-task.js';

export type { ASRProvider, ASRInput, ASROptions } from './asr-provider.interface.js';
export { getASRProvider, resetASRProvider } from './asr-adapters/index.js';

export type { ViralDisassembleResult } from './content-disassembler.js';
export { disassembleViralContent } from './content-disassembler.js';
