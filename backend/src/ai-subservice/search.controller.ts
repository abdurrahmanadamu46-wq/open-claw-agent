import { BadRequestException, Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AiSubserviceService } from './ai-subservice.service';

type AuthedRequest = {
  user?: {
    tenantId?: string;
  };
};

@Controller('api/v1/search')
@UseGuards(JwtAuthGuard)
export class SearchController {
  constructor(private readonly aiSubservice: AiSubserviceService) {}

  @Get()
  search(
    @Req() _req: AuthedRequest | undefined,
    @Query('q') q?: string,
    @Query('types') types?: string,
    @Query('limit') limit?: string,
  ) {
    const query = String(q ?? '').trim();
    if (query.length < 2) {
      throw new BadRequestException('q must be at least 2 chars');
    }
    const parsedLimit = Number(limit ?? 5);
    return this.aiSubservice.search({
      q: query,
      types: types ? String(types).trim() : undefined,
      limit: Number.isFinite(parsedLimit) ? parsedLimit : 5,
    });
  }
}
