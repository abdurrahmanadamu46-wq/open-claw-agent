import api from '../api';

export type CompetitivePlatform =
  | 'douyin'
  | 'xiaohongshu'
  | 'kuaishou'
  | 'bilibili'
  | 'wechat'
  | 'other';

export interface CompetitiveIntelAnalyzeInput {
  source: {
    platform: CompetitivePlatform;
    accountId?: string;
    accountName?: string;
    profileUrl?: string;
    postUrl?: string;
    capturedAt?: string;
  };
  classification?: {
    industry?: string;
    niche?: string;
    scenario?: string;
  };
  sample: {
    title?: string;
    hook?: string;
    transcript?: string;
    cta?: string;
    comments?: string[];
    metrics?: {
      views?: number;
      likes?: number;
      comments?: number;
      shares?: number;
      saves?: number;
    };
  };
  upsertAsCorpus?: boolean;
  targetAgents?: string[];
}

export interface CompetitiveFormulaSummary {
  id: string;
  category: string;
  title: string;
  hook: string;
  tags: string[];
  confidence: number;
  extractedAt: string;
  source: {
    platform: CompetitivePlatform;
    accountId?: string;
    accountName?: string;
    postUrl?: string;
  };
}

export async function analyzeAndStoreCompetitiveIntel(
  payload: CompetitiveIntelAnalyzeInput,
): Promise<{ inserted: boolean; corpusId?: string; formula: CompetitiveFormulaSummary }> {
  const { data } = await api.post<{
    code: number;
    data: { inserted: boolean; corpusId?: string; formula: CompetitiveFormulaSummary };
  }>('/api/v1/tenant/rag-brain-profiles/competitive-intel/analyze', payload);
  if (!data?.data?.formula?.id) {
    throw new Error('competitive analyze failed: empty formula payload');
  }
  return data.data;
}

export async function fetchCompetitiveFormulaLibrary(query?: {
  category?: string;
  platform?: string;
  tag?: string;
  limit?: number;
}): Promise<CompetitiveFormulaSummary[]> {
  const { data } = await api.get<{ code: number; data: CompetitiveFormulaSummary[] }>(
    '/api/v1/tenant/rag-brain-profiles/competitive-intel',
    { params: query },
  );
  return data?.data ?? [];
}
