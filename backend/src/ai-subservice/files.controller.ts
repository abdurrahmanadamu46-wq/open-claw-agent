import { BadRequestException, Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AiSubserviceService } from './ai-subservice.service';

type AuthedRequest = {
  headers?: {
    authorization?: string;
  };
};

@Controller('api/v1/files')
@UseGuards(JwtAuthGuard)
export class FilesController {
  constructor(private readonly aiSubservice: AiSubserviceService) {}

  @Post('parse')
  parseFile(
    @Req() req?: AuthedRequest,
    @Body() body: Record<string, unknown> = {},
  ) {
    const filename = String(body?.filename ?? '').trim();
    if (!filename) throw new BadRequestException('filename is required');
    return this.aiSubservice.parseFile(body, req?.headers?.authorization);
  }

  @Post('extract-business-card')
  extractBusinessCard(
    @Req() req?: AuthedRequest,
    @Body() body: Record<string, unknown> = {},
  ) {
    const filename = String(body?.filename ?? '').trim();
    if (!filename) throw new BadRequestException('filename is required');
    return this.aiSubservice.extractBusinessCard(body, req?.headers?.authorization);
  }
}
