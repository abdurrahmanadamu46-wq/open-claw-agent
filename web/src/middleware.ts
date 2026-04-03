import { NextRequest, NextResponse } from 'next/server';

const SUPPORTED_LOCALES = ['zh', 'en'] as const;
type Locale = (typeof SUPPORTED_LOCALES)[number];

function resolveLocale(request: NextRequest): Locale {
  const cookieValue = request.cookies.get('NEXT_LOCALE')?.value;
  if (cookieValue === 'en') return 'en';
  return 'zh';
}

export function middleware(request: NextRequest) {
  const locale = resolveLocale(request);

  const requestHeaders = new Headers(request.headers);
  // next-intl v4 reads locale from this header when using custom middleware
  requestHeaders.set('x-next-intl-locale', locale);

  const response = NextResponse.next({ request: { headers: requestHeaders } });

  // Persist locale cookie if missing
  if (!request.cookies.has('NEXT_LOCALE')) {
    response.cookies.set('NEXT_LOCALE', locale, { path: '/', sameSite: 'lax' });
  }

  return response;
}

export const config = {
  matcher: ['/((?!api|_next|.*\\..*).*)'
  ],
};
