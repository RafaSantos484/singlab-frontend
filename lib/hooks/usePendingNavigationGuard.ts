'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { useTranslations } from 'next-intl';
import {
  getPendingActivityCount,
  subscribePendingActivity,
} from '@/lib/async/pendingActivity';

const NAVIGATION_GUARD_BYPASS_DURATION_MS = 30_000;

let bypassPendingNavigationPromptUntil = 0;

function isPendingNavigationPromptBypassed(): boolean {
  return Date.now() < bypassPendingNavigationPromptUntil;
}

function bypassPendingNavigationPromptTemporarily(): void {
  bypassPendingNavigationPromptUntil =
    Date.now() + NAVIGATION_GUARD_BYPASS_DURATION_MS;
}

interface UsePendingNavigationGuardResult {
  hasPendingActivity: boolean;
  confirmNavigationIfPending: () => boolean;
  bypassPendingNavigationPrompt: () => void;
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
      if (isPendingNavigationPromptBypassed()) {
        return '';
      }

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
    if (isPendingNavigationPromptBypassed()) {
      return true;
    }

    if (!hasPendingActivity) {
      return true;
    }

    return window.confirm(t('confirmLeaveMessage'));
  }, [hasPendingActivity, t]);

  const bypassPendingNavigationPrompt = useCallback((): void => {
    bypassPendingNavigationPromptTemporarily();
  }, []);

  return {
    hasPendingActivity,
    confirmNavigationIfPending,
    bypassPendingNavigationPrompt,
  };
}
