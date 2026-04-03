export interface WhiteLabelConfig {
  tenant_id: string;
  brand_name: string;
  brand_logo_url?: string | null;
  brand_favicon_url?: string | null;
  brand_primary_color: string;
  brand_secondary_color: string;
  brand_bg_color: string;
  brand_text_color: string;
  custom_domain?: string | null;
  login_slogan?: string | null;
  login_bg_image_url?: string | null;
  support_email?: string | null;
  support_phone?: string | null;
  hide_powered_by: boolean;
  email_from_name?: string | null;
  email_from_address?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface WhiteLabelCSSVars {
  '--brand-primary': string;
  '--brand-secondary': string;
  '--brand-bg': string;
  '--brand-text': string;
}
