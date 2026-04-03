/**
 * Mock 去水印 — 直接返回原 URL（无真实处理），用于单测与演示
 */

import type { WatermarkRemoverProvider, WatermarkRemoveResult } from '../watermark-remover.interface.js';

export class MockWatermarkRemoverAdapter implements WatermarkRemoverProvider {
  readonly name = 'mock-watermark-remover';

  async remove(inputUrl: string): Promise<WatermarkRemoveResult> {
    return { outputUrl: inputUrl };
  }
}
