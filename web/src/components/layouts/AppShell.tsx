'use client';

import { usePathname } from 'next/navigation';
import { AppSidebar } from '@/components/layout/AppSidebar';
import { Header } from './Header';

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const publicPrefixes = [
    '/login',
    '/register',
    '/forgot-password',
    '/reset-password',
    '/landing',
    '/pricing',
    '/faq',
    '/legal',
  ];
  if (publicPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
    return <>{children}</>;
  }
  return (
    <div className="flex min-h-screen bg-[#0F172A]">
      <AppSidebar />
      <div className="flex flex-1 flex-col min-h-screen">
        <Header />
        <main className="flex-1 p-4 md:p-6 pb-20 md:pb-6">{children}</main>
      </div>
    </div>
  );
}
