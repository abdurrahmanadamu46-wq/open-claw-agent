import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
      user?: {
        tenantId: string;
        roles: string[];
        isAdmin: boolean;
        userId?: string;
      };
    }>();
    const auth = req.headers['authorization'] as string | undefined;
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) {
      throw new UnauthorizedException('Missing Bearer token');
    }

    try {
      const payload = this.jwtService.verify<{
        tenantId?: string;
        tenant_id?: string;
        sub?: string;
        role?: string;
        roles?: string[] | string;
      }>(token);
      const roles = this.normalizeRoles(payload.role, payload.roles);
      const tenantScope = payload.tenantId ?? payload.tenant_id ?? payload.sub ?? 'tenant-dev';
      req.user = {
        tenantId: tenantScope,
        roles,
        isAdmin: roles.some((role) =>
          ['admin', 'tenant_admin', 'super_admin', 'ops_admin'].includes(role),
        ),
        userId: payload.sub ?? tenantScope ?? 'user-dev',
      };
      return true;
    } catch {
      throw new UnauthorizedException('Invalid token');
    }
  }

  private normalizeRoles(role?: string, roles?: string[] | string): string[] {
    const collected: string[] = [];
    if (typeof role === 'string' && role.trim()) {
      collected.push(role.trim());
    }
    if (Array.isArray(roles)) {
      for (const item of roles) {
        if (typeof item === 'string' && item.trim()) {
          collected.push(item.trim());
        }
      }
    } else if (typeof roles === 'string' && roles.trim()) {
      for (const item of roles.split(',')) {
        const normalized = item.trim();
        if (normalized) {
          collected.push(normalized);
        }
      }
    }
    return Array.from(new Set(collected.map((item) => item.toLowerCase())));
  }
}
