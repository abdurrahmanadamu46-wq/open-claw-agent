import { cookies } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';

const SUPPORTED_LOCALES = ['zh', 'en'] as const;
type Locale = (typeof SUPPORTED_LOCALES)[number];

function resolveLocale(value?: string | null): Locale {
  return value === 'en' ? 'en' : 'zh';
}

export default getRequestConfig(async () => {
  const cookieStore = cookies();
  const locale = resolveLocale(cookieStore.get('NEXT_LOCALE')?.value);

  return {
    locale,
    messages: (await import(`./locales/${locale}.json`)).default,
  };
});

export { SUPPORTED_LOCALES, resolveLocale };
