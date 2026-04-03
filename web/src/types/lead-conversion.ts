export interface LeadConversionStatus {
  tenant_id: string;
  lead_id: string;
  status: string;
  confidence: number;
  trigger: string;
  triggered_by: string;
  evidence: string;
  updated_at: string;
}

export interface LeadConversionHistoryItem {
  transition_id?: string;
  tenant_id: string;
  lead_id: string;
  from_status: string;
  to_status: string;
  trigger: string;
  confidence: number;
  triggered_by: string;
  evidence: string;
  transitioned_at: string;
}
