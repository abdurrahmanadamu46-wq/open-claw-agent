export interface EdgeNodeGroupTreeNode {
  group_id: string;
  tenant_id: string;
  name: string;
  parent_group_id?: string | null;
  description?: string;
  tags?: string[];
  node_count: number;
  children: EdgeNodeGroupTreeNode[];
}

export interface EdgeNodeGroupMapItem {
  group_id: string;
  group_name: string;
  parent_group_id?: string | null;
}
