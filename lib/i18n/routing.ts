import { defineRouting } from 'next-intl/routing';

/**
 * Routing configuration for next-intl.
 *
 * Defines the supported locales and the default fallback locale.
 * Adding a new language requires only adding it to the `locales` array
 * and creating a corresponding `messages/<locale>.json` file.
 */
export const routing = defineRouting({
  locales: ['en-US', 'pt-BR'] as string[],
  defaultLocale: 'en-US',
  localeDetection: true,
  localeCookie: true,
});

export type Locale = (typeof routing.locales)[number];
