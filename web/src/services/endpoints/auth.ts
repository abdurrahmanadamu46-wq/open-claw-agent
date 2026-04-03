import api from '../api';
import { encryptSensitiveField } from '@/lib/rsa-crypto';

export async function loginWithPassword(input: { username: string; password: string }) {
  const encryptedPassword = await encryptSensitiveField(input.password);
  const { data } = await api.post('/auth/login', {
    username: input.username,
    password: encryptedPassword,
  });
  return data as {
    token?: string;
    access_token?: string;
  };
}

export async function registerUser(input: {
  email: string;
  password: string;
  username?: string;
  tenant_id?: string;
}) {
  const { data } = await api.post('/auth/register', {
    ...input,
    password: await encryptSensitiveField(input.password),
  });
  return data as Record<string, unknown>;
}

export async function requestPasswordReset(email: string) {
  const { data } = await api.post('/auth/forgot-password', { email });
  return data as Record<string, unknown>;
}

export async function resetPassword(input: { token: string; password: string }) {
  const { data } = await api.post('/auth/reset-password', {
    ...input,
    password: await encryptSensitiveField(input.password),
  });
  return data as Record<string, unknown>;
}
