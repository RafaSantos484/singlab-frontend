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
}
