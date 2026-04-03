import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuditLog } from '../common/decorators/audit-log.decorator';
import { AiSubserviceService } from './ai-subservice.service';

type AuthedRequest = {
  headers?: {
    authorization?: string;
  };
};

@Controller('api')
export class MobileController {
  constructor(private readonly aiSubservice: AiSubserviceService) {}

  @Post('mobile/pair/code')
  @UseGuards(JwtAuthGuard)
  @AuditLog({ action: 'create_mobile_pair_code', resource: 'mobile_pairing' })
  createPairCode(@Req() req?: AuthedRequest, @Body() body?: Record<string, unknown>) {
    return this.aiSubservice.createMobilePairCode(body ?? {}, req?.headers?.authorization);
  }

  @Post('mobile/pair')
  pairMobileDevice(@Body() body?: Record<string, unknown>) {
    return this.aiSubservice.pairMobileDevice(body ?? {});
  }

  @Post('notify/push')
  @UseGuards(JwtAuthGuard)
  @AuditLog({ action: 'send_mobile_push', resource: 'mobile_notification' })
  sendMobilePush(@Req() req?: AuthedRequest, @Body() body?: Record<string, unknown>) {
    return this.aiSubservice.sendMobilePush(body ?? {}, req?.headers?.authorization);
  }
}
