import { Body, Controller, Get, Post, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { AiSubserviceService } from '../ai-subservice/ai-subservice.service';
import { TenantRegistryService } from '../tenant-profiles/tenant-registry.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { AdminRoleGuard } from './admin-role.guard';
import { SessionAuthService } from './session-auth.service';
import { AuditLog } from '../common/decorators/audit-log.decorator';
import { RateLimit, RateLimitGuard } from '../common/guards/rate-limit.guard';

type LoginBody = {
  username?: string;
  password?: string;
};

type RegisterBody = {
  email?: string;
  password?: string;
  username?: string;
  tenant_id?: string;
};

type ForgotPasswordBody = {
  email?: string;
};

type ResetPasswordBody = {
  token?: string;
  password?: string;
};

type AuthedRequest = {
  user?: {
    tenantId?: string;
    roles?: string[];
    userId?: string;
  };
};

@Controller()
export class SessionAuthController {
  constructor(
    private readonly sessionAuthService: SessionAuthService,
    private readonly aiSubserviceService: AiSubserviceService,
    private readonly tenantRegistryService: TenantRegistryService,
  ) {}

  @Post('auth/login')
  @UseGuards(RateLimitGuard)
  @RateLimit(5, 300000)
  @AuditLog({ action: 'login', resource: 'auth' })
  async login(@Body() body: LoginBody) {
    const username = String(body?.username ?? '').trim();
    const password = String(body?.password ?? '');
    let result;
    try {
      result = this.sessionAuthService.login(username, password);
    } catch {
      const upstream = await this.aiSubserviceService.publicPasswordLogin({ username, password });
      const accessToken = String(upstream.access_token ?? '').trim();
      if (!accessToken) {
        throw new UnauthorizedException('Username or password incorrect');
      }
      const profile = await this.aiSubserviceService.publicAuthMe(accessToken);
      const tenantId = String(profile.tenant_id ?? '').trim() || 'tenant_main';
      const roles = Array.isArray(profile.roles) && profile.roles.length > 0
        ? profile.roles.map((item) => String(item).trim().toLowerCase()).filter(Boolean)
        : ['member'];
      result = this.sessionAuthService.issueLoginResult({
        id: String(profile.username ?? username).trim() || username,
        name: String(profile.username ?? username).trim() || username,
        tenantId,
        roles,
      });
    }
    return {
      token: result.token,
      access_token: result.token,
      token_type: 'bearer',
      expires_in: result.expiresIn,
      user: result.user,
    };
  }

  @Post('auth/register')
  @UseGuards(RateLimitGuard)
  @RateLimit(10, 300000)
  @AuditLog({ action: 'register', resource: 'auth' })
  async register(@Body() body: RegisterBody) {
    const email = String(body?.email ?? '').trim().toLowerCase();
    const password = String(body?.password ?? '');
    const username = String(body?.username ?? '').trim();
    const tenantId = String(body?.tenant_id ?? '').trim() || undefined;
    const result = await this.aiSubserviceService.publicRegister({
      email,
      password,
      username: username || undefined,
      tenant_id: tenantId,
      roles: ['member'],
    });
    const resolvedTenantId = String(result?.tenant_id ?? tenantId ?? '').trim();
    if (resolvedTenantId) {
      await this.tenantRegistryService.ensureTenant(resolvedTenantId, {
        name: username || email || resolvedTenantId,
      });
    }
    return result;
  }

  @Post('auth/forgot-password')
  @UseGuards(RateLimitGuard)
  @RateLimit(5, 300000)
  @AuditLog({ action: 'forgot_password', resource: 'auth' })
  async forgotPassword(@Body() body: ForgotPasswordBody) {
    const email = String(body?.email ?? '').trim().toLowerCase();
    return this.aiSubserviceService.publicForgotPassword(email);
  }

  @Post('auth/reset-password')
  @UseGuards(RateLimitGuard)
  @RateLimit(5, 300000)
  @AuditLog({ action: 'reset_password', resource: 'auth' })
  async resetPassword(@Body() body: ResetPasswordBody) {
    const token = String(body?.token ?? '').trim();
    const password = String(body?.password ?? '');
    return this.aiSubserviceService.publicResetPassword({ token, password });
  }

  @Get('api/v1/me')
  @UseGuards(JwtAuthGuard)
  async currentUser(@Req() req: AuthedRequest) {
    const tenantId = req?.user?.tenantId ?? 'tenant-dev';
    const userId = req?.user?.userId ?? tenantId;
    const roles = req?.user?.roles ?? ['merchant'];
    const tenant = await this.tenantRegistryService.ensureTenant(tenantId, {
      name: tenantId,
    });
    return {
      code: 0,
      data: {
        id: userId,
        name: userId,
        role: roles[0] ?? 'merchant',
        roles,
        tenantId,
        tenantName: tenant.name,
        isAdmin: roles.includes('admin'),
      },
    };
  }

  @Get('api/v1/auth/me')
  @UseGuards(JwtAuthGuard)
  currentUserAlias(@Req() req: AuthedRequest) {
    return this.currentUser(req);
  }

  @Get('api/v1/auth/users')
  @UseGuards(JwtAuthGuard, AdminRoleGuard)
  listUsers(@Req() req: AuthedRequest) {
    const tenantId = req?.user?.tenantId?.trim();
    return {
      code: 0,
      data: {
        tenantId: tenantId ?? '',
        users: this.sessionAuthService.listUsers(tenantId),
      },
    };
  }
}
