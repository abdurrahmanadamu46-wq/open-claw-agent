/**
 * Mock ASR — 无真实调用，返回固定文案，用于单测与演示
 */

import type { ASRProvider, ASRInput, ASROptions } from '../asr-provider.interface.js';

export class MockASRAdapter implements ASRProvider {
  readonly name = 'mock-asr';

  async transcribe(_input: ASRInput, _options?: ASROptions): Promise<string> {
    return '这款面膜真的太好用了，敏感肌也能用。前三天我还在爆痘，现在皮肤稳定很多。成分安全，24小时持妆不脱。';
  }
}
