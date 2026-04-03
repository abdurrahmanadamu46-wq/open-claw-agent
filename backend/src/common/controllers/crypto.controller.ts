import { Controller, Get } from '@nestjs/common';
import { RsaCryptoService } from '../services/rsa-crypto.service';

@Controller('api/v1/crypto')
export class CryptoController {
  constructor(private readonly rsaCryptoService: RsaCryptoService) {}

  @Get('public-key')
  getPublicKey() {
    return {
      publicKey: this.rsaCryptoService.getPublicKeyBase64(),
      publicKeyPem: this.rsaCryptoService.getPublicKeyPem(),
      algorithm: 'RSA-OAEP',
      keySize: 2048,
    };
  }
}
