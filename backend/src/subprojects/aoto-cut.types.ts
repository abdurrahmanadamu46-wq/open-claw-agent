export type AotoCutInputObject =
  | 'tenant_context'
  | 'industry_profile'
  | 'customer_profile'
  | 'campaign_goal'
  | 'approval_policy'
  | 'execution_policy';

export type AotoCutOutputObject =
  | 'topic_candidates'
  | 'script_asset'
  | 'compliance_report'
  | 'storyboard_package'
  | 'material_bundle'
  | 'media_bundle'
  | 'archive_record'
  | 'publish_ready_package';

export type AotoCutPackageType = AotoCutOutputObject;

export interface AotoCutContractDescriptor {
  subproject: 'Aoto Cut';
  role: string;
  responsibility_mode: 'integration_only';
  owned_modules: string[];
  shared_modules: string[];
  parent_should_own: string[];
  input_objects: AotoCutInputObject[];
  output_objects: AotoCutOutputObject[];
  integration_rule: string;
  contract_version: string;
  updated_at: string;
}

export interface AotoCutPackageRecord {
  package_id: string;
  tenant_id: string;
  package_type: AotoCutPackageType;
  contract_version: string;
  source: string;
  trace_id?: string;
  payload: Record<string, unknown>;
  summary: {
    title: string;
    item_count: number;
    has_assets: boolean;
  };
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface AotoCutPackageCreateInput {
  tenant_id: string;
  package_type: AotoCutPackageType;
  contract_version?: string;
  source?: string;
  trace_id?: string;
  payload: Record<string, unknown>;
  created_by: string;
}
