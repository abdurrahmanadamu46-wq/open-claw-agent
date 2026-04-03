export type WidgetConfig = {
  widgetId: string;
  tenantId: string;
  allowedDomains: string[];
  welcomeMessage?: string;
  themeColor?: string;
  accentColor?: string;
  customCss?: string;
  callToAction?: string;
  launcherLabel?: string;
  autoOpen?: boolean;
  launcherPosition?: 'bottom-right' | 'top-right';
  updatedAt?: string;
};

export type WidgetConfigPayload = {
  tenant_id: string;
  allowed_domains?: string[];
  welcome_message?: string;
  theme_color?: string;
  accent_color?: string;
  custom_css?: string;
  call_to_action?: string;
  launcher_label?: string;
  auto_open?: boolean;
  launcher_position?: 'bottom-right' | 'top-right';
};

export type WidgetScript = {
  widgetId: string;
  script?: string;
  language?: string;
  updatedAt?: string;
};
