import { POPULAR_SKILL_CATALOG_PLAN } from './senate-collaboration';

export type DiscoveredSkill = {
  skillName: string;
  installCmd?: string;
  downloads?: number;
  tags?: string[];
  author?: string;
};

export type DiscoveryBatch = {
  page: number;
  pageSize: number;
  sortBy: 'downloads_stars_desc';
};

export function buildDiscoveryBatches(maxSkills = POPULAR_SKILL_CATALOG_PLAN.maxSkills): DiscoveryBatch[] {
  const capped = Math.max(1, Math.min(maxSkills, POPULAR_SKILL_CATALOG_PLAN.maxSkills));
  const totalPages = Math.min(
    Math.ceil(capped / POPULAR_SKILL_CATALOG_PLAN.pageSize),
    POPULAR_SKILL_CATALOG_PLAN.maxPages,
  );

  return Array.from({ length: totalPages }, (_, idx) => ({
    page: idx + 1,
    pageSize: POPULAR_SKILL_CATALOG_PLAN.pageSize,
    sortBy: POPULAR_SKILL_CATALOG_PLAN.sortBy,
  }));
}

/**
 * 合并发现到的热门技能目录，默认不覆盖已注册同名 skill。
 */
export function mergeDiscoveredSkills(
  registered: DiscoveredSkill[],
  discovered: DiscoveredSkill[],
): DiscoveredSkill[] {
  const map = new Map<string, DiscoveredSkill>();
  for (const item of registered) {
    map.set(item.skillName, item);
  }
  for (const item of discovered) {
    if (!map.has(item.skillName)) {
      map.set(item.skillName, item);
    }
  }
  return Array.from(map.values());
}
