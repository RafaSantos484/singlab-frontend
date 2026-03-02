'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { useTranslations } from 'next-intl';
import {
  getPendingActivityCount,
  subscribePendingActivity,
} from '@/lib/async/pendingActivity';

interface UsePendingNavigationGuardResult {
  hasPendingActivity: boolean;
  confirmNavigationIfPending: () => boolean;
}

export function usePendingNavigationGuard(): UsePendingNavigationGuardResult {
  const t = useTranslations('NavigationGuard');
  const pendingCount = useSyncExternalStore(
    subscribePendingActivity,
    getPendingActivityCount,
    getPendingActivityCount,
  );

  const hasPendingActivity = pendingCount > 0;

  useEffect(() => {
    if (!hasPendingActivity) {
      return undefined;
    }

    const handleBeforeUnload = (event: BeforeUnloadEvent): string => {
      event.preventDefault();
      event.returnValue = '';
      return '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [hasPendingActivity]);

  const confirmNavigationIfPending = useCallback((): boolean => {
    if (!hasPendingActivity) {
      return true;
    }

    return window.confirm(t('confirmLeaveMessage'));
  }, [hasPendingActivity, t]);

  return {
    hasPendingActivity,
    confirmNavigationIfPending,
  };
}
