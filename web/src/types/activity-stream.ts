export interface ActivityStreamItem {
  activity_id: string;
  tenant_id: string;
  activity_type: string;
  actor_type: string;
  actor_id: string;
  actor_name: string;
  target_type: string;
  target_id: string;
  target_name: string;
  details: Record<string, unknown>;
  created_at: string;
}
