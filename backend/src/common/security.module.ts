import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AdminRoleGuard } from '../auth/admin-role.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuditLogsController } from './controllers/audit-logs.controller';
import { CryptoController } from './controllers/crypto.controller';
import { OperationAuditInterceptor } from './interceptors/operation-audit.interceptor';
import { RateLimitGuard } from './guards/rate-limit.guard';
import { RsaDecryptMiddleware } from './middleware/rsa-decrypt.middleware';
import { RsaCryptoService } from './services/rsa-crypto.service';
import { OperationAuditService } from './services/operation-audit.service';

@Global()
@Module({
  controllers: [CryptoController, AuditLogsController],
  providers: [
    OperationAuditService,
    RsaCryptoService,
    RateLimitGuard,
    RsaDecryptMiddleware,
    JwtAuthGuard,
    AdminRoleGuard,
    {
      provide: APP_INTERCEPTOR,
      useClass: OperationAuditInterceptor,
    },
  ],
  exports: [OperationAuditService, RsaCryptoService, RateLimitGuard, RsaDecryptMiddleware],
})
export class SecurityModule {}
