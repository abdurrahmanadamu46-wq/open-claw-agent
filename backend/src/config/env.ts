const LOCAL_ENVS = new Set(['development', 'test', 'local']);
const PROD_LIKE_ENVS = new Set(['production', 'staging']);

export function getRuntimeEnv(): string {
  return process.env.NODE_ENV?.trim().toLowerCase() || 'development';
}

export function isLocalEnv(): boolean {
  return LOCAL_ENVS.has(getRuntimeEnv());
}

export function isProductionLikeEnv(): boolean {
  return PROD_LIKE_ENVS.has(getRuntimeEnv());
}

export function getRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function getOptionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export function getNumberEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid numeric environment variable: ${name}=${raw}`);
  }
  return parsed;
}

export function getRequiredUrlEnv(name: string): string {
  const value = getRequiredEnv(name);
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`Invalid URL environment variable: ${name}=${value}`);
  }
  if (!parsed.protocol || !parsed.hostname) {
    throw new Error(`Invalid URL environment variable: ${name}=${value}`);
  }
  return value;
}

export function getBooleanEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

export function validateBackendStartupEnv(): void {
  const jwtSecret = getRequiredEnv('JWT_SECRET');
  if (jwtSecret.length < 16) {
    throw new Error('JWT_SECRET is too short; minimum length is 16 characters');
  }
  getNumberEnv('PORT', 38789);
  getNumberEnv('REDIS_PORT', 6379);
}
