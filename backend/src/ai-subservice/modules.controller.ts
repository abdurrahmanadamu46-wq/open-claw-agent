import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AiSubserviceService } from './ai-subservice.service';

type AuthedRequest = {
  headers?: {
    authorization?: string;
  };
};

@Controller('api/v1/modules')
@UseGuards(JwtAuthGuard)
export class ModulesController {
  constructor(private readonly aiSubservice: AiSubserviceService) {}

  @Get()
  getModules(
    @Req() req?: AuthedRequest,
    @Query('lobster_id') lobsterId?: string,
  ) {
    return this.aiSubservice.getModules(
      {
        lobster_id: lobsterId ? String(lobsterId).trim() : undefined,
      },
      req?.headers?.authorization,
    );
  }
}
