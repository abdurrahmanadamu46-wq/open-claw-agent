/**
 * 爆款模版与本地素材 — 模版集市 + BYOK OSS 数据结构
 */

/** 分镜：目标、建议时长、绑定 AI 角色 */
export interface TemplateScene {
  id: string;
  goal: string;
  durationSeconds: number;
  aiRole: string;
}

/** 行业/分类（千行千面模版筛选） */
export type TemplateIndustry = 'beauty' | 'automotive' | 'local_service' | 'all';

/** 开源模版数据契约 (JSON 导入导出) */
export interface VideoTemplateBlueprint {
  id: string;
  name: string;
  author: string;
  /** 官方 | 社区 | 私有 */
  authorType: 'official' | 'community' | 'private';
  tags: string[];
  total_duration: number;
  scenes: TemplateScene[];
  /** 社区评分 0-100，仅社区模版 */
  communityScore?: number;
  /** 行业标签：美妆 / 汽车 / 本地生活等，用于筛选 */
  industry?: TemplateIndustry;
}

/** 本地素材（BYOK OSS） */
export interface LocalAsset {
  id: string;
  name: string;
  url: string;
  thumbnail?: string;
  durationSeconds?: number;
  folder: string;
  tags: string[];
  uploadedAt: string;
}
