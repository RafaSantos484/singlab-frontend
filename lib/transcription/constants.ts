import type { TranscriptionSettings } from './types';

export interface WhisperModelOption {
  id: string;
  quantizedSizeMb: number;
  fullPrecisionSizeMb?: number;
  supportsMultilingual: boolean;
}

export interface WhisperLanguageOption {
  code: string;
}

export const TRANSCRIPTION_SAMPLE_RATE = 16000;

export const WHISPER_MODEL_OPTIONS: WhisperModelOption[] = [
  {
    id: 'Xenova/whisper-tiny',
    quantizedSizeMb: 41,
    fullPrecisionSizeMb: 152,
    supportsMultilingual: true,
  },
  {
    id: 'Xenova/whisper-base',
    quantizedSizeMb: 77,
    fullPrecisionSizeMb: 291,
    supportsMultilingual: true,
  },
  {
    id: 'Xenova/whisper-small',
    quantizedSizeMb: 249,
    fullPrecisionSizeMb: 920,
    supportsMultilingual: true,
  },
];

export const WHISPER_LANGUAGE_OPTIONS: WhisperLanguageOption[] = [
  { code: 'auto' },
  { code: 'en' },
  { code: 'pt' },
  { code: 'es' },
  { code: 'fr' },
  { code: 'de' },
  { code: 'it' },
  { code: 'ja' },
  { code: 'ko' },
  { code: 'zh' },
];

export const DEFAULT_TRANSCRIPTION_SETTINGS: TranscriptionSettings = {
  // Default to a quantized `whisper-base` model to reduce memory
  // requirements on typical client devices. Users may switch models
  // or disable `quantized` in the Transcription dialog if desired.
  model: 'Xenova/whisper-base',
  multilingual: false,
  quantized: true,
  language: 'auto',
};

export function getTranscriptionLanguageFromLocale(locale: string): string {
  const normalizedLocale = locale.toLowerCase();

  if (normalizedLocale.startsWith('pt')) {
    return 'pt';
  }

  if (normalizedLocale.startsWith('en')) {
    return 'en';
  }

  return 'auto';
}
