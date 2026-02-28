import type {
  NormalizedSeparationInfo,
  PoyoSeparationStatus,
  PoyoSeparationTaskDetails,
  SeparationJobStatus,
  SeparationStemOutputs,
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

function extractStems(data: PoyoSeparationTaskDetails): SeparationStemOutputs {
  if (data.status === 'finished') {
    return {
      vocals: data.files[0].vocal_removal.vocals,
      bass: data.files[0].vocal_removal.bass,
      drums: data.files[0].vocal_removal.drums,
      piano: data.files[0].vocal_removal.piano,
      guitar: data.files[0].vocal_removal.guitar,
      other: data.files[0].vocal_removal.other,
    };
  }

  return {
    vocals: null,
    bass: null,
    drums: null,
    piano: null,
    guitar: null,
    other: null,
  };
}

export class PoyoSeparationAdapter implements SeparationProviderAdapter<PoyoSeparationTaskDetails> {
  readonly name = 'poyo' as const;

  toNormalized(
    info: SeparatedSongInfo<PoyoSeparationTaskDetails>,
  ): NormalizedSeparationInfo {
    const data = info.data;
    const status = mapStatus(data.status);

    return {
      provider: this.name,
      status,
      taskId: this.getTaskId(data),
      progress: this.getProgress(data),
      errorMessage: this.getErrorMessage(data),
      requestedAt: this.getRequestedAt(data),
      finishedAt: this.getFinishedAt(data),
      stems: this.getStems(data),
      providerData: data,
      metadata: {
        status: data.status,
        created_time: data.created_time,
        progress: data.progress ?? null,
      },
    };
  }

  getStatus(data: PoyoSeparationTaskDetails): SeparationJobStatus {
    return mapStatus(data.status);
  }

  getTaskId(data: PoyoSeparationTaskDetails): string | null {
    return data.task_id ?? null;
  }

  getProgress(data: PoyoSeparationTaskDetails): number | null {
    if (data.status === 'finished') return 100;
    if (typeof data.progress === 'number') return data.progress;
    return null;
  }

  getErrorMessage(data: PoyoSeparationTaskDetails): string | null {
    return data.error_message ?? null;
  }

  getStems(data: PoyoSeparationTaskDetails): SeparationStemOutputs {
    return extractStems(data);
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
