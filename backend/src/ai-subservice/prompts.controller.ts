import { BadRequestException, Controller, ForbiddenException, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AiSubserviceService } from './ai-subservice.service';

type AuthedRequest = {
  headers?: {
    authorization?: string;
  };
  user?: {
    roles?: string[];
    isAdmin?: boolean;
  };
};

function isAdmin(req?: AuthedRequest): boolean {
  if (req?.user?.isAdmin) return true;
  const roles = req?.user?.roles ?? [];
  return roles.map((item) => String(item).toLowerCase()).includes('admin');
}

@Controller('api/v1/prompts')
@UseGuards(JwtAuthGuard)
export class PromptsController {
  constructor(private readonly aiSubservice: AiSubserviceService) {}

  @Get()
  listPrompts(@Req() req?: AuthedRequest) {
    if (!isAdmin(req)) throw new ForbiddenException('Admin role required');
    return this.aiSubservice.listPrompts(req?.headers?.authorization);
  }

  @Get(':promptName/versions')
  listPromptVersions(
    @Req() req?: AuthedRequest,
    @Param('promptName') promptName?: string,
  ) {
    if (!isAdmin(req)) throw new ForbiddenException('Admin role required');
    const normalizedPromptName = String(promptName ?? '').trim();
    if (!normalizedPromptName) throw new BadRequestException('promptName is required');
    return this.aiSubservice.listPromptVersions(normalizedPromptName, req?.headers?.authorization);
  }

  @Get(':promptName/diff')
  diffPromptVersions(
    @Req() req?: AuthedRequest,
    @Param('promptName') promptName?: string,
    @Query('version_a') versionA?: string,
    @Query('version_b') versionB?: string,
  ) {
    if (!isAdmin(req)) throw new ForbiddenException('Admin role required');
    const normalizedPromptName = String(promptName ?? '').trim();
    if (!normalizedPromptName) throw new BadRequestException('promptName is required');
    return this.aiSubservice.diffPromptVersions(normalizedPromptName, {
      version_a: versionA ? String(versionA).trim() : undefined,
      version_b: versionB ? String(versionB).trim() : undefined,
    });
  }
}
