import { redirect } from 'next/navigation';

/**
 * Root page — immediately redirects to the default locale.
 * In practice the middleware intercepts the request first and
 * handles locale detection, so this route is rarely reached.
 */
export default function RootPage(): never {
  redirect('/en-US');
}
