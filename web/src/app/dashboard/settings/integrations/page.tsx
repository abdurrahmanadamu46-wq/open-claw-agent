'use client';

import { redirect } from 'next/navigation';

export default function DashboardSettingsIntegrationsRedirect() {
  redirect('/settings/integrations');
}
