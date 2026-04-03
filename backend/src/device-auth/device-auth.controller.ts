import { BadRequestException, Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { DeviceAuthService } from './device-auth.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AgentCCGateway } from '../gateway/agent-cc.gateway';
import { AdminRoleGuard } from '../auth/admin-role.guard';

type AuthedRequest = {
  user?: {
    tenantId?: string;
  };
};

@Controller('api/v1/devices')
export class DeviceAuthController {
  constructor(
    private readonly deviceAuthService: DeviceAuthService,
    private readonly agentGateway: AgentCCGateway,
  ) {}

  @Post('bind-ticket')
  async requestBindTicket(@Body() body: { machine_code: string }) {
    return this.deviceAuthService.createBindTicket(body.machine_code);
  }

  @UseGuards(JwtAuthGuard)
  @Post('confirm-bind')
  async confirmDeviceBind(
    @Req() req: { user: { tenantId: string } },
    @Body() body: { ticket_id: string },
  ) {
    if (!body?.ticket_id) {
      return { success: false, message: 'ticket_id required' };
    }
    return this.deviceAuthService.confirmTicketAndBind(req.user.tenantId, body.ticket_id);
  }

  @UseGuards(JwtAuthGuard, AdminRoleGuard)
  @Get()
  async listBoundDevices(@Req() req?: AuthedRequest, @Query('limit') limit?: string) {
    const tenantId = req?.user?.tenantId?.trim();
    if (!tenantId) {
      throw new BadRequestException('tenant scope is required');
    }
    const parsedLimit = limit ? Number.parseInt(limit, 10) : 100;
    if (!Number.isFinite(parsedLimit) || parsedLimit <= 0) {
      throw new BadRequestException('limit must be a positive integer');
    }
    const devices = await this.deviceAuthService.listBoundDevices(tenantId, parsedLimit);
    return { code: 0, data: { list: devices } };
  }

  @UseGuards(JwtAuthGuard, AdminRoleGuard)
  @Post('test-dispatch')
  async testDispatch() {
    const traceId = `trc_test_${Date.now()}`;
    const payload = {
      job_id: 'JOB_TEST_' + Date.now(),
      trace_id: traceId,
      campaign_id: 'CAMP_VIP_TEST',
      action: 'EXECUTE_CAMPAIGN',
      config: { test: true },
    };
    this.agentGateway.server.emit('server.task.dispatch', payload);
    return { ok: true, message: 'test dispatch emitted', payload, traceId };
  }
}
