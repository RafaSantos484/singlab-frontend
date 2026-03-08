import {
  DEFAULT_TRANSCRIPTION_SETTINGS,
  WHISPER_MODEL_OPTIONS,
  getTranscriptionLanguageFromLocale,
} from '../constants';

describe('transcription constants', () => {
  it('maps known locales to supported whisper language codes', () => {
    expect(getTranscriptionLanguageFromLocale('pt-BR')).toBe('pt');
    expect(getTranscriptionLanguageFromLocale('en-US')).toBe('en');
    expect(getTranscriptionLanguageFromLocale('es-ES')).toBe('auto');
  });

  it('keeps a valid default model configured', () => {
    const modelIds = new Set(WHISPER_MODEL_OPTIONS.map((item) => item.id));

    expect(modelIds.has(DEFAULT_TRANSCRIPTION_SETTINGS.model)).toBe(true);
    expect(DEFAULT_TRANSCRIPTION_SETTINGS.quantized).toBe(true);
    expect(DEFAULT_TRANSCRIPTION_SETTINGS.subtask).toBe('transcribe');
    expect(DEFAULT_TRANSCRIPTION_SETTINGS.language).toBe('auto');
  });
});
