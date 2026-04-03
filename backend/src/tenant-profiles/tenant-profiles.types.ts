export const RAG_BRAIN_PROFILES_TABLE = 'rag_brain_profiles';
export const EDGE_PERSONA_MASKS_TABLE = 'edge_persona_masks';

export type CompetitivePlatform =
  | 'douyin'
  | 'xiaohongshu'
  | 'kuaishou'
  | 'bilibili'
  | 'wechat'
  | 'other';

export interface RagCompetitiveSourceRef {
  platform: CompetitivePlatform;
  accountId?: string;
  accountName?: string;
  profileUrl?: string;
  postUrl?: string;
  capturedAt?: string;
}

export interface RagCompetitiveSampleMetrics {
  views?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  saves?: number;
}

export interface RagCompetitiveSenateInsights {
  radar?: string;
  strategist?: string;
  inkwriter?: string;
  visualizer?: string;
  dispatcher?: string;
}

export interface RagCompetitiveFormulaRecord {
  id: string;
  fingerprint: string;
  category: string;
  industry?: string;
  niche?: string;
  scenario?: string;
  source: RagCompetitiveSourceRef;
  title: string;
  hook: string;
  narrativeStructure: string[];
  ctaPattern?: string;
  emotionalTriggers: string[];
  proofPoints: string[];
  antiRiskNotes: string[];
  tags: string[];
  metrics?: RagCompetitiveSampleMetrics;
  senateInsights?: RagCompetitiveSenateInsights;
  confidence: number;
  extractedAt: string;
}

export interface RagBrainAgentProfile {
  corpora: string[];
  promptTemplate?: string;
  memoryPolicy?: string;
  notes?: string;
  updatedAt?: string;
}

export interface RagBrainCorpusItem {
  id: string;
  name?: string;
  source?: string;
  tags?: string[];
}

export interface RagBrainProfilesDocument {
  table: typeof RAG_BRAIN_PROFILES_TABLE;
  tenantId: string;
  version: number;
  updatedAt: string;
  agents: Record<string, RagBrainAgentProfile>;
  corpusCatalog: RagBrainCorpusItem[];
  formulaLibrary: RagCompetitiveFormulaRecord[];
}

export type RagBrainProfilesPatch = Partial<
  Pick<RagBrainProfilesDocument, 'version' | 'corpusCatalog' | 'formulaLibrary'>
> & { agents?: Record<string, Partial<RagBrainAgentProfile>> };

export interface EdgePersonaMaskProfile {
  name: string;
  roleTag?: string;
  interests?: string[];
  activityWindows?: string[];
  narrativeTone?: string;
  riskLevel?: 'low' | 'medium' | 'high';
  enabled?: boolean;
  updatedAt?: string;
}

export interface EdgePersonaMasksDocument {
  table: typeof EDGE_PERSONA_MASKS_TABLE;
  tenantId: string;
  version: number;
  updatedAt: string;
  masks: Record<string, EdgePersonaMaskProfile>;
  nodeAssignments: Record<string, string[]>;
}

export type EdgePersonaMasksPatch = Partial<Pick<EdgePersonaMasksDocument, 'version' | 'nodeAssignments'>> & {
  masks?: Record<string, Partial<EdgePersonaMaskProfile>>;
};

export type TenantWorkflowStepId = 'S1' | 'S2' | 'S3' | 'S4' | 'S5';
export type TenantWorkflowProgress = Record<TenantWorkflowStepId, boolean>;

export interface TenantLeadScoringWords {
  highIntent: string[];
  painPoints: string[];
}

export interface TenantRegistryRecord {
  id: string;
  name: string;
  quota: number;
  inactive: boolean;
  industryType?: string;
  industryCategoryTag?: string;
  businessKeywords: string[];
  leadScoringWords: TenantLeadScoringWords;
  nodeWorkflowProgress: TenantWorkflowProgress;
  deploymentRegion: string;
  storageRegion: string;
  dataResidency: 'cn-mainland' | 'custom';
  icpFilingStatus: 'pending' | 'ready' | 'submitted' | 'approved';
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
}

export type TenantRegistryPatch = Partial<
  Pick<
    TenantRegistryRecord,
    | 'name'
    | 'quota'
    | 'inactive'
    | 'industryType'
    | 'industryCategoryTag'
    | 'businessKeywords'
    | 'leadScoringWords'
    | 'nodeWorkflowProgress'
    | 'deploymentRegion'
    | 'storageRegion'
    | 'dataResidency'
    | 'icpFilingStatus'
  >
>;

/**
 * Target relational table schema for future Postgres migration.
 */
export interface RagBrainProfilesRow {
  id: string;
  tenant_id: string;
  profiles_json: RagBrainProfilesDocument;
  updated_at: Date;
}

/**
 * Target relational table schema for future Postgres migration.
 */
export interface EdgePersonaMasksRow {
  id: string;
  tenant_id: string;
  masks_json: EdgePersonaMasksDocument;
  updated_at: Date;
}
