export interface VectorBackupSnapshot {
  name: string;
  creation_time?: string;
  size?: number;
}

export interface VectorBackupHistoryItem {
  backup_id: string;
  collection_name: string;
  snapshot_name: string;
  backup_path: string;
  status: string;
  size_bytes: number;
  created_at: string;
  detail: Record<string, unknown>;
}
