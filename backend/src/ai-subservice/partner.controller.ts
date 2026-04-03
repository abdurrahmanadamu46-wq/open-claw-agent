import { BadRequestException, Body, Controller, ForbiddenException, Get, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuditLog } from '../common/decorators/audit-log.decorator';
import { AiSubserviceService } from './ai-subservice.service';

type AuthedRequest = {
  user?: {
    roles?: string[];
  };
};

function isAdmin(req?: AuthedRequest): boolean {
  const roles = req?.user?.roles ?? [];
  return roles.map((item) => String(item).toLowerCase()).includes('admin');
}

@Controller('api/v1/ai/partner')
@UseGuards(JwtAuthGuard)
export class PartnerController {
  constructor(private readonly aiSubservice: AiSubserviceService) {}

  @Post('register')
  @AuditLog({ action: 'register_partner', resource: 'partner' })
  register(@Req() req?: AuthedRequest, @Body() body?: Record<string, unknown>) {
    if (!isAdmin(req)) {
      throw new ForbiddenException('Admin role required');
    }
    return this.aiSubservice.registerPartner(body ?? {});
  }

  @Get('dashboard')
  dashboard(@Query('agent_id') agentId?: string) {
    const normalized = String(agentId ?? '').trim();
    if (!normalized) {
      throw new BadRequestException('agent_id is required');
    }
    return this.aiSubservice.getPartnerDashboard(normalized);
  }

  @Get('seats')
  seats(@Query('agent_id') agentId?: string) {
    const normalized = String(agentId ?? '').trim();
    if (!normalized) {
      throw new BadRequestException('agent_id is required');
    }
    return this.aiSubservice.getPartnerSeats(normalized);
  }

  @Post('seats/assign')
  @AuditLog({ action: 'assign_partner_seat', resource: 'partner_seat' })
  assignSeat(@Query('agent_id') agentId?: string, @Body() body?: Record<string, unknown>) {
    const normalized = String(agentId ?? '').trim();
    if (!normalized) {
      throw new BadRequestException('agent_id is required');
    }
    return this.aiSubservice.assignPartnerSeat(normalized, body ?? {});
  }

  @Post('upgrade')
  @AuditLog({ action: 'upgrade_partner', resource: 'partner' })
  upgrade(@Query('agent_id') agentId?: string, @Body() body?: Record<string, unknown>) {
    const normalized = String(agentId ?? '').trim();
    if (!normalized) {
      throw new BadRequestException('agent_id is required');
    }
    return this.aiSubservice.upgradePartner(normalized, body ?? {});
  }

  @Get('white-label')
  whiteLabel(@Query('agent_id') agentId?: string) {
    const normalized = String(agentId ?? '').trim();
    if (!normalized) {
      throw new BadRequestException('agent_id is required');
    }
    return this.aiSubservice.getPartnerWhiteLabel(normalized);
  }

  @Put('white-label')
  @AuditLog({ action: 'update_partner_white_label', resource: 'partner_white_label' })
  updateWhiteLabel(@Query('agent_id') agentId?: string, @Body() body?: Record<string, unknown>) {
    const normalized = String(agentId ?? '').trim();
    if (!normalized) {
      throw new BadRequestException('agent_id is required');
    }
    return this.aiSubservice.updatePartnerWhiteLabel(normalized, body ?? {});
  }

  @Post('sub-agents')
  @AuditLog({ action: 'create_sub_agent', resource: 'sub_agent' })
  createSubAgent(@Query('agent_id') agentId?: string, @Body() body?: Record<string, unknown>) {
    const normalized = String(agentId ?? '').trim();
    if (!normalized) {
      throw new BadRequestException('agent_id is required');
    }
    return this.aiSubservice.createPartnerSubAgent(normalized, body ?? {});
  }

  @Get('sub-agents/tree')
  subAgentTree(@Query('agent_id') agentId?: string) {
    const normalized = String(agentId ?? '').trim();
    if (!normalized) {
      throw new BadRequestException('agent_id is required');
    }
    return this.aiSubservice.getPartnerSubAgentTree(normalized);
  }

  @Get('statements')
  statements(@Query('agent_id') agentId?: string) {
    const normalized = String(agentId ?? '').trim();
    if (!normalized) {
      throw new BadRequestException('agent_id is required');
    }
    return this.aiSubservice.getPartnerStatements(normalized);
  }

  @Get('statements/detail')
  statementDetail(@Query('agent_id') agentId?: string, @Query('period') period?: string) {
    const normalized = String(agentId ?? '').trim();
    const normalizedPeriod = String(period ?? '').trim();
    if (!normalized || !normalizedPeriod) {
      throw new BadRequestException('agent_id and period are required');
    }
    return this.aiSubservice.getPartnerStatementDetail(normalized, normalizedPeriod);
  }

  @Post('statements/confirm')
  @AuditLog({ action: 'confirm_partner_statement', resource: 'partner_statement' })
  confirmStatement(@Query('agent_id') agentId?: string, @Query('period') period?: string, @Body() body?: Record<string, unknown>) {
    const normalized = String(agentId ?? '').trim();
    const normalizedPeriod = String(period ?? '').trim();
    if (!normalized || !normalizedPeriod) {
      throw new BadRequestException('agent_id and period are required');
    }
    return this.aiSubservice.confirmPartnerStatement(normalized, normalizedPeriod, body ?? {});
  }

  @Post('statements/dispute')
  @AuditLog({ action: 'dispute_partner_statement', resource: 'partner_statement' })
  disputeStatement(@Query('agent_id') agentId?: string, @Query('period') period?: string, @Body() body?: Record<string, unknown>) {
    const normalized = String(agentId ?? '').trim();
    const normalizedPeriod = String(period ?? '').trim();
    if (!normalized || !normalizedPeriod) {
      throw new BadRequestException('agent_id and period are required');
    }
    return this.aiSubservice.disputePartnerStatement(normalized, normalizedPeriod, body ?? {});
  }

  @Get('profit-forecast')
  profitForecast(@Query('agent_id') agentId?: string) {
    const normalized = String(agentId ?? '').trim();
    if (!normalized) {
      throw new BadRequestException('agent_id is required');
    }
    return this.aiSubservice.getPartnerProfitForecast(normalized);
  }
}
