/**
 * Type declarations for next-intl.
 *
 * Augments the global `IntlMessages` interface with the shape of the
 * English translation file, enabling fully type-safe `useTranslations()`
 * and `getTranslations()` calls across the project.
 */

import enUS from '../../messages/en-US.json';

type Messages = typeof enUS;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface IntlMessages extends Messages {}
}
