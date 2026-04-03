/**
 * 视频渲染提供方工厂 — 根据 env 切换
 * VIDEO_RENDERER=mock | heygen | tencent
 */

import type { VideoRendererProvider } from '../video-renderer.interface.js';
import { MockRendererAdapter } from './mock-renderer.adapter.js';

let defaultRenderer: VideoRendererProvider | null = null;

function createRenderer(): VideoRendererProvider {
  const provider = (process.env.VIDEO_RENDERER ?? 'mock').toLowerCase();
  switch (provider) {
    case 'mock':
      return new MockRendererAdapter();
    case 'heygen':
    case 'tencent':
      throw new Error(`VIDEO_RENDERER=${provider} not implemented yet. Use mock.`);
    default:
      throw new Error(`Unknown VIDEO_RENDERER="${process.env.VIDEO_RENDERER}". Use: mock | heygen | tencent`);
  }
}

export function getVideoRenderer(): VideoRendererProvider {
  if (!defaultRenderer) defaultRenderer = createRenderer();
  return defaultRenderer;
}

export function resetVideoRenderer(): void {
  defaultRenderer = null;
}

export { MockRendererAdapter };
