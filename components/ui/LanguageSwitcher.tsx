'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { IconButton, Menu, MenuItem, Tooltip, Typography } from '@mui/material';
import LanguageIcon from '@mui/icons-material/Language';
import CheckIcon from '@mui/icons-material/Check';
import { usePathname, useRouter } from '@/lib/i18n/navigation';
import { routing, type Locale } from '@/lib/i18n/routing';
import { usePendingNavigationGuard } from '@/lib/hooks/usePendingNavigationGuard';

/**
 * Language switcher component.
 *
 * Renders an icon button that opens a dropdown menu listing all supported
 * locales. Selecting a locale navigates to the same path in the new locale
 * and persists the choice via the `NEXT_LOCALE` cookie (managed by the
 * next-intl middleware).
 */
export function LanguageSwitcher(): React.ReactElement {
  const t = useTranslations('Language');
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const { confirmNavigationIfPending } = usePendingNavigationGuard();

  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const open = Boolean(anchorEl);

  const handleOpen = (event: React.MouseEvent<HTMLButtonElement>): void => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = (): void => {
    setAnchorEl(null);
  };

  const handleSelectLocale = (nextLocale: Locale): void => {
    handleClose();
    if (nextLocale === locale) return;
    if (!confirmNavigationIfPending()) return;
    router.replace(pathname, { locale: nextLocale });
  };

  /** Map locale code to its display name translation key. */
  const localeLabel = (loc: Locale): string => {
    const keyMap: Record<Locale, 'enUS' | 'ptBR'> = {
      'en-US': 'enUS',
      'pt-BR': 'ptBR',
    };
    return t(keyMap[loc]);
  };

  return (
    <>
      <Tooltip title={t('label')}>
        <IconButton
          onClick={handleOpen}
          aria-label={t('switcherAriaLabel')}
          aria-controls={open ? 'language-menu' : undefined}
          aria-haspopup="true"
          aria-expanded={open ? 'true' : undefined}
          size="small"
          sx={{
            color: 'text.secondary',
            '&:hover': { color: 'text.primary' },
          }}
        >
          <LanguageIcon fontSize="small" />
        </IconButton>
      </Tooltip>

      <Menu
        id="language-menu"
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        MenuListProps={{ 'aria-label': t('label') }}
        slotProps={{
          paper: {
            sx: {
              minWidth: 180,
              bgcolor: 'background.paper',
              border: '1px solid rgba(124, 58, 237, 0.2)',
            },
          },
        }}
      >
        {routing.locales.map((loc) => (
          <MenuItem
            key={loc}
            onClick={() => handleSelectLocale(loc)}
            selected={loc === locale}
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 2,
            }}
          >
            <Typography variant="body2">{localeLabel(loc)}</Typography>
            {loc === locale && (
              <CheckIcon fontSize="small" sx={{ color: 'primary.main' }} />
            )}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}
