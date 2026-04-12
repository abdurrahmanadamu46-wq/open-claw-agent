/**
 * 龙虾底座 — 多账号 Cookie/缓存隔离
 * 每个平台账号使用独立 Profile 目录，避免连坐封号
 */

import * as fs from 'fs';
import * as path from 'path';

export const DEFAULT_PROFILE_ROOT = process.env.LOBSTER_PROFILE_ROOT ?? path.join(process.cwd(), '.lobster-profiles');

/**
 * 获取某账号的 Profile 目录（每个账号独立 userDataDir）
 * 目录结构：{root}/{platformId}/{accountId}/
 */
export function getProfileDir(platformId: string, accountId: string, root: string = DEFAULT_PROFILE_ROOT): string {
  const dir = path.join(root, platformId, accountId);
  return path.normalize(dir);
}

/**
 * 确保 Profile 目录存在并返回路径
 */
export function ensureProfileDir(platformId: string, accountId: string, root?: string): string {
  const dir = getProfileDir(platformId, accountId, root);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * 隔离配置：供 Playwright launch 使用
 */
export interface ProfileIsolationConfig {
  platformId: string;
  accountId: string;
  profileRoot?: string;
}

export function getIsolationUserDataDir(config: ProfileIsolationConfig): string {
  return ensureProfileDir(config.platformId, config.accountId, config.profileRoot ?? DEFAULT_PROFILE_ROOT);
}
