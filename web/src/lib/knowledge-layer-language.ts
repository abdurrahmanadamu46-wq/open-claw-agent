import { LEARNING_LOOP_ROUTES } from '@/lib/learning-loop-routes';

export type KnowledgeLayerKey =
  | 'platform_generic'
  | 'platform_industry'
  | 'tenant_private'
  | 'role_activation'
  | 'experience_memory';

export type KnowledgeLayerTerm = {
  key: KnowledgeLayerKey;
  title: string;
  shortTitle: string;
  owner: 'platform' | 'tenant' | 'runtime';
  scopeLabel: string;
  description: string;
  href: string;
};

export const KNOWLEDGE_LAYER_TERMS: Record<KnowledgeLayerKey, KnowledgeLayerTerm> = {
  platform_generic: {
    key: 'platform_generic',
    title: '平台通用知识',
    shortTitle: '通用知识',
    owner: 'platform',
    scopeLabel: '平台拥有 / 全行业复用',
    description: '平台统一维护的通用方法、字段定义、治理边界和跨行业基础规则。',
    href: '/knowledge',
  },
  platform_industry: {
    key: 'platform_industry',
    title: '平台行业知识',
    shortTitle: '行业知识',
    owner: 'platform',
    scopeLabel: '平台拥有 / 按行业复用',
    description: '平台按行业或类目沉淀的行业目录、行业 schema、行业话术和行业 starter kit。',
    href: '/knowledge/platform-industries',
  },
  tenant_private: {
    key: 'tenant_private',
    title: '租户私有知识',
    shortTitle: '租户知识',
    owner: 'tenant',
    scopeLabel: '租户拥有 / 不默认上浮',
    description: '租户自己的品牌手册、SOP、案例、私有语气、线索词和业务资料。',
    href: '/operations/knowledge-base',
  },
  role_activation: {
    key: 'role_activation',
    title: '角色挂载知识包',
    shortTitle: '角色知识包',
    owner: 'runtime',
    scopeLabel: '运行时挂载 / 角色消费',
    description: '把平台行业知识、租户私有知识和 Prompt 配置挂到具体龙虾角色上的 RAG / Prompt 包。',
    href: '/ai-brain/prompt-lab',
  },
  experience_memory: {
    key: 'experience_memory',
    title: '双轨经验记忆',
    shortTitle: '双轨记忆',
    owner: 'runtime',
    scopeLabel: '运行时沉淀 / 显式 scope',
    description: '把常驻小记忆、可检索历史记忆和 tenant/shared/role_local 等 scope 收到同一条经验沉淀链里。',
    href: LEARNING_LOOP_ROUTES.memory.href,
  },
};

export const KNOWLEDGE_LAYER_ORDER: KnowledgeLayerKey[] = [
  'platform_generic',
  'platform_industry',
  'tenant_private',
  'role_activation',
  'experience_memory',
];

export function getKnowledgeLayerTerm(key: KnowledgeLayerKey): KnowledgeLayerTerm {
  return KNOWLEDGE_LAYER_TERMS[key];
}

export function getKnowledgeLayerTerms(): KnowledgeLayerTerm[] {
  return KNOWLEDGE_LAYER_ORDER.map((key) => KNOWLEDGE_LAYER_TERMS[key]);
}
