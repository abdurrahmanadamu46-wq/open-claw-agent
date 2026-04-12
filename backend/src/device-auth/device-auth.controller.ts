import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { DeviceAuthService } from './device-auth.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AgentCCGateway } from '../gateway/agent-cc.gateway';

@Controller('api/v1/devices')
export class DeviceAuthController {
  constructor(
    private readonly deviceAuthService: DeviceAuthService,
    private readonly agentGateway: AgentCCGateway,
  ) {}

  /** Tauri：生成绑定二维码 Ticket */
  @Post('bind-ticket')
  async requestBindTicket(@Body() body: { machine_code: string }) {
    return this.deviceAuthService.createBindTicket(body.machine_code);
  }

  /** 手机/Web：扫码后确认授权（需登录） */
  @UseGuards(JwtAuthGuard)
  @Post('confirm-bind')
  async confirmDeviceBind(
    @Req() req: { user: { tenantId: string } },
    @Body() body: { ticket_id: string },
  ) {
    if (!body?.ticket_id) {
      return { success: false, message: 'ticket_id required' };
    }
    return this.deviceAuthService.confirmTicketAndBind(
      req.user.tenantId,
      body.ticket_id,
    );
  }

  /** 测试用：向当前所有已连上的龙虾客户端下发一条任务。Payload 可含 steps（含 custom_script），见 shared/contracts OpenClawTaskPayload */
  @Post('test-dispatch')
  async testDispatch() {
    const payload = {
      job_id: 'JOB_TEST_' + Date.now(),
      campaign_id: 'CAMP_VIP_TEST',
      action: 'EXECUTE_CAMPAIGN',
      config: { test: true },
    };
    this.agentGateway.server.emit('server.task.dispatch', payload);
    return { ok: true, message: '已向所有已连接客户端下发测试任务', payload };
  }
}
