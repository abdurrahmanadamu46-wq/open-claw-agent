import type { Metadata } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';
import { AppShell } from '@/components/layouts/AppShell';
import { Providers } from './providers';
import './globals.css';

export const metadata: Metadata = {
  title: 'ClawCommerce 商家控制台',
  description: '基于 OpenClaw 的 AI 运营 SaaS 控制面'
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html lang={locale === 'en' ? 'en' : 'zh-CN'} style={{ backgroundColor: '#0F172A' }}>
      <body className="min-h-screen antialiased claw-bg claw-text" style={{ backgroundColor: '#0F172A', color: '#F8FAFC' }}>
        <NextIntlClientProvider locale={locale} messages={messages}>
          <Providers>
            <AppShell>{children}</AppShell>
          </Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
