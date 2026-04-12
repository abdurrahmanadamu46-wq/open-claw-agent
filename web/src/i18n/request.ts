import { getRequestConfig } from 'next-intl/server';

const SUPPORTED_LOCALES = ['zh', 'en'] as const;
type Locale = (typeof SUPPORTED_LOCALES)[number];

function resolveLocale(value?: string | null): Locale {
  return value === 'en' ? 'en' : 'zh';
}

export default getRequestConfig(async ({ requestLocale }) => {
  // requestLocale comes from the x-next-intl-locale header set by middleware
  const raw = await requestLocale;
  const locale = resolveLocale(raw);

  return {
    locale,
    messages: (await import(`../locales/${locale}.json`)).default,
  };
});

export { SUPPORTED_LOCALES, resolveLocale };
