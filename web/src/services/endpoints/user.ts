/**
 * Current signed-in user. Used by frontend RBAC, navigation visibility,
 * and lightweight tenant/operator labels.
 * Backed by GET /api/v1/me or /api/v1/auth/me.
 */

import api from '../api';

export type UserRole = string;

export interface CurrentUser {
  id: string;
  name: string;
  role: UserRole;
  roles?: string[];
  tenantId?: string;
  tenantName?: string;
  isAdmin?: boolean;
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  try {
    const { data } = await api.get<{ code: number; data: CurrentUser }>('/api/v1/me');
    return data?.data ?? null;
  } catch {
    return null;
  }
}

export interface TeamUserSummary {
  username: string;
  tenantId: string;
  roles: string[];
  name: string;
}

export async function listTeamUsers(): Promise<{ tenantId: string; users: TeamUserSummary[] }> {
  const { data } = await api.get<{ code: number; data: { tenantId: string; users: TeamUserSummary[] } }>(
    '/api/v1/auth/users',
  );
  return data?.data ?? { tenantId: '', users: [] };
}
