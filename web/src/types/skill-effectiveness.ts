export interface SkillEffectivenessRating {
  overall: number;
  by_industry: Record<string, number>;
  by_channel: Record<string, number>;
  sample_size: number;
  confidence: number;
}

export interface SkillEffectivenessResponse {
  ok: boolean;
  skill_id: string;
  tenant_id?: string;
  rating: SkillEffectivenessRating;
  calibrated_at?: string;
  notes?: string[];
}
