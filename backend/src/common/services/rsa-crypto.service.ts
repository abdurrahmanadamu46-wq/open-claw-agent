import { Injectable, OnModuleInit } from '@nestjs/common';
import * as crypto from 'node:crypto';

@Injectable()
export class RsaCryptoService implements OnModuleInit {
  private publicKeyPem = '';
  private privateKeyPem = '';

  onModuleInit() {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    this.publicKeyPem = publicKey;
    this.privateKeyPem = privateKey;
  }

  getPublicKeyPem(): string {
    return this.publicKeyPem;
  }

  getPublicKeyBase64(): string {
    return this.publicKeyPem
      .replace('-----BEGIN PUBLIC KEY-----', '')
      .replace('-----END PUBLIC KEY-----', '')
      .replace(/\n/g, '')
      .trim();
  }

  decrypt(encryptedBase64: string): string {
    const encryptedBuffer = Buffer.from(encryptedBase64, 'base64');
    const decrypted = crypto.privateDecrypt(
      {
        key: this.privateKeyPem,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      },
      encryptedBuffer,
    );
    return decrypted.toString('utf-8');
  }

  decryptFields<T extends Record<string, unknown>>(body: T, sensitiveFields: string[]): T {
    const walk = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map((item) => walk(item));
      if (!value || typeof value !== 'object') return value;
      const row = value as Record<string, unknown>;
      for (const key of Object.keys(row)) {
        if (sensitiveFields.includes(key) && typeof row[key] === 'string') {
          try {
            row[key] = this.decrypt(String(row[key]));
          } catch {
            // Keep plaintext as-is for backward compatibility.
          }
        } else {
          row[key] = walk(row[key]);
        }
      }
      return row;
    };
    return walk({ ...body }) as T;
  }
}
