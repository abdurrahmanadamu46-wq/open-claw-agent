export interface PartnerDashboard {
  agent_id: string;
  tier: string;
  total_seats: number;
  active_seats: number;
  monthly_revenue: number;
  platform_cost: number;
  estimated_net_profit: number;
  seat_quota_summary: {
    overall_health: string;
    quotas: Record<string, { limit: number; used: number; usage_pct: number }>;
  };
  content_published_this_month: Record<string, number>;
  top_performing_seats: Array<{ seat_id: string; seat_name: string; score: number }>;
  white_label?: {
    white_label_enabled: boolean;
    brand_name: string;
    primary_color: string;
    logo_url: string;
    lobster_names: Record<string, string>;
  };
}

export interface PartnerSeat {
  seat_id: string;
  seat_name: string;
  platform: string;
  account_username: string;
  client_name: string;
  overall_health: string;
  quotas: Record<string, { limit: number; used: number; usage_pct: number }>;
}

export interface PartnerSubAgent {
  sub_agent_id: string;
  parent_agent_id: string;
  company_name: string;
  contact_name: string;
  region: string;
  allocated_seats: number;
  status: string;
}

export interface PartnerStatement {
  id: string;
  agent_id: string;
  period: string;
  seats_purchased: number;
  seats_active: number;
  total_purchase_cost: number;
  total_resell_revenue: number;
  net_profit: number;
  bonus_achieved: boolean;
  bonus_description: string;
  status: string;
  invoice_url?: string | null;
}
