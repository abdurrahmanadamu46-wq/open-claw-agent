'use client';

import { Globe } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { startTransition } from 'react';

type Locale = 'zh' | 'en';

function persistLocale(locale: Locale) {
  localStorage.setItem('preferred-locale', locale);
  document.cookie = `NEXT_LOCALE=${locale}; path=/; max-age=${60 * 60 * 24 * 365}`;
}

export function LocaleSwitcher() {
  const locale = useLocale() as Locale;
  const router = useRouter();
  const t = useTranslations('locale');

  const switchLocale = (nextLocale: Locale) => {
    persistLocale(nextLocale);
    startTransition(() => {
      router.refresh();
    });
  };

  return (
    <div className="inline-flex items-center gap-1 rounded-2xl border border-white/12 bg-white/[0.04] px-2 py-1.5">
      <Globe className="h-4 w-4 text-slate-300" />
      {(['zh', 'en'] as Locale[]).map((item) => {
        const active = item === locale;
        return (
          <button
            key={item}
            type="button"
            onClick={() => switchLocale(item)}
            className={`rounded-xl px-2 py-1 text-xs transition ${active ? 'bg-cyan-400/10 text-cyan-100' : 'text-slate-300 hover:bg-white/5'}`}
            aria-label={t(item)}
          >
            {item.toUpperCase()}
          </button>
        );
      })}
    </div>
  );
}
