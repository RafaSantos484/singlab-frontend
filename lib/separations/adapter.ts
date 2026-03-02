import type {
  NormalizedSeparationInfo,
  SeparationJobStatus,
  SeparationProviderName,
  SeparationStems,
  SeparatedSongInfo,
} from '@/lib/api/types';

/**
 * Contract for processing completed separation tasks and uploading stems.
 * Providers implement this to expose provider-specific stem extraction logic.
 */
export interface SeparationStemProcessor<TData> {
  /**
   * Whether the separation has completed and stems should be processed.
   * Returns true when status is 'finished' and stems haven't been uploaded yet.
   */
  shouldProcessStems(
    data: TData,
    storedStems: SeparatedSongInfo<TData>['stems'],
  ): boolean;

  /**
   * Extract download URLs of separated stems from provider data.
   * Returns empty object if task is not finished or no stems available.
   */
  getStemUrls(data: TData): Record<string, string>;
}

/**
 * Contract for adapting provider-specific payloads into normalized structures
 * consumable by the UI.
 */
export interface SeparationProviderAdapter<
  TData,
> extends SeparationStemProcessor<TData> {
  readonly name: SeparationProviderName;

  /** Derive a provider-agnostic view of the separation state. */
  toNormalized(info: SeparatedSongInfo<TData>): NormalizedSeparationInfo<TData>;

  /** Current high-level status. */
  getStatus(data: TData): SeparationJobStatus;

  /** Provider task identifier, if available. */
  getTaskId(data: TData): string | null;

  /** Human-readable error message for failed tasks. */
  getErrorMessage(data: TData): string | null;

  /** Generated stems with their URLs. */
  getStems(
    data: TData,
    storedStems: SeparatedSongInfo<TData>['stems'],
  ): SeparationStems | null;

  /** Creation timestamp when available. */
  getRequestedAt(data: TData): string | null;

  /** Completion timestamp when available. */
  getFinishedAt(data: TData): string | null;

  /** Whether the task should continue polling. */
  shouldPoll(data: TData): boolean;
}
