import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { LeadService } from './lead.service';

type InternalLeadCreatePayload = {
  tenant_id?: string;
  campaign_id?: string;
  contact_info?: string;
  intention_score?: number;
  source_platform?: string;
  raw_context?: string;
};

function resolveInternalSecret(): string {
  return (
    process.env.INTERNAL_API_SECRET?.trim() ||
    process.env.NEW_API_TOKEN?.trim() ||
    ''
  );
}

@Controller('api/internal/leads')
export class InternalLeadController {
  constructor(private readonly leadService: LeadService) {}

  @Post()
  async createInternalLead(
    @Headers('x-internal-secret') internalSecret: string | undefined,
    @Body() body: InternalLeadCreatePayload,
  ) {
    const expectedSecret = resolveInternalSecret();
    if (!expectedSecret || internalSecret?.trim() !== expectedSecret) {
      throw new UnauthorizedException('invalid internal secret');
    }

    const tenantId = body.tenant_id?.trim();
    const campaignId = body.campaign_id?.trim();
    const contactInfo = body.contact_info?.trim();
    const intentionScore =
      typeof body.intention_score === 'number' ? body.intention_score : NaN;

    if (!tenantId) {
      throw new BadRequestException('tenant_id is required');
    }
    if (!campaignId) {
      throw new BadRequestException('campaign_id is required');
    }
    if (!contactInfo) {
      throw new BadRequestException('contact_info is required');
    }
    if (!Number.isFinite(intentionScore)) {
      throw new BadRequestException('intention_score must be a number');
    }

    const lead = await this.leadService.ingestFromEdge({
      tenant_id: tenantId,
      campaign_id: campaignId,
      contact_info: contactInfo,
      intention_score: intentionScore,
      source_platform: body.source_platform?.trim() || 'other',
      user_message: body.raw_context?.trim() || '',
    });

    return {
      code: 0,
      message: 'lead accepted',
      lead_id: lead.lead_id,
      data: {
        lead_id: lead.lead_id,
        campaign_id: lead.campaign_id,
        tenant_id: lead.tenant_id,
        intent_score: lead.intent_score,
      },
    };
  }
}
