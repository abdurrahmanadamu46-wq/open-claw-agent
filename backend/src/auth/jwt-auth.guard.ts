import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

/**
 * 商家控制台鉴权：从 Authorization: Bearer 解析 JWT，写入 req.user.tenantId
 * 生产环境请换成你们现有的 Auth 模块 / Passport 策略
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const auth = req.headers['authorization'] as string | undefined;
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) throw new UnauthorizedException('Missing Bearer token');

    try {
      const payload = this.jwtService.verify<{ tenantId?: string; sub?: string }>(
        token,
      );
      // 控制台用户 JWT 需带 tenantId；开发可用 payload.tenantId 或 sub
      req.user = {
        tenantId: payload.tenantId ?? payload.sub ?? 'tenant-dev',
      };
      return true;
    } catch {
      throw new UnauthorizedException('Invalid token');
    }
  }
}
