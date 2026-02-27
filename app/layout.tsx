'use client';

import { Geist, Geist_Mono } from 'next/font/google';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { GlobalStateProvider } from '@/lib/store';
import muiTheme from '@/lib/theme/muiTheme';
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
 * Root layout component.
 *
 * Provides:
 * - MUI ThemeProvider with custom brand theme
 * - CssBaseline for consistent baseline styles
 * - GlobalStateProvider for app-wide state (auth, songs, etc.)
 * - Font configuration (Geist Sans, Geist Mono)
 */
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <title>SingLab — Karaoke & Singing Practice</title>
        <meta
          name="description"
          content="Upload a track and practice singing with AI-separated vocal and instrumental layers."
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <ThemeProvider theme={muiTheme}>
          <CssBaseline />
          <GlobalStateProvider>{children}</GlobalStateProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
