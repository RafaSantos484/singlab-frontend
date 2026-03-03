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
      requestedAt: data.uploadedAt,
      finishedAt: data.uploadedAt,
      stems: this.getStems(data, info.stems),
      providerData: data,
      metadata: {
        uploadedAt: data.uploadedAt,
      },
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

    return {
      uploadedAt: storedStems.uploadedAt,
      paths: storedStems.paths,
    };
  }

  getRequestedAt(data: LocalSeparationProviderData): string | null {
    return data.uploadedAt ?? null;
  }

  getFinishedAt(data: LocalSeparationProviderData): string | null {
    return data.uploadedAt ?? null;
  }

  shouldPoll(): boolean {
    return false;
  }

  shouldProcessStems(
    _data: LocalSeparationProviderData,
    storedStems: SeparatedSongInfo<LocalSeparationProviderData>['stems'],
  ): boolean {
    return storedStems !== null && storedStems.paths !== null;
  }

  getStemUrls(): Record<string, string> {
    return {};
  }
}
