import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

/**
 * Minimal root layout.
 *
 * Intentionally lean — locale-specific providers (MUI ThemeProvider,
 * NextIntlClientProvider, GlobalStateProvider) live in
 * `app/[locale]/layout.tsx` so they receive the correct locale at runtime.
 *
 * The `suppressHydrationWarning` attribute on `<html>` prevents React from
 * warning about the `lang` attribute being injected client-side by the
 * locale layout.
 */
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
