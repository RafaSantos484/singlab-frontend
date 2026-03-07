import type {
  NormalizedSeparationInfo,
  LocalSeparationProviderData,
  SeparationJobStatus,
  SeparationStems,
  SeparatedSongInfo,
} from '@/lib/api/types';
import { type SeparationProviderAdapter } from './adapter';

/**
 * Adapter for the local stem separation provider.
 *
 * The local provider allows users to manually upload separated stems.
 * Since there is no external processing, stems are immediately available
 * once uploaded, and the status is always 'finished'.
 */
export class LocalSeparationAdapter implements SeparationProviderAdapter<LocalSeparationProviderData> {
  readonly name = 'local' as const;

  toNormalized(
    info: SeparatedSongInfo<LocalSeparationProviderData>,
  ): NormalizedSeparationInfo<LocalSeparationProviderData> {
    const data = info.providerData;

    return {
      provider: this.name,
      status: 'finished',
      taskId: null,
      errorMessage: null,
      requestedAt: null,
      finishedAt: null,
      stems: this.getStems(data, info.stems),
      providerData: data,
      metadata: {},
    };
  }

  getStatus(): SeparationJobStatus {
    return 'finished';
  }

  getTaskId(): string | null {
    return null;
  }

  getErrorMessage(): string | null {
    return null;
  }

  getStems(
    _data: LocalSeparationProviderData,
    storedStems: SeparatedSongInfo<LocalSeparationProviderData>['stems'],
  ): SeparationStems | null {
    if (!storedStems) return null;

    if (Array.isArray(storedStems)) {
      return storedStems;
    }

    // Backward compatibility for legacy docs storing { uploadedAt, paths }.
    if (
      typeof storedStems === 'object' &&
      storedStems !== null &&
      'paths' in storedStems
    ) {
      const paths = (storedStems as { paths?: Record<string, string> }).paths;
      if (paths && typeof paths === 'object') {
        return Object.keys(paths) as SeparationStems;
      }
    }

    return null;
  }

  getRequestedAt(): string | null {
    return null;
  }

  getFinishedAt(): string | null {
    return null;
  }

  shouldPoll(): boolean {
    return false;
  }

  shouldProcessStems(
    _data: LocalSeparationProviderData,
    storedStems: SeparatedSongInfo<LocalSeparationProviderData>['stems'],
  ): boolean {
    return Array.isArray(storedStems) && storedStems.length > 0;
  }

  getStemUrls(): Record<string, string> {
    return {};
  }
}
