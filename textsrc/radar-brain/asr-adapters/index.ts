/**
 * ASR 提供方工厂 — 根据 env 切换（后续可接阿里听悟 / Whisper / 通义听悟）
 * ASR_PROVIDER=mock | aliyun | whisper | tongyi
 */

import type { ASRProvider } from '../asr-provider.interface.js';
import { MockASRAdapter } from './mock-asr.adapter.js';

let defaultASR: ASRProvider | null = null;

function createASR(): ASRProvider {
  const provider = (process.env.ASR_PROVIDER ?? 'mock').toLowerCase();
  switch (provider) {
    case 'mock':
      return new MockASRAdapter();
    case 'aliyun':
    case 'whisper':
    case 'tongyi':
      throw new Error(`ASR_PROVIDER=${provider} not implemented yet. Use mock.`);
    default:
      throw new Error(`Unknown ASR_PROVIDER="${process.env.ASR_PROVIDER}". Use: mock | aliyun | whisper | tongyi`);
  }
}

export function getASRProvider(): ASRProvider {
  if (!defaultASR) defaultASR = createASR();
  return defaultASR;
}

export function resetASRProvider(): void {
  defaultASR = null;
}

export { MockASRAdapter };
