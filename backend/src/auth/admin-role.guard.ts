import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';

type RequestWithUser = {
  user?: {
    tenantId?: string;
    isAdmin?: boolean;
    roles?: string[];
  };
};

@Injectable()
export class AdminRoleGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<RequestWithUser>();
    if (!req.user?.tenantId) {
      throw new ForbiddenException('Tenant scope is required');
    }
    if (!req.user.isAdmin) {
      throw new ForbiddenException('Admin role is required');
    }
    return true;
  }
}

