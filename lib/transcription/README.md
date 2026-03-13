# Transcription module — developer notes

This folder contains the client-side transcription integration (Whisper
pipeline worker + loader). Recent changes simplified the transcription
flow to a per-segment (silence-sliced) transcription model.

Key points for maintainers
- Per-segment flow: callers provide processed (silence-removed) audio and
  an array of `SpeechSegment` intervals. The worker is invoked per segment
  and returns final text for that segment. Timestamp mapping is handled
  by the caller using the silence map.
- `subtask` / translate option removed: the application now performs
  transcription-only. If translation is required in the future re-introduce
  a `task`/`subtask` option carefully and update types and worker messages.
- Worker messages: the worker now returns simple per-segment completions
  of the shape `{ status: 'complete', data: { text, segmentIndex } }`.
- Performance: large Float32Array buffers are transferred to the worker to
  avoid copies. See `useWhisperTranscriber` for `postMessage(..., [buffer])`.
- Constants: distil/distinct model variants were removed from
  `lib/transcription/constants.ts` — adjust available model list there.
  - Note: the default settings in `lib/transcription/constants.ts` now
    choose a quantized `Xenova/whisper-base` model to reduce memory usage
    on typical client devices. If you change this default, update docs
    and translations accordingly (see `messages/en-US.json` / `pt-BR.json`).
  - The hook and UI now cache a processed audio `Blob` per Transcription
    dialog session to avoid re-running FFmpeg repeatedly; callers should
    be aware of in-memory blob lifetimes when profiling memory usage.
  - Inline editing: the Transcription UI (`TranscriptionDialog`) now exposes an inline edit workflow for adapted lyric chunks. The `useLyricsAdaptation` hook provides an `editChunk(index, newText)` method that lets the UI persist manual corrections; corrected chunks are marked with a `corrected` status. When changing UI behavior or the adaptation state shape, update this README and the `useLyricsAdaptation` types.
    - Automatic bounded retries: after the initial per-chunk adaptation pass completes,
      `useLyricsAdaptation` can automatically run iterative bounded retry rounds
      over any `unmatched` segments. Each bounded retry narrows the lyric prompt
      to an excerpt built from the nearest resolved neighbours and re-dispatches a
      `retry-chunk` request to the worker. The loop repeats until a round makes
      no new resolutions or all segments are resolved. Manual `retry` is still
      available and behaves the same as a single explicit retry request.
      When updating the worker message protocol or the retry coordination logic,
      update `lib/transcription/lyricsAdapter.ts` types (`AdaptedChunk`,
      `LyricsAdapterRequest`) and the README accordingly.
    - New lyrics adapter helpers: `lib/transcription/lyricsAdapter.ts` gained
      pure helpers used by the auto-retry coordinator (`isResolvedChunk`,
      `findPrevResolved`, `findNextResolved`, `buildBoundedLyricScope`) and the
      `AdaptedChunk` type now includes optional `lyricIdxStart`/`lyricIdxEnd` so
      that bounded excerpt retries and returned results can be aligned with the
      full parsed lyrics array. These helpers are SSR-safe and intended to be
      imported both from the hook and from the worker.
- New helper: `lib/audio/sliceWav.ts` — creates a valid WAV `Blob` for a
  requested time slice (reads headers and copies PCM frames). Useful for
  creating per-segment object URLs used by the UI players.
  - The Transcription UI creates per-segment object URLs from sliced WAV
    blobs so each segment player can use a bounded audio file. When editing
    code that manipulates segment URLs, ensure existing object URLs are
    revoked to avoid leaking browser memory.
- UI: `components/features/SegmentPlayers.tsx` was added to render
  per-segment audio players using either per-segment object URLs or the
  full processed audio as fallback.

If you change the worker API or per-segment contract, update this README
and the types in `lib/transcription/types.ts` accordingly.
