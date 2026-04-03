import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { timingSafeEqual } from 'crypto';

type SessionUser = {
  username: string;
  password: string;
  tenantId: string;
  roles: string[];
  name?: string;
};

export type SessionUserSummary = {
  username: string;
  tenantId: string;
  roles: string[];
  name: string;
};

export type SessionLoginUser = {
  id: string;
  name: string;
  tenantId: string;
  roles: string[];
};

type LoginResult = {
  token: string;
  expiresIn: number;
  user: {
    id: string;
    name: string;
    tenantId: string;
    role: string;
    roles: string[];
  };
};

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

@Injectable()
export class SessionAuthService {
  constructor(private readonly jwtService: JwtService) {}

  login(username: string, password: string): LoginResult {
    const normalizedUsername = username.trim();
    const normalizedPassword = password;
    const user = this.loadUsers().find((item) => item.username === normalizedUsername);
    if (!user || !safeEqual(user.password, normalizedPassword)) {
      throw new UnauthorizedException('Username or password incorrect');
    }
    return this.issueLoginResult({
      id: user.username,
      name: user.name?.trim() || user.username,
      tenantId: user.tenantId,
      roles: user.roles,
    });
  }

  listUsers(tenantId?: string): SessionUserSummary[] {
    const scope = String(tenantId ?? '').trim();
    return this.loadUsers()
      .filter((item) => !scope || item.tenantId === scope)
      .map((item) => ({
        username: item.username,
        tenantId: item.tenantId,
        roles: item.roles.length > 0 ? item.roles : ['merchant'],
        name: item.name?.trim() || item.username,
      }));
  }

  issueLoginResult(user: SessionLoginUser): LoginResult {
    const roles = user.roles.length > 0 ? user.roles : ['merchant'];
    const expiresInSeconds = this.resolveExpiresInSeconds();
    const token = this.jwtService.sign(
      {
        sub: user.id,
        tenantId: user.tenantId,
        role: roles[0],
        roles,
      },
      { expiresIn: expiresInSeconds },
    );

    return {
      token,
      expiresIn: expiresInSeconds,
      user: {
        id: user.id,
        name: user.name,
        tenantId: user.tenantId,
        role: roles[0],
        roles,
      },
    };
  }

  private resolveExpiresInSeconds(): number {
    const raw = process.env.JWT_EXPIRE_SECONDS?.trim();
    if (!raw) return 60 * 60 * 24 * 7;
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed < 300) {
      return 60 * 60 * 24 * 7;
    }
    return parsed;
  }

  private loadUsers(): SessionUser[] {
    const raw = process.env.APP_USERS_JSON?.trim();
    if (!raw) return this.loadBootstrapUser();

    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return this.loadBootstrapUser();

      const users: SessionUser[] = [];
      for (const entry of parsed) {
        if (!entry || typeof entry !== 'object') continue;
        const username = String((entry as { username?: unknown }).username ?? '').trim();
        const password = String((entry as { password?: unknown }).password ?? '');
        const tenantId = String((entry as { tenant_id?: unknown; tenantId?: unknown }).tenant_id ?? (entry as { tenant_id?: unknown; tenantId?: unknown }).tenantId ?? '').trim();
        if (!username || !password || !tenantId) continue;

        const rawRoles = (entry as { roles?: unknown }).roles;
        const roles = Array.isArray(rawRoles)
          ? rawRoles.map((item) => String(item).trim().toLowerCase()).filter(Boolean)
          : ['merchant'];
        users.push({
          username,
          password,
          tenantId,
          roles: roles.length > 0 ? roles : ['merchant'],
          name: String((entry as { name?: unknown }).name ?? username).trim(),
        });
      }

      return users.length > 0 ? users : this.loadBootstrapUser();
    } catch {
      return this.loadBootstrapUser();
    }
  }

  private loadBootstrapUser(): SessionUser[] {
    const username = String(process.env.APP_BOOTSTRAP_USERNAME ?? '').trim();
    const password = String(process.env.APP_BOOTSTRAP_PASSWORD ?? '');
    const tenantId = String(process.env.APP_BOOTSTRAP_TENANT_ID ?? '').trim();
    if (!username || !password || !tenantId) return [];
    return [
      {
        username,
        password,
        tenantId,
        roles: ['admin'],
        name: process.env.APP_BOOTSTRAP_NAME?.trim() || username,
      },
    ];
  }
}
