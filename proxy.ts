import createMiddleware from 'next-intl/middleware';
import { routing } from './lib/i18n/routing';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

/**
 * next-intl middleware for locale-based routing.
 *
 * Handles:
 * - Automatic locale detection (Accept-Language header, NEXT_LOCALE cookie)
 * - Locale prefix injection into URLs  (e.g. / → /en-US)
 * - Persistent locale cookie (`NEXT_LOCALE`)
 * - Maps language codes without region (pt → pt-BR, en → en-US)
 */

const middleware = createMiddleware(routing);

// Wrap the middleware to add custom locale detection
export default function customMiddleware(request: NextRequest) {
  // Custom locale detection logic
  const url = new URL(request.url);

  // Only apply detection to root path or paths without locale
  if (
    url.pathname === '/' ||
    !routing.locales.some((locale) => url.pathname.startsWith(`/${locale}`))
  ) {
    const cookieLocale = request.cookies.get('NEXT_LOCALE')?.value;
    if (cookieLocale && routing.locales.includes(cookieLocale)) {
      // Cookie takes precedence - let default middleware handle it
      return middleware(request);
    }

    // Parse Accept-Language header
    const acceptLanguage = request.headers.get('accept-language');
    if (acceptLanguage) {
      // Extract languages with their quality scores
      const languages = acceptLanguage
        .split(',')
        .map((lang) => {
          const [code, qValue] = lang.trim().split(';q=');
          return {
            code: code.trim(),
            quality: qValue ? parseFloat(qValue) : 1.0,
          };
        })
        .sort((a, b) => b.quality - a.quality);

      // Try to match with our supported locales
      for (const { code } of languages) {
        // Exact match (e.g., pt-BR → pt-BR)
        if (routing.locales.includes(code)) {
          url.pathname = `/${code}${url.pathname}`;
          return NextResponse.redirect(url);
        }

        // Language without region (e.g., pt → pt-BR)
        const baseLanguage = code.split('-')[0].toLowerCase();
        const matchedLocale = routing.locales.find((locale) =>
          locale.toLowerCase().startsWith(baseLanguage + '-'),
        );
        if (matchedLocale) {
          url.pathname = `/${matchedLocale}${url.pathname}`;
          return NextResponse.redirect(url);
        }
      }
    }
  }

  return middleware(request);
}

export const config = {
  // Match all paths except Next.js internals, static assets, and API routes
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
