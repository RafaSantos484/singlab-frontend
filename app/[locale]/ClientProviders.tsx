'use client';

import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { GlobalStateProvider } from '@/lib/store';
import { usePendingNavigationGuard } from '@/lib/hooks/usePendingNavigationGuard';
import muiTheme from '@/lib/theme/muiTheme';

interface ClientProvidersProps {
  children: React.ReactNode;
}

/**
 * Client-side provider tree for MUI theme and app state.
 *
 * Must be a Client Component because the MUI theme object contains
 * functions (spacing, breakpoints, etc.) that cannot be serialized
 * across the server/client boundary.
 */
export function ClientProviders({
  children,
}: ClientProvidersProps): React.ReactElement {
  usePendingNavigationGuard();

  return (
    <ThemeProvider theme={muiTheme}>
      <CssBaseline />
      <GlobalStateProvider>{children}</GlobalStateProvider>
    </ThemeProvider>
  );
}
