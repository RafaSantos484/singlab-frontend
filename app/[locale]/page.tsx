'use client';

import { useEffect } from 'react';
import { Box, CircularProgress } from '@mui/material';
import { useGlobalState } from '@/lib/store';
import { useRouter } from '@/lib/i18n/navigation';

/**
 * Locale root page.
 *
 * Redirects to `/dashboard` when authenticated, or to `/login` when not.
 * Uses the locale-aware router so the current locale prefix is preserved.
 */
export default function LocaleRootPage(): React.ReactElement {
  const { authStatus } = useGlobalState();
  const router = useRouter();

  useEffect(() => {
    if (authStatus === 'loading') return;

    if (authStatus === 'authenticated') {
      router.replace('/dashboard');
    } else {
      router.replace('/login');
    }
  }, [authStatus, router]);

  return (
    <Box
      sx={{
        display: 'flex',
        minHeight: '100vh',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: 'background.default',
      }}
    >
      <CircularProgress size={32} />
    </Box>
  );
}
