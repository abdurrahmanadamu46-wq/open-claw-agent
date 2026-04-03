import api from '@/services/api';

type PublicKeyResponse = {
  publicKey?: string;
  publicKeyPem?: string;
  algorithm?: string;
  keySize?: number;
};

let cachedSpkiBase64: string | null = null;

function normalizePemToBase64(input: string): string {
  return input
    .replace('-----BEGIN PUBLIC KEY-----', '')
    .replace('-----END PUBLIC KEY-----', '')
    .replace(/\s+/g, '')
    .trim();
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

async function importPublicKey(base64: string): Promise<CryptoKey> {
  return window.crypto.subtle.importKey(
    'spki',
    base64ToArrayBuffer(base64),
    {
      name: 'RSA-OAEP',
      hash: 'SHA-256',
    },
    false,
    ['encrypt'],
  );
}

export async function fetchSecurityPublicKey(forceRefresh = false): Promise<string | null> {
  if (!forceRefresh && cachedSpkiBase64) {
    return cachedSpkiBase64;
  }
  try {
    const { data } = await api.get<PublicKeyResponse>('/api/v1/crypto/public-key');
    const value = String(data?.publicKey || data?.publicKeyPem || '').trim();
    if (!value) {
      return null;
    }
    cachedSpkiBase64 = normalizePemToBase64(value);
    return cachedSpkiBase64;
  } catch {
    return null;
  }
}

export async function encryptSensitiveField(value: string): Promise<string> {
  if (!value) return value;
  if (typeof window === 'undefined' || !window.crypto?.subtle) {
    return value;
  }
  const publicKey = await fetchSecurityPublicKey();
  if (!publicKey) {
    return value;
  }
  try {
    const key = await importPublicKey(publicKey);
    const encrypted = await window.crypto.subtle.encrypt(
      { name: 'RSA-OAEP' },
      key,
      new TextEncoder().encode(value),
    );
    const bytes = new Uint8Array(encrypted);
    let binary = '';
    bytes.forEach((item) => {
      binary += String.fromCharCode(item);
    });
    return btoa(binary);
  } catch {
    return value;
  }
}
