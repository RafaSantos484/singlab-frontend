'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Box, CircularProgress } from '@mui/material';
import { useGlobalState } from '@/lib/store';

/**
 * Root route — redirects to `/dashboard` when authenticated,
 * or to `/login` when not authenticated.
 */
export default function RootPage(): React.ReactElement {
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
