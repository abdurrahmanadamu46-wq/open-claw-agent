import { BadRequestException, Body, Controller, ServiceUnavailableException, Post } from '@nestjs/common';

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

type UpstreamResult = {
  action?: unknown;
  x?: unknown;
  y?: unknown;
  text?: unknown;
  reason?: unknown;
};

@Controller('api/v1/vlm')
export class VlmController {
  @Post('analyze')
  async analyze(@Body() dto: VlmAnalyzeDto): Promise<VlmAnalyzeResult> {
    const imageBase64 = String(dto?.imageBase64 ?? '').trim();
    if (!imageBase64) {
      throw new BadRequestException('imageBase64 is required');
    }

    const endpoint = String(process.env.VLM_ENDPOINT_URL ?? '').trim();
    if (!endpoint) {
      throw new ServiceUnavailableException('VLM provider not configured');
    }

    const authToken = String(process.env.VLM_API_KEY ?? '').trim();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (authToken) headers.Authorization = `Bearer ${authToken}`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({ imageBase64 }),
    });
    if (!response.ok) {
      throw new ServiceUnavailableException(`VLM upstream failed: ${response.status}`);
    }

    const data = (await response.json()) as UpstreamResult;
    const action = String(data?.action ?? '').trim();
    if (action !== 'click' && action !== 'type') {
      throw new ServiceUnavailableException('Invalid VLM response: action');
    }

    if (action === 'click') {
      const x = Number(data?.x);
      const y = Number(data?.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        throw new ServiceUnavailableException('Invalid VLM response: coordinates');
      }
      return {
        action: 'click',
        x,
        y,
        reason: String(data?.reason ?? '').trim() || 'vlm_click',
      };
    }

    const text = String(data?.text ?? '').trim();
    if (!text) {
      throw new ServiceUnavailableException('Invalid VLM response: text');
    }
    return {
      action: 'type',
      text,
      reason: String(data?.reason ?? '').trim() || 'vlm_type',
    };
  }
}

