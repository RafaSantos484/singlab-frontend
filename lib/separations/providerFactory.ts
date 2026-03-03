import type {
  NormalizedSeparationInfo,
  SeparationProviderName,
  SeparatedSongInfo,
  PoyoSeparationTaskDetails,
  LocalSeparationProviderData,
} from '@/lib/api/types';
import { PoyoSeparationAdapter } from './poyoAdapter';
import { LocalSeparationAdapter } from './localAdapter';
import type { SeparationProviderAdapter } from './adapter';

const poyoAdapter = new PoyoSeparationAdapter();
const localAdapter = new LocalSeparationAdapter();

/** Resolve an adapter for the given provider name. */
export function getSeparationAdapter(
  provider: SeparationProviderName,
): SeparationProviderAdapter<unknown> {
  switch (provider) {
    case 'poyo':
      return poyoAdapter as SeparationProviderAdapter<PoyoSeparationTaskDetails>;
    case 'local':
      return localAdapter as SeparationProviderAdapter<LocalSeparationProviderData>;
    default:
      throw new Error(`Unsupported separation provider: ${provider}`);
  }
}

/** Convert stored separation info into a normalized shape for the UI. */
export function normalizeSeparationInfo(
  info: SeparatedSongInfo | null,
): NormalizedSeparationInfo | null {
  if (!info) return null;
  const adapter = getSeparationAdapter(info.provider);
  return adapter.toNormalized(info as SeparatedSongInfo<unknown>);
}

/** Whether the given separation should continue polling. */
export function shouldPollSeparation(info: SeparatedSongInfo | null): boolean {
  if (!info) return false;
  const adapter = getSeparationAdapter(info.provider);
  return adapter.shouldPoll(info.providerData as unknown);
}
