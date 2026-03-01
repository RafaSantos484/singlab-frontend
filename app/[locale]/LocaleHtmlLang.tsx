'use client';

import { useEffect } from 'react';

interface LocaleHtmlLangProps {
  /** BCP 47 locale tag to set on the document's root element. */
  locale: string;
}

/**
 * Client component that sets the `lang` attribute on `<html>` for the active
 * locale. This runs once after hydration and whenever the locale changes.
 *
 * Required because the root `app/layout.tsx` cannot statically know the
 * locale. The `suppressHydrationWarning` attribute on `<html>` prevents
 * React from warning about the mismatch.
 */
export function LocaleHtmlLang({ locale }: LocaleHtmlLangProps): null {
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  return null;
}
