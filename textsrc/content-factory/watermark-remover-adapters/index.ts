/**
 * 去水印提供方工厂 — 根据 env 切换
 * WATERMARK_REMOVER=mock | internal | 第三方
 */

import type { WatermarkRemoverProvider } from '../watermark-remover.interface.js';
import { MockWatermarkRemoverAdapter } from './mock-remover.adapter.js';

let defaultRemover: WatermarkRemoverProvider | null = null;

function createRemover(): WatermarkRemoverProvider {
  const provider = (process.env.WATERMARK_REMOVER ?? 'mock').toLowerCase();
  switch (provider) {
    case 'mock':
      return new MockWatermarkRemoverAdapter();
    default:
      throw new Error(`Unknown WATERMARK_REMOVER="${process.env.WATERMARK_REMOVER}". Use: mock`);
  }
}

export function getWatermarkRemover(): WatermarkRemoverProvider {
  if (!defaultRemover) defaultRemover = createRemover();
  return defaultRemover;
}

export function resetWatermarkRemover(): void {
  defaultRemover = null;
}

export { MockWatermarkRemoverAdapter };
