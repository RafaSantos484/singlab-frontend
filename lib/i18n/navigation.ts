import { createNavigation } from 'next-intl/navigation';
import { routing } from './routing';

/**
 * Locale-aware navigation utilities generated from the routing config.
 *
 * Use these instead of the standard `next/navigation` counterparts to ensure
 * correct locale prefixes are added to all internal links and redirects.
 *
 * @example
 * import { Link, useRouter, usePathname } from '@/lib/i18n/navigation';
 */
export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);
