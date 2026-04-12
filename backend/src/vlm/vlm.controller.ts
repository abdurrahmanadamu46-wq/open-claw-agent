import { Body, Controller, Post } from '@nestjs/common';

/**
 * VLM 视觉大模型分析接口
 * 接收 Lobster 节点截屏 Base64，返回建议的点击坐标或输入文本，供前端调用 enigo 执行
 */
export interface VlmAnalyzeDto {
  imageBase64: string;
}

export interface VlmAnalyzeResult {
  action: 'click' | 'type';
  x?: number;
  y?: number;
  text?: string;
  reason?: string;
}

@Controller('api/v1/vlm')
export class VlmController {
  /**
   * 分析截屏并返回建议动作（演示用：返回固定坐标；生产可接入 GPT-4V / Claude Vision / 自建 VLM）
   */
  @Post('analyze')
  analyze(@Body() dto: VlmAnalyzeDto): VlmAnalyzeResult {
    if (!dto?.imageBase64) {
      return { action: 'click', x: 100, y: 200, reason: 'missing image (demo fallback)' };
    }
    // TODO: 调用真实 VLM，解析画面中的可点击区域或输入框+文案
    return {
      action: 'click',
      x: 400,
      y: 300,
      reason: 'demo: fixed position, replace with real VLM call',
    };
  }
}
