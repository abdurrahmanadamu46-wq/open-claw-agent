/**
 * GitHub 自动同步脚本：拉取 msitarzewski/agency-agents 仓库 60+ 角色
 * 解析 Markdown frontmatter + ## 段落，批量 upsert 到 AgentRole 存储（JSON 文件 + 可选 Redis）
 *
 * 运行：npx ts-node -r tsconfig-paths/register src/scripts/sync-agency-agents.ts
 * 或：npm run build && node dist/scripts/sync-agency-agents.js
 */

import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import matter from 'gray-matter';
import type { AgentRole } from '../database/agent-role.types';

const GITHUB_OWNER = 'msitarzewski';
const GITHUB_REPO = 'agency-agents';
const GITHUB_BRANCH = 'main';
const RAW_BASE = `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/${GITHUB_BRANCH}`;
const API_BASE = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}`;

/** 从文件路径推断 division：取第一段目录名，如 marketing/xx.md -> Marketing */
function divisionFromPath(filePath: string): string {
  const segments = filePath.split('/').filter(Boolean);
  if (segments.length >= 2) {
    const folder = segments[0];
    return folder.charAt(0).toUpperCase() + folder.slice(1).toLowerCase();
  }
  return 'Specialized';
}

/** 生成稳定 id：路径转 slug */
function idFromPath(filePath: string): string {
  return filePath
    .replace(/\.md$/i, '')
    .replace(/\//g, '-')
    .toLowerCase();
}

/**
 * 将 Markdown 正文按 ## 标题切分为区块
 * 映射到 identity / core_mission / critical_rules / workflow（与 agency-agents 常见标题对齐）
 */
function splitSections(content: string): { identity: string; core_mission: string; critical_rules: string; workflow: string } {
  const sections: Record<string, string> = {};
  const regex = /^##\s+(.+)$/gm;
  let lastIndex = 0;
  let lastTitle = '';

  let m: RegExpExecArray | null;
  while ((m = regex.exec(content)) !== null) {
    if (lastTitle) {
      const body = content.slice(lastIndex, m.index).trim();
      sections[lastTitle] = body;
    }
    lastTitle = m[1].trim();
    lastIndex = m.index + m[0].length;
  }
  if (lastTitle) {
    sections[lastTitle] = content.slice(lastIndex).trim();
  }

  const pick = (keys: string[]): string => {
    for (const k of keys) {
      for (const title of Object.keys(sections)) {
        if (title.toLowerCase().includes(k.toLowerCase())) return sections[title] ?? '';
      }
    }
    return '';
  };

  return {
    identity: pick(['identity', 'personality', 'role definition']),
    core_mission: pick(['core mission', 'mission', 'core capabilities']),
    critical_rules: pick(['critical rules', 'rules', 'decision framework']),
    workflow: pick(['workflow', 'process', 'specialized skills', 'success metrics']),
  };
}

/** 仅同步各 division 目录下的角色文件，排除根目录大文件 (README, CONTRIBUTING 等) */
const ROOT_SKIP = ['readme.md', 'contributing.md', 'license', 'design/', '.github/'];

function isAgentMarkdown(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  if (!lower.endsWith('.md')) return false;
  const inRoot = !filePath.includes('/');
  if (inRoot) return false;
  if (ROOT_SKIP.some((s) => lower.startsWith(s) || lower === s.replace(/\//, ''))) return false;
  return true;
}

/** 获取仓库下所有 .md 文件路径（递归） */
async function listAllMarkdownPaths(): Promise<string[]> {
  const res = await axios.get<{ tree: Array<{ path: string; type: string }> }>(
    `${API_BASE}/git/trees/${GITHUB_BRANCH}`,
    { params: { recursive: 1 } }
  );
  const tree = res.data?.tree ?? [];
  return tree
    .filter((node) => node.type === 'blob' && isAgentMarkdown(node.path))
    .map((n) => n.path);
}

/** 拉取单个文件 raw 内容 */
async function fetchRawContent(filePath: string): Promise<string> {
  const url = `${RAW_BASE}/${encodeURIComponent(filePath)}`;
  const res = await axios.get<string>(url, { responseType: 'text', timeout: 20000 });
  return res.data;
}

/** 解析单个 Markdown 文件为 AgentRole */
function parseMarkdownToRole(filePath: string, raw: string): AgentRole {
  const { data: front, content } = matter(raw);
  const division = divisionFromPath(filePath);
  const sections = splitSections(content);

  return {
    id: idFromPath(filePath),
    name: (front.name as string) ?? path.basename(filePath, '.md'),
    description: (front.description as string) ?? '',
    division,
    identity: sections.identity,
    core_mission: sections.core_mission,
    critical_rules: sections.critical_rules,
    workflow: sections.workflow,
    color: front.color as string | undefined,
    source_path: filePath,
    meta: front as Record<string, unknown>,
  };
}

async function main(): Promise<void> {
  console.log('[sync-agency-agents] Listing .md files...');
  const paths = await listAllMarkdownPaths();
  console.log(`[sync-agency-agents] Found ${paths.length} markdown files.`);

  const roles: AgentRole[] = [];
  for (let i = 0; i < paths.length; i++) {
    const filePath = paths[i];
    try {
      const raw = await fetchRawContent(filePath);
      const role = parseMarkdownToRole(filePath, raw);
      roles.push(role);
      if ((i + 1) % 10 === 0) console.log(`  Parsed ${i + 1}/${paths.length}...`);
    } catch (e) {
      console.warn(`  Skip ${filePath}:`, (e as Error).message);
    }
  }

  const outDir = path.resolve(__dirname, '../database/seeds');
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }
  const outFile = path.join(outDir, 'synced-agency-agents.json');
  fs.writeFileSync(outFile, JSON.stringify(roles, null, 2), 'utf-8');
  console.log(`[sync-agency-agents] Wrote ${roles.length} roles to ${outFile}.`);

  const byDivision = roles.reduce<Record<string, number>>((acc, r) => {
    acc[r.division] = (acc[r.division] ?? 0) + 1;
    return acc;
  }, {});
  console.log('[sync-agency-agents] By division:', byDivision);

  if (process.env.REDIS_HOST) {
    try {
      const Redis = require('ioredis');
      const redis = new Redis({
        host: process.env.REDIS_HOST ?? '127.0.0.1',
        port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
      });
      await redis.set('agent_roles:all', JSON.stringify(roles));
      await redis.quit();
      console.log('[sync-agency-agents] Upserted to Redis key agent_roles:all');
    } catch (e) {
      console.warn('[sync-agency-agents] Redis upsert skipped:', (e as Error).message);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
