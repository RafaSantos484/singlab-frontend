import {
  AppBar,
  Toolbar,
  Box,
  Container,
  Button,
  Avatar,
  Typography,
} from '@mui/material';
import { useTranslations } from 'next-intl';
import { signOut } from '@/lib/firebase';
import { useGlobalState } from '@/lib/store';
import { usePendingNavigationGuard } from '@/lib/hooks/usePendingNavigationGuard';
import { useState } from 'react';
import { LanguageSwitcher } from '@/components/ui/LanguageSwitcher';

interface DashboardLayoutProps {
  children: React.ReactNode;
}

/**
 * Layout wrapper for authenticated pages (dashboard, etc.).
 *
 * Features:
 * - AppBar with branding, language switcher, user avatar, and sign out button
 * - Container with responsive padding
 * - Consistent max-width and spacing
 * - Accessible navigation structure
 * - Fully translated via the i18n system
 */
export function DashboardLayout({
  children,
}: DashboardLayoutProps): React.ReactElement {
  const t = useTranslations('Navigation');
  const { userProfile } = useGlobalState();
  const { confirmNavigationIfPending } = usePendingNavigationGuard();
  const [signingOut, setSigningOut] = useState(false);

  async function handleSignOut(): Promise<void> {
    if (!confirmNavigationIfPending()) {
      return;
    }

    setSigningOut(true);
    try {
      await signOut();
    } finally {
      setSigningOut(false);
    }
  }

  const user = userProfile;
  const displayName = user?.displayName ?? user?.email ?? 'User';
  const avatarInitial = (user?.displayName ??
    user?.email ??
    'U')[0].toUpperCase();

  return (
    <Box
      sx={{
        minHeight: '100vh',
        bgcolor: 'background.default',
        color: 'text.primary',
      }}
    >
      {/* Header */}
      <AppBar position="static" elevation={0}>
        <Toolbar
          sx={{
            justifyContent: 'space-between',
            px: { xs: 2, sm: 3, lg: 4 },
            py: 1,
          }}
        >
          {/* Logo / Brand */}
          <Typography
            variant="h6"
            component="h1"
            sx={{
              fontWeight: 700,
              letterSpacing: '-0.02em',
              background:
                'linear-gradient(to right, #818cf8, #a855f7, #c084fc)',
              backgroundClip: 'text',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              fontSize: { xs: '1.25rem', sm: '1.5rem' },
            }}
          >
            {t('brand')}
          </Typography>

          {/* Right side: language switcher + user info + sign out */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            {/* Language switcher */}
            <LanguageSwitcher />

            {/* Avatar + name */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              {user?.photoURL ? (
                <Avatar
                  src={user.photoURL}
                  alt={displayName}
                  sx={{
                    width: 36,
                    height: 36,
                    border: '1px solid rgba(124, 58, 237, 0.3)',
                  }}
                />
              ) : (
                <Avatar
                  sx={{
                    width: 36,
                    height: 36,
                    background:
                      'linear-gradient(135deg, #7c3aed 0%, #a855f7 100%)',
                    fontSize: '0.875rem',
                    fontWeight: 600,
                  }}
                >
                  {avatarInitial}
                </Avatar>
              )}
              <Typography
                variant="body2"
                sx={{
                  color: 'text.secondary',
                  display: { xs: 'none', sm: 'block' },
                }}
              >
                {displayName}
              </Typography>
            </Box>

            {/* Sign out button */}
            <Button
              variant="outlined"
              size="small"
              onClick={handleSignOut}
              disabled={signingOut}
              sx={{
                minWidth: 'auto',
                px: 2,
                py: 0.75,
                fontSize: '0.875rem',
              }}
            >
              {signingOut ? t('signingOut') : t('signOut')}
            </Button>
          </Box>
        </Toolbar>
      </AppBar>

      {/* Main content */}
      <Container
        maxWidth="lg"
        sx={{
          px: { xs: 2, sm: 3, lg: 4 },
          py: { xs: 4, sm: 5, lg: 6 },
        }}
      >
        {children}
      </Container>
    </Box>
  );
}
