import type {
  NormalizedSeparationInfo,
  PoyoSeparationStatus,
  PoyoSeparationTaskDetails,
  SeparationJobStatus,
  SeparationStems,
  SeparatedSongInfo,
} from '@/lib/api/types';
import { type SeparationProviderAdapter } from './adapter';

function mapStatus(status: PoyoSeparationStatus): SeparationJobStatus {
  switch (status) {
    case 'finished':
      return 'finished';
    case 'failed':
      return 'failed';
    default:
      return 'processing';
  }
}

function mapStoredStems(
  stems: SeparatedSongInfo<PoyoSeparationTaskDetails>['stems'],
): SeparationStems | null {
  if (!stems) return null;

  return {
    uploadedAt: stems.uploadedAt,
    paths: stems.paths,
  };
}

export class PoyoSeparationAdapter implements SeparationProviderAdapter<PoyoSeparationTaskDetails> {
  readonly name = 'poyo' as const;

  toNormalized(
    info: SeparatedSongInfo<PoyoSeparationTaskDetails>,
  ): NormalizedSeparationInfo<PoyoSeparationTaskDetails> {
    const data = info.providerData;
    const status = mapStatus(data.status);

    return {
      provider: this.name,
      status,
      taskId: this.getTaskId(data),
      errorMessage: this.getErrorMessage(data),
      requestedAt: this.getRequestedAt(data),
      finishedAt: this.getFinishedAt(data),
      stems: this.getStems(data, info.stems),
      providerData: data,
      metadata: {
        status: data.status,
        created_time: data.created_time,
      },
    };
  }

  getStatus(data: PoyoSeparationTaskDetails): SeparationJobStatus {
    return mapStatus(data.status);
  }

  getTaskId(data: PoyoSeparationTaskDetails): string | null {
    return data.task_id ?? null;
  }

  getErrorMessage(data: PoyoSeparationTaskDetails): string | null {
    return data.error_message ?? null;
  }

  getStems(
    _data: PoyoSeparationTaskDetails,
    storedStems: SeparatedSongInfo<PoyoSeparationTaskDetails>['stems'],
  ): SeparationStems | null {
    return mapStoredStems(storedStems);
  }

  getRequestedAt(data: PoyoSeparationTaskDetails): string | null {
    return data.created_time ?? null;
  }

  getFinishedAt(data: PoyoSeparationTaskDetails): string | null {
    if (data.status === 'finished') {
      return data.created_time ?? null;
    }
    return null;
  }

  shouldPoll(data: PoyoSeparationTaskDetails): boolean {
    const status = mapStatus(data.status);
    return status === 'processing';
  }

  /**
   * Determines whether stems should be processed and uploaded.
   *
   * Returns true when:
   * - Separation task has finished processing
   * - Stems have not yet been persisted to the song document
   *
   * @param data - PoYo provider task details.
   * @param storedStems - Current stems stored in the song document (null if not uploaded yet).
   * @returns True if stems should be downloaded and uploaded to Firebase Storage.
   */
  shouldProcessStems(
    data: PoyoSeparationTaskDetails,
    storedStems: SeparatedSongInfo<PoyoSeparationTaskDetails>['stems'],
  ): boolean {
    return mapStatus(data.status) === 'finished' && !storedStems;
  }

  /**
   * Extracts stem download URLs from PoYo task data.
   *
   * PoYo returns stems nested in `data.files[0].vocal_removal` when the task
   * is finished. This method flattens that structure into a simple
   * `{ stemName: url }` record.
   *
   * @param data - PoYo provider task details.
   * @returns Record of stem names to download URLs (empty if task not finished or no stems).
   */
  getStemUrls(data: PoyoSeparationTaskDetails): Record<string, string> {
    if (
      data.status === 'finished' &&
      'files' in data &&
      Array.isArray(data.files) &&
      data.files.length > 0
    ) {
      const fileEntry = data.files[0];
      if ('vocal_removal' in fileEntry && typeof fileEntry.vocal_removal === 'object') {
        return unflattenStemUrls(fileEntry.vocal_removal);
      }
    }
    return {};
  }
}

/**
 * Flatten PoYo's stem URL structure into a simple Record.
 * PoYo returns: { vocals: url, bass: url, ... }
 */
function unflattenStemUrls(
  stems: Record<string, string | null>,
): Record<string, string> {
  return Object.entries(stems).reduce<Record<string, string>>(
    (acc, [key, url]) => {
      if (url) {
        acc[key] = url;
      }
      return acc;
    },
    {},
  );
}
