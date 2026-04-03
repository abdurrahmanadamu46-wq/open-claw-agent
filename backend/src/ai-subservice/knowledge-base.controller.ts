import { BadRequestException, Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AiSubserviceService } from './ai-subservice.service';

@Controller('api/v1/knowledge-bases')
@UseGuards(JwtAuthGuard)
export class KnowledgeBaseController {
  constructor(private readonly aiSubservice: AiSubserviceService) {}

  @Get()
  list() {
    return this.aiSubservice.listKnowledgeBases();
  }

  @Post()
  create(@Body() body?: { name?: string }) {
    const name = String(body?.name ?? '').trim();
    if (!name) throw new BadRequestException('name is required');
    return this.aiSubservice.createKnowledgeBase({ name });
  }

  @Get(':kbId')
  detail(@Param('kbId') kbId?: string) {
    const normalized = String(kbId ?? '').trim();
    if (!normalized) throw new BadRequestException('kbId is required');
    return this.aiSubservice.getKnowledgeBase(normalized);
  }

  @Post(':kbId/documents')
  upload(@Param('kbId') kbId?: string, @Body() body?: Record<string, unknown>) {
    const normalized = String(kbId ?? '').trim();
    if (!normalized) throw new BadRequestException('kbId is required');
    if (!body || !String(body.filename ?? '').trim()) throw new BadRequestException('filename is required');
    return this.aiSubservice.uploadKnowledgeBaseDocument(normalized, body);
  }

  @Post(':kbId/bind/:lobsterId')
  bind(@Param('kbId') kbId?: string, @Param('lobsterId') lobsterId?: string) {
    const normalizedKbId = String(kbId ?? '').trim();
    const normalizedLobsterId = String(lobsterId ?? '').trim();
    if (!normalizedKbId || !normalizedLobsterId) throw new BadRequestException('kbId and lobsterId are required');
    return this.aiSubservice.bindKnowledgeBase(normalizedKbId, normalizedLobsterId);
  }

  @Get(':kbId/search')
  search(@Param('kbId') kbId?: string, @Query('q') q?: string, @Query('top_k') topK?: string) {
    const normalizedKbId = String(kbId ?? '').trim();
    const normalizedQuery = String(q ?? '').trim();
    if (!normalizedKbId || !normalizedQuery) throw new BadRequestException('kbId and q are required');
    const parsedTopK = Number(topK ?? 5);
    return this.aiSubservice.searchKnowledgeBase(normalizedKbId, normalizedQuery, Number.isFinite(parsedTopK) ? parsedTopK : 5);
  }
}
