import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction } from 'express';
import { RsaCryptoService } from '../services/rsa-crypto.service';

type BodyAwareRequest = {
  method?: string;
  body?: Record<string, unknown>;
};

@Injectable()
export class RsaDecryptMiddleware implements NestMiddleware {
  private readonly sensitiveFields = [
    'password',
    'apiKey',
    'api_key',
    'secret',
    'token',
    'privateKey',
    'clientSecret',
    'client_secret',
  ];

  constructor(private readonly rsaCryptoService: RsaCryptoService) {}

  use(req: BodyAwareRequest, _res: unknown, next: NextFunction) {
    const method = String(req.method ?? 'GET').toUpperCase();
    if (!['POST', 'PUT', 'PATCH'].includes(method) || !req.body || typeof req.body !== 'object') {
      next();
      return;
    }
    req.body = this.rsaCryptoService.decryptFields(req.body, this.sensitiveFields);
    next();
  }
}
