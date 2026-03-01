import { notFound } from 'next/navigation';
import { NextIntlClientProvider, hasLocale } from 'next-intl';
import { getMessages, getTranslations } from 'next-intl/server';
import { routing } from '@/lib/i18n/routing';
import { LocaleHtmlLang } from './LocaleHtmlLang';
import { ClientProviders } from './ClientProviders';

interface LocaleLayoutProps {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}

/**
 * Locale-specific layout.
 *
 * Validates the locale from the URL segment and provides:
 * - NextIntlClientProvider with the locale's message bundle
 * - MUI ThemeProvider with the custom brand theme
 * - CssBaseline for consistent baseline styles
 * - GlobalStateProvider for app-wide state (auth, songs, player, etc.)
 * - LocaleHtmlLang: updates the `<html lang>` attribute client-side
 *
 * Any locale not listed in `routing.locales` triggers a 404.
 */
export default async function LocaleLayout({
  children,
  params,
}: LocaleLayoutProps): Promise<React.ReactElement> {
  const { locale } = await params;

  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  const messages = await getMessages();

  return (
    <NextIntlClientProvider messages={messages}>
      <LocaleHtmlLang locale={locale} />
      <ClientProviders>{children}</ClientProviders>
    </NextIntlClientProvider>
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'Meta' });

  return {
    title: t('title'),
    description: t('description'),
  };
}

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}
