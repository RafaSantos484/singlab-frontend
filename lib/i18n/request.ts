import { getRequestConfig } from 'next-intl/server';
import { routing } from './routing';

/**
 * Server-side i18n request configuration.
 *
 * Resolves the active locale for every server request and loads the
 * corresponding message bundle. Falls back to the default locale when the
 * requested locale is unknown or missing.
 */
export default getRequestConfig(async ({ requestLocale }) => {
  let locale = await requestLocale;

  // Validate against supported locales; fall back to default if unknown
  if (!locale || !routing.locales.includes(locale as (typeof routing.locales)[number])) {
    locale = routing.defaultLocale;
  }

  return {
    locale,
    messages: (
      await import(`../../messages/${locale}.json`)
    ).default as IntlMessages,
  };
});
