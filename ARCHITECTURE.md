# SingLab Frontend — Architecture Overview

## High-Level Architecture

```
┌───────────────────────────────────────────────────────────────────┐
│  Browser / User                                                   │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  Next.js App Router (singlab-frontend)                      │ │
│  │                                                             │ │
│  │  Pages & Layouts         Components            Lib (utils)  │ │
│  │  ─────────────────       ──────────────         ──────────  │ │
│  │  app/layout.tsx          features/GlobalPlayer  firebase/*  │ │
│  │  app/page.tsx            ui/…                   api/sep.    │ │
│  │  app/login/              …                      hooks/*     │ │
│  │  app/dashboard/                                 store/*     │ │
│  └──────┬───────────────────────────┬─────────────────────────┘ │
└─────────│───────────────────────────│──────────────────────────────┘
          │  Direct SDK                │  HTTP (REST)
          ▼                           ▼
┌──────────────────────┐  ┌──────────────────────────────────────┐
│ Firebase (client SDK)│  │ singlab-api (NestJS + Cloud Functions)│
│                      │  │                                      │
│ • Auth (sign-in,     │  │ POST /separations/submit              │
│   registration)      │  │   → Forward request to PoYo API      │
│ • Firestore (songs,  │  │ GET  /separations/status              │
│   users, separation  │  │   → Fetch task status from PoYo      │
│   info)              │  │                                      │
│ • Cloud Storage      │  │ No Firestore / Storage access        │
│   (raw audio, stems) │  └──────────────┬───────────────────────┘
└──────────────────────┘                 │
                                         ▼
                                  ┌────────────┐
                                  │ Stem Split │
                                  │ API (PoYo) │
                                  └────────────┘
```

## Frontend Layers

### 1. App Router (pages & layouts)

All routes live under `app/`. Route segments follow Next.js App Router
conventions with server and client components as appropriate.

| Route | Purpose |
|---|---|
| `/` | Landing / home |
| `/login` | Firebase authentication page |
| `/forgot-password` | Password reset request page |
| `/register` | Account creation page (email + password) |
| `/complete-profile` | Profile bootstrap page for first sign-in (creates `/users/{uid}`) |
| `/dashboard` | User's song library with inline audio player |

### 2. Components

Components are split into two groups:

- **`components/layout/`** — Shared page wrappers for route families.
     - `AuthLayout` — common visual shell for auth/profile routes
       (`/login`, `/register`, `/forgot-password`, `/complete-profile`).
     - `DashboardLayout` — authenticated shell (app bar, profile, sign out).
- **`components/ui/`** — Branding and decorative primitives (`SingLabLogo`,
     waveform/spectrum decorations).
- **`components/features/`** — Feature-specific composite components.
     - `GlobalPlayer` — single global audio player component; displays currently
          playing song with play/pause/stop controls, progress bar, and volume.
          Supports both raw audio and separated stem playback with stem selection UI.
          Integrated with global state for centralized playback control.
     - `SongCardItem` — reusable song card displaying metadata, play/edit buttons,
          and separation status (pending, processing, finished, or failed).
          Uses `useSeparationStatus` hook to manage the separation lifecycle.
     - `SongDeleteButton` — reusable confirmation dialog for deleting songs with
          loading state, accessibility features, and error handling.
     - `SeparationDialog` — provider selector (`poyo` or `local`) for separation requests.
     - `StemUploadForm` — manual stem upload workflow (vocals required + at least one extra stem).
     - `SongCreateDialog` — upload workflow with:
          * File picker + drag-and-drop support
          * Audio format validation (MIME type + extension fallback)
          * Client-side metadata extraction from audio tags
          * Client-side FFmpeg WASM canonical audio normalization with progress tracking
          * Form validation for title/author
          * Multi-phase progress UI (converting → uploading → saving)
     - `SongEditDialog` — song metadata editing with validation and error handling.
     - `TranscriptionDialog` — in-browser vocals transcription using OpenAI Whisper
          (transformers.js) with full silence-removal pipeline: FFmpeg WASM detects
          and removes silences from the vocals track, builds a cut map, Whisper
          transcribes the silence-removed audio with word-level timestamps, and
          timestamps are automatically remapped back to the original audio timeline.
          Configurable model size (tiny, base, small, medium), quantization,
          multilingual language selection, inline audio players for original and
          silence-removed vocals, and collapsible silence cut map display.
          Automatically pauses GlobalPlayer on open via `requestGlobalPlayerPause`.
          Includes a **Lyrics Adaptation** panel (always visible, with an inline
          help tooltip): the user pastes the canonical song lyrics, and a
          Flan-T5 LLM (running in a dedicated Web Worker via transformers.js)
          aligns each Whisper chunk to the closest lyric span using Levenshtein
          similarity + optional LLM text2text refinement. During the batch run,
          any unmatched chunk is automatically retried up to 3 times with a
          progressively broader prompt before the result is finalised. Each
          result can also be retried individually after the run. Results are
          colour-coded (`matched` / `corrected` / `unmatched`), with a retry
          count badge on chunks that needed multiple attempts. The LLM model is
          downloaded and cached on first use; subsequent runs reuse the warm
          pipeline from the worker.
     - `SingingPracticeDialog` — synchronized practice experience with
          dual pitch tracking (vocals stem + user microphone), seek controls,
          dynamic pitch axis, and graceful fallback when Storage CORS blocks
          vocals waveform reads.
     - `TrackDownloadDialog` — lets users choose and download raw or individual
          separated stem tracks (vocals, bass, drums, etc.) with sanitized file names.

### 3. Lib

Shared utilities used across the app:

| Module | Responsibility |
|---|---|
| `lib/api/` | Typed HTTP client for backend separation endpoints only (30s timeout, logging) |
| `lib/api/song-creation.ts` | Three-step song upload: validation → FFmpeg canonical normalization (AAC/M4A) → Storage upload → Firestore save with rollback |
| `lib/api/separations.ts` | API client for stem separation proxy (submit, status) |
| `lib/audio/normalizeAudio.ts` | Client-side audio/video normalization to canonical AAC/M4A using FFmpeg WASM (singleton, lazy-loaded from CDN). Queue-based concurrency control serializes all conversion operations to prevent shared WASM instance and virtual FS collisions. Unique file tokens prevent path conflicts. |
| `lib/audio/ffmpegVocals.ts` | FFmpeg WASM silence removal for vocals tracks. Single-pass silence detection and cut-map construction, followed by `atrim+concat` to produce a 16 kHz mono WAV with silence gaps removed. Returns a `SpeechSegment[]` cut map mapping processed ↔ original audio coordinates for timestamp reconstruction. |
| `lib/audio/timestampRemap.ts` | Timestamp reconstruction utilities. `remapTimestamp()` maps a single processed-audio timestamp back to the original timeline via binary search over `SpeechSegment[]`. `remapWordTimestamps()` applies the remap to Whisper word arrays and preserves the original `processedTimestamp` when present. |
| `lib/async/` | Pending activity tracking for navigation guards (prevents leaving during uploads) |
| `lib/firebase/` | Firebase app initialization (singleton), auth helpers, Firestore CRUD (songs, users), Storage utilities |
| `lib/hooks/` | Custom React hooks (`useAuthGuard`, `useSongRawUrl`, `useSeparationStatus`, `useStemAutoProcessor`, etc.) |
| `lib/hooks/useLyricsAdaptation.ts` | Manages the lyrics adaptation Worker lifecycle: lazy worker creation, per-job ID tracking (stale message filtering), synchronous `adapt()` that posts to the worker, `retryChunk()` that re-adapts a single chunk with a progressively broadened prompt, and `cancel()`/`reset()` that set state immediately and discard in-flight results. Exposes a 5-phase state machine (`idle` → `loading-model` → `adapting` → `done` / `error`). Also tracks `retryingIndex` (which chunk is being retried) and `retryError` (last retry error, shown without replacing the results list). Wraps retries with `startPendingActivity` to block page navigation while the worker is running. |
| `lib/hooks/useWhisperTranscriber.ts` | Custom React hook managing Whisper Web Worker lifecycle: model loading, transcription start/stop, progress tracking, and incremental transcript state. Accepts silence-removed `Float32Array` audio and a `SpeechSegment[]` cut map; automatically remaps word-level timestamps from the processed audio back to the original vocals timeline after the worker completes, then filters out any backtracking chunks (segments whose start time regresses below the highest end time seen so far) to eliminate duplicates caused by Whisper re-processing already-transcribed audio. Supports multiple model sizes and multilingual transcription with configurable language. |
| `lib/transcription/` | Web Worker entry point (`loader.worker.ts`) that loads and runs OpenAI Whisper via transformers.js, handles inference requests with word-level timestamps (`return_timestamps: 'word'`), emits progress events, and streams incremental transcript chunks. Also includes TypeScript types and model/language configuration (`constants.ts`). |
| `lib/transcription/lyricsAdapter.ts` | Pure types and text-processing utilities for lyrics alignment: Levenshtein similarity, span picking over 1–`SPAN_MAX` consecutive lyric lines, punctuation/capitalisation helpers, `parseLyricsLines`. No side effects — safe to import from SSR and the worker alike. Also defines the typed worker message protocol (`LyricsAdapterRequest` / `LyricsAdapterResponse`), including the `retry-chunk` / `retry-chunk-done` messages added for per-chunk retry. The `AdaptedChunk` type carries a `retryCount` field incremented on each retry. |
| `lib/transcription/lyricsAdapter.worker.ts` | Web Worker that runs Flan-T5 text2text-generation (via transformers.js) for lyrics alignment. Per-file download progress is tracked in a `Map` and reported as a running average to avoid progress appearing to reset on each new model file. Handles two request types: `adapt` processes all chunks sequentially — for each chunk, tries heuristic + LLM matching, then automatically retries unmatched chunks up to `MAX_AUTO_RETRIES` (3) times with escalating prompt breadth before posting `chunk-done`; `retry-chunk` re-adapts a single chunk with an escalated strategy controlled by `retryCount` — higher `retryCount` widens `SPAN_MAX`, relaxes similarity thresholds, and appends a progressively stronger retry instruction to the LLM prompt. Both paths support cancellation via an `activeJobId` guard checked after each `await`. |
| `lib/player/practiceSync.ts` | Publish/subscribe bus for inter-component player communication. Provides typed channels: `emitGlobalPlayerSnapshot`/`subscribeGlobalPlayerSnapshots` for player state broadcasts, `requestPracticeMode`/`subscribePracticeCommands` for practice mode commands, `requestPracticeDialogOpen`/`subscribePracticeDialogOpenRequests` for dialog launch requests, and `requestGlobalPlayerPause`/`subscribeGlobalPause` for external pause requests (e.g. pausing on TranscriptionDialog open). |
| `lib/player/practiceSync.ts` | Publish/subscribe bus for inter-component player communication. Provides typed channels: `emitGlobalPlayerSnapshot`/`subscribeGlobalPlayerSnapshots` for player state broadcasts, `requestPracticeMode`/`subscribePracticeCommands` for practice mode commands, `requestPracticeDialogOpen`/`subscribePracticeDialogOpenRequests` for dialog launch requests, and `requestGlobalPlayerPause`/`subscribeGlobalPause` for external pause requests (e.g. pausing on TranscriptionDialog open). |
| `lib/separations/` | Adapter pattern for provider-agnostic separation normalization and stem URL extraction |
| `lib/storage/` | Firebase Storage upload utilities (raw songs and separated stems) with rollback support. Automatically invalidates cache after upload/delete operations. |
| `lib/storage/StorageUrlManager.ts` | Centralized Firebase Storage download URL caching with TTL (1 day) based expiration, deduplication of concurrent requests, and automatic refresh on expiry. Supports selective path invalidation on upload/delete and full cache clearing on sign-out. Ensures fast URL access for real-time playback switching without redundant Firebase calls or stale URLs. |
| `lib/store/` | Global state — `GlobalStateProvider` (React Context + useReducer) manages auth, songs, and player state |
| `lib/theme/muiTheme.ts` | Centralized MUI theme tokens and component defaults |
| `lib/validation/` | Zod-based validation schemas and functions (sign-in, user creation) |
| `lib/env.ts` | Typed, validated environment variable access |

## Authentication Flow

```
User browser
    │
    │  1. Sign in with Firebase Auth (Google / Email)
    ▼
Firebase Auth (client SDK)
    │
    │  2. Obtain ID token
    ▼
singlab-api
    │  Authorization: Bearer <idToken>
    │
    │  3. Guard verifies token with Firebase Admin SDK
    ▼
Protected endpoints
```

## Song Upload & Stem Processing Flows

### Song Upload Flow (Validation → Conversion → Storage → Firestore)

```
[User selects audio file via picker or drag-and-drop in SongCreateDialog]
     │
     │ 1. Client-side validation (size, format, MIME + extension fallback)
     │ 2. Metadata extraction from audio tags (optional, auto-fill title/artist)
     │ 3. Extract metadata if available
     ▼
[FFmpeg WASM normalizes audio/video to canonical AAC/M4A]
     │
     │ Uses [@ffmpeg/ffmpeg] loaded from CDN (single-threaded, no COOP/COEP needed)
     │ No fast path: all uploads are always normalized
     │ Supports: MP3, WAV, OGG, WebM, MP4, MOV, FLAC, AAC, M4A
     │ VBR encoding (~192 kbps) for smaller file sizes
     │ Progress callback updates UI (0–100%)
     ▼
[User fills in Title and Author (can be auto-filled from metadata)]
     │
     │ Client-side validation of metadata fields
     ▼
[Generate stable songId (Firestore doc ID)]
[Upload normalized audio to Storage: users/:userId/songs/:songId/raw.m4a]
     ▼
[Firebase Storage SDK uploads audio]
     │
     │ withPendingActivity() tracks upload
     │ Navigation guard prevents tab close
     ▼
[createSongDoc() writes directly to Firestore]
     │
     │ Creates song document at /users/{uid}/songs/{songId}
     │ No backend API call needed
     ▼
[Success]
     │
     │ If Firestore write fails → rollback: delete Storage file
     │ Real-time listener adds song to globalState
     ▼
[Song appears in dashboard]
```

### Stem Separation Processing Flow

Two provider paths are supported: `poyo` (async backend-proxied AI task) and
`local` (immediate manual stem upload).

#### `poyo` provider flow

```
[User opens SeparationDialog and selects provider = poyo]
     │
     │ 1. Get signed audio URL from Storage
     │ 2. POST /separations/submit { audioUrl, title }
     ▼
[Backend forwards request to PoYo API]
     │
     │ Returns provider response (taskId, status, etc.)
     ▼
[Frontend writes providerData to Firestore]
     │
     │ updateSeparatedSongInfo() writes providerData to song doc
     ▼
[useSeparationStatus polls status every 60s]
     │
     │ GET /separations/status?taskId=xxx
     │ Backend fetches status from PoYo API
     │ Frontend writes updated providerData to Firestore
     │ Firestore listener propagates changes to globalState
     ▼
[Status: processing → finished]
     │
     │ useStemAutoProcessor detects: status=finished, stems=null
     │ Extracts stem URLs from providerData (via PoyoSeparationAdapter)
     ▼
[Client downloads stems from PoYo URLs]
     │
     │ processStemUrls(): downloads each stem as Blob
     │ Uploads to Storage: users/:userId/songs/:songId/stems/:stemName.m4a
     │ withPendingActivity() tracks uploads
     ▼
[Frontend writes available stem names directly to Firestore]
     │
     │ updateSeparationStems() updates song doc with available stem names
     ▼
[Success]
     │
     │ If Firestore write fails → rollback: delete uploaded stems
     │ Real-time listener updates song.separatedSongInfo.stems
     ▼
[Stems available in GlobalPlayer]
```

#### `local` provider flow

```
[User opens SeparationDialog and selects provider = local]
     │
     │ Fills StemUploadForm (vocals required + at least one other stem)
     │ Client validates files and always normalizes audio to canonical AAC/M4A
     ▼
[Client uploads stems directly to Firebase Storage]
     │
     │ uploadSeparationStem() for each selected stem
     ▼
[Frontend writes local separation data to Firestore]
     │
     │ updateSeparatedSongInfo() with provider='local' and stems paths
     ▼
[Stems immediately available in GlobalPlayer]
```

#### Stem reset flow

```
[User clicks "Delete stems" on song card]
     │
     │ Deletes stem files from Storage
     │ Sets separatedSongInfo=null in Firestore
     ▼
[Song becomes eligible for a new separation request]
```

### Vocals Transcription Flow (Client-side Whisper)

```
[User opens TranscriptionDialog from a song card]
     │
     │ Selects model, quantization, language/task options
     ▼
[Stage 1: Silence detection — FFmpeg WASM silencedetect]
     │
     │ Fetch vocals stem as Blob
     │ Run silencedetect filter (-45 dB, min 2.0 s)
     │ Parse silence intervals + total duration from FFmpeg log
     ▼
[Stage 2: Silence removal — FFmpeg WASM atrim+concat]
     │
     │ Build SpeechSegment[] cut map (original ↔ processed coordinates)
     │ Cut speech-only segments and concatenate into 16 kHz mono WAV
     │ Build human-readable cut map lines for UI display
     ▼
[Stage 3: Audio decode]
     │
     │ Decode processed WAV to Float32Array via Web Audio API
     ▼
[useWhisperTranscriber posts request to Web Worker]
     │
     │ Worker loads Whisper model via transformers.js
     │ Runs inference with return_timestamps: 'word'
     │ Emits progress events and incremental transcript updates
     ▼
[Hook remaps word timestamps to original audio timeline]
     │
     │ remapWordTimestamps(chunks, speechSegments)
     │ Binary search over SpeechSegment[] cut map
     ▼
[Hook filters backtracking chunks]
     │
     │ filterBacktrackingChunks(remapped)
     │ Drops any chunk whose start < highest end time seen so far
     │ Eliminates duplicate segments from Whisper backtracking
     ▼
[Dialog renders collapsible cut map + word list with original-audio timestamps]
     │
     │ Each word shows: text + MM:SS.ss — MM:SS.ss (start — end)
     │ User can stop safely; worker disposes pipeline on stop
     ▼
[Transcription session completes entirely in browser]
     │
     │ [Optional] User pastes canonical song lyrics into the Lyrics Adaptation panel
     ▼
[useLyricsAdaptation posts 'adapt' message to lyricsAdapter.worker.ts]
     │
     │ Worker: for each non-empty chunk
     │   1. Levenshtein span-matching over lyric lines (maxSpan=3)
     │   2. Score >= CORRECT_THRESHOLD (0.88) → matched, no LLM
     │   3. Score < CORRECT_THRESHOLD → LLM prompt to Flan-T5
     │      (lazy-loaded, cached; progress reported as per-file running average)
     │   4. LLM output re-scored; accepted if >= POSSIBLE_THRESHOLD (0.72)
     │   5. If still unmatched: auto-retry up to MAX_AUTO_RETRIES (3) times
     │      with escalating prompt breadth (wider SPAN_MAX, relaxed thresholds,
     │      stronger retry instruction). retryCount on the result reflects how
     │      many auto-retries were needed.
     │   6. Posts 'chunk-done' per chunk; 'complete' when all done
     ▼
[Dialog renders colour-coded results: matched / corrected / unmatched]
     │
     │ [Optional] User clicks retry on any chunk
     ▼
[useLyricsAdaptation posts 'retry-chunk' with retryCount + 1]
     │
     │ Worker re-adapts the single chunk with an escalated strategy:
     │   - SPAN_MAX widened by retryCount (up to +3 lines)
     │   - Similarity thresholds relaxed by retryCount × 0.06 (floor 0.6/0.4)
     │   - LLM prompt appended with a retry instruction (mild → broad)
     │ Posts 'retry-chunk-done'; hook patches only that result in the list
     ▼
[Results list updated in place; retryCount badge shown on retried chunks]
```

## State Management

The app uses React built-ins (useState, useContext, useReducer) to keep the

requires it.

Global state is managed by `GlobalStateProvider` (`lib/store/`) using React
`useReducer` + Context. When a user is authenticated:

- **User profile** — data comes directly from Firebase Auth (name, email, UID)
- **Songs library** — subscribed to `/users/{uid}/songs` Firestore listener
  for real-time updates via `onSnapshot`
- **Player state** — `currentSongId` and `playbackStatus` managed in global state.
  Cards dispatch actions (`PLAYER_LOAD_SONG`) to trigger playback, and the
  `GlobalPlayer` component handles audio element control and UI rendering.

Server-side interactions that are not covered by real-time listeners (e.g.
fetching separation status from the backend proxy) are handled by dedicated
hooks (`useSeparationStatus`, `useSongRawUrl`) that call the REST API or
Firebase SDK directly.

## Audio Playback & Stem Separation

The app uses a single global audio player with centralized state management to
ensure a consistent playback experience. The player supports both raw audio
playback and separated stem playback with dynamic stem selection.

### Design Overview

The `GlobalPlayer` component delegates audio engine responsibility to two headless
sub-engines (`RawPlayerEngine` and `SeparatedPlayerEngine`) that are always mounted
and toggled via an `active` prop. Each engine reads intent from a unified
`PlayerState` interface (isPlaying, currentTime, isSeeking) and writes back
observed reality (isLoaded, isBuffering, duration, error).

**Two playback modes:**

1. **Raw Mode** (`RawPlayerEngine`) — Plays the original audio file with a single
   `HTMLAudioElement`. Simple, no synchronization complexity.

2. **Separated Mode** (`SeparatedPlayerEngine`) — Plays isolated stems (vocals,
   bass, drums, piano, guitar, other) with multi-stem synchronization:
   - A "leader" stem is elected dynamically from the enabled set and serves as the
     source of truth for playback position
   - All other stems stay synchronized via a `requestAnimationFrame` loop that
     monitors drift and applies micro-corrections using playback-rate adjustments
     (soft correction: ±0.05x) and hard re-seeking (when drift exceeds 0.25s)
   - Per-stem muting via `stemsEnabled` map changes which stems are audible
   - Transport controls (play, pause, seek, volume) affect all stems equally

**Key architectural properties:**

- Both engines are always mounted; only one is active at a time (active prop)
- The inactive engine's audio elements are paused but not destroyed, preserving
  playhead position across mode switches
- Each engine is headless (returns `null`) and communicates solely via PlayerState
- Audio URL changes are handled per-engine without requiring full element rebuild
- Drift correction runs continuously while active, playing, and not seeking
- Volume is normalized across audible stems to compensate for increased mixing

### Architecture

```
Song Cards (dashboard)
    │
    ├─→ useSeparationStatus(song)
    │       ├─→ Fetch separation status via separationsApi
    │       ├─→ Poll backend every 60s while processing (poyo provider)
    │       └─→ Display UI (request pending/progress/finished/failed)
    │
    │ dispatch({ type: 'PLAYER_LOAD_SONG', payload: songId })
    ▼
Global State (useReducer)
    │
    │ currentSongId, playbackStatus
    ▼
GlobalPlayer (component)
    │
    ├─→ PlayerState (unified intent/state contract)
    │       ├─→ Intent: isPlaying, currentTime, isSeeking
    │       └─→ Observed: isLoaded, isBuffering, duration, hasSource, error
    │
    ├─→ RawPlayerEngine
    │       ├─→ active=true when mode='raw'
    │       ├─→ Reads: player.isPlaying, player.isSeeking, player.volume, etc.
    │       ├─→ Writes: player.isLoaded, player.duration, player.currentTime, etc.
    │       ├─→ Lifecycle: mount once, swap src on URL change
    │       ├─→ Events: autoplay on canplaythrough; pause when inactive
    │       └─→ No sync logic (single element)
    │
    ├─→ SeparatedPlayerEngine
    │       ├─→ active=true when mode='separated'
    │       ├─→ useSongStemsUrl hook provides stem URLs and availability
    │       ├─→ Build/rebuild audio elements as stem pool changes
    │       ├─→ Re-elect leader when stemsEnabled set changes
    │       ├─→ requestAnimationFrame drift-correction loop:
    │       │   └─→ Every 180ms: measure drift of each stem vs. leader
    │       │       ├─→ Hard threshold (0.25s) → seek all to leader.currentTime
    │       │       ├─→ Soft threshold (0.03s) → adjust playbackRate by ±0.05x
    │       │       └─→ Below threshold → reset playbackRate to 1.0
    │       ├─→ Per-stem volume normalization: masterVolume / sqrt(audibleCount)
    │       └─→ Recovery after tab hide: re-align stems on visibility change
    │
    ├─→ Mode Switch (raw ↔ separated)
    │       ├─→ Pause both engines (only active one has audio)
    │       ├─→ Update mode state
    │       ├─→ Trigger setPreset('instrumental') for separated mode
    │       └─→ Resume playback from current time
    │
    ├─→ UI Layer
    │       ├─→ Transport: play/pause/stop buttons
    │       ├─→ Seek slider: onChange updates UI; onChangeCommitted commits seek
    │       ├─→ Volume slider
    │       ├─→ Stem selector (separated mode only): per-stem toggle + presets
    │       ├─→ Separation status panel
    │       └─→ Error alerts with user-friendly messages
    │
    └─→ Event handlers & state updates
            └─→ dispatch({ type: 'PLAYER_SET_STATUS', ... })
```

### Key Components

- **`GlobalPlayer` (`components/features/GlobalPlayer.tsx`)** — Composite component
  that manages the player UI and delegates audio engine responsibility to two
  headless engines. All player state is unified in a `PlayerState` interface
  that both engines read from and write to.

  **Public API:**
  - `GlobalPlayer()` — Top-level component that reads `currentSongId` from global
    state and returns a `GlobalPlayerInner` wrapper (or empty fragment if no song selected)
  - `GlobalPlayerInner({ song })` — Renders the player UI and mounts both engines

  **State Management:**
  - `player: PlayerState` — Unified state contract with intent (isPlaying, isSeeking,
    currentTime) and observed reality (isLoaded, isBuffering, duration, error, hasSource)
  - `mode: 'raw' | 'separated'` — Which engine is active
  - `stemsEnabled: Record<StemKey, boolean>` — Per-stem mute/unmute state
  - `player.volume` — Master volume [0..1]
  - `player.isMuted` — Mute toggle flag

  **Key Hooks:**
  - `useSongRawUrl(song)` — Fetch and cache raw audio URL with refresh logic
  - `useSongStemsUrl(song)` — Fetch and cache all stem URLs; returns available stems
  - `useStorageDownloadUrls(paths)` — Centralized URL resolution via StorageUrlManager

  **Design Principles:**
  1. **Engine isolation** — `RawPlayerEngine` and `SeparatedPlayerEngine` are
     completely independent. Only one is active; the other is paused but mounted.
  2. **Unified state contract** — Both engines read intent from `player` and write
     observed state back via `setPlayer`. UI depends on `PlayerState`, not implementation.
  3. **Headless design** — Engines return `null` (no DOM). All rendering is in
     `GlobalPlayerInner` and responds to `PlayerState` changes.
  4. **URL-driven updates** — Each engine responds to URL changes by updating
     element `src` without full rebuild (except SeparatedPlayerEngine, which rebuilds
     when the stem pool changes).
  5. **Drift correction (separated mode only)** — A `requestAnimationFrame` loop
     continuously monitors time drift and applies corrective micro-adjustments
     using playback-rate changes (soft) or immediate seeking (hard).

- **`RawPlayerEngine({ song, player, setPlayer, active })`** — Headless engine for
  single-track playback.

  **Lifecycle:**
  - Mount: create one `HTMLAudioElement` and attach all event listeners
  - URL changes: update element `src` and reset load state
  - Volume/mute changes: sync to element
  - Play/pause intent: respond to `player.isPlaying` and `player.isLoaded`
  - Seeking: apply on `isSeeking` transition to `false`
  - Deactivation: pause element

  **Event Handlers:**
  - `loadedmetadata` — Update `duration` and `isLoaded`
  - `canplaythrough` — Auto-play if `intendedPlayRef.current`
  - `timeupdate` — Sync `player.currentTime` (unless seeking)
  - `play`/`pause`/`ended` — Sync play state
  - `waiting`/`playing` — Manage `isBuffering`
  - `error` — Set error message with user-friendly text

  **Key Refs:**
  - `audioRef` — The single audio element
  - `activeRef`, `isSeekingRef`, `intendedPlayRef` — Stable references for closures

- **`SeparatedPlayerEngine({ song, player, setPlayer, active, stemsEnabled })`**
  — Headless engine for multi-stem playback with synchronization.

  **Lifecycle:**
  - Mount: set up refs and drift-correction RAF loop
  - Stem pool changes (URL changes): rebuild audio elements, re-elect leader
  - Leader election changes: update `leaderKeyRef`
  - Volume/mute/stemsEnabled changes: recalculate per-stem volumes and apply
  - Play/pause intent: coordinate all stems relative to leader
  - Seeking: align all stems and apply seek
  - Deactivation: pause all stems

  **Drift Correction Loop (`requestAnimationFrame`):**
  - Runs every 180ms when active, playing, and not seeking
  - Measures drift between each stem and leader: `diff = leader.currentTime - stem.currentTime`
  - Hard threshold (0.25s) → direct seek: `stem.currentTime = leader.currentTime`
  - Soft threshold (0.03s) → rate adjustment: `stem.playbackRate = 1 + clamp(diff * 2, ±0.05)`
  - Below threshold → reset rate to 1.0
  - On cleanup: ensure all stem playback rates are reset to 1.0

  **Per-Stem Volume Normalization:**
  - Base volume: `masterVolume = player.isMuted ? 0 : player.volume`
  - Audible count: stems with `stemsEnabled[key] !== false`
  - Per-stem volume: `baseVolume / sqrt(audibleCount)` (square-root law for
    perceived loudness when mixing multiple sources)
  - Muted stems: `audio.muted = true` (zero volume + muted flag)

  **Key Refs:**
  - `audiosRef` — Map of StemKey → HTMLAudioElement
  - `leaderKeyRef` — Currently elected leader stem
  - `leaderAudioRef` — The leader audio element for quick access
  - `playerRef`, `stemsEnabledRef` — Stable references for RAF callback
  - `durationsRef` — Per-stem duration tracking
  - `waitingSetRef` — Set of stems currently buffering

  **Helper Functions:**
  - `chooseLeaderKey(keys, enabledMap)` — Elect next leader from available/enabled
  - `computeUiDuration()` — Minimum duration across all stems (UI display)
  - `applyVolumes()` — Recalculate and apply volumes to all stems
  - `alignAllToTime(target, eps)` — Seek all stems to target time (within tolerance)
  - `playAll()` — Simultaneously play leader then all followers

  **Tab Visibility Recovery:**
  - On `visibilitychange` → `visible`: re-align stems if drift > 0.03s, then resume

- **`useSongStemsUrl(song)`** — Custom hook that resolves all available stem
  download URLs for a song.

  **Returns:**
  - `urls` — Map of StemKey → signed URL (or undefined if not available)
  - `availableStems` — Array of stem keys with available download URLs
  - `isRefreshing` — Loading state for URL refresh
  - `error` — Error message if stems finished but are unavailable

  **Logic:**
  - Normalizes `song.separatedSongInfo` into a typed `NormalizedSeparationInfo`
  - Only loads URLs if separation status is 'finished'
  - Uses `useStorageDownloadUrls` to fetch signed URLs
  - Filters available stems by URL availability
  - Returns stable keys for React dependency arrays

- **Song Cards (`SongCardItem`)** — Display song metadata, play/edit/delete buttons,
  and separation status panel. The separation panel shows:
  - No separation requested: button to initiate separation
  - Processing: progress bar with refresh button
  - Finished: available stems with provider/task info
  - Failed: error message with retry button
  Uses `useSeparationStatus` hook for lifecycle management and polling.
  Clicking Play dispatches `PLAYER_LOAD_SONG` action to load the song into
  the global player. The "Now Playing" card shows a visual indicator and is
  pinned to the top of the list.

- **Global State** — `currentSongId` and `playbackStatus` tracked in the
     app-wide state managed by `GlobalStateProvider`. Audio events update the
     state, which triggers re-renders of the player UI. The `songs` array includes
     `separatedSongInfo` (provider data plus processed stem URLs with expiry
     metadata) which is updated in real-time via Firestore listener.

- **Separation Polling (`useSeparationStatus` hook)** — Manages the separation
  lifecycle for a song: submission via `separationsApi.requestSeparation()` (which
  gets a signed audio URL from Storage, sends it to the backend proxy, and writes
  provider data to Firestore), polling via `separationsApi.refreshSeparationStatus()`
  every 5 seconds while in-progress (writing updated status to Firestore), and
  error handling. Automatically sets up/tears down the polling interval based on
  task status.

### Benefits

- **Modular Engine Design** — Separation of concerns between UI (`GlobalPlayerInner`)
  and audio logic (`RawPlayerEngine`, `SeparatedPlayerEngine`). Each engine is
  independently testable and can be swapped/extended without affecting the other.

- **Unified State Contract** — `PlayerState` provides a single, well-documented
  interface for intent (what the user wants) and reality (what the browser is doing).
  Eliminates scattered state variables and makes the component's behavior predictable.

- **Headless Engines** — Engines return `null` and communicate only via callbacks;
  no DOM rendering logic in engines. Simplifies testing and allows flexible UI rendering.

- **Continuous Drift Correction (separated mode)** — `requestAnimationFrame` loop
  with playback-rate micro-adjustments handles accumulated browser timing jitter
  without disrupting user experience. Sub-0.03s drift is corrected automatically;
  larger drifts are corrected via fast-seeking.

- **Fast Mode Switching** — Both engines stay mounted; switching mode is a pure
  `active` prop toggle. No element destruction/recreation; playback resumes instantly
  from current position on the new mode's audio source.

- **Per-Stem Volume Mixing** — Square-root normalization ensures balanced loudness
  when mixing multiple stems without clipping. Solves the "too loud when all stems
  are unmuted" problem.

- **Resilient Tab Visibility Recovery** — Detects and recovers from browser-imposed
  pauses when the tab is hidden. Stems are re-aligned on visibility change if drift > 0.03s.

- **Robust Error Handling** — Distinct error messages for raw audio load failures
  vs. individual stem load failures, with proper i18n support.

- **Persistent Controls** — Player always visible while song is loaded. Controls
  gracefully disable during loading/buffering to prevent undefined behavior.

- **Single Source of Truth** — Unified player state and centralized engine logic;
  no duplicate state or conflicting intentions.

## Styling

The frontend uses a **Tailwind + MUI hybrid** strategy:

- **MUI** for interactive UI components (TextField, Button, Dialog, Card,
  Snackbar/Alert, layout primitives).
- **Tailwind CSS v4** for page-level layout utilities and decorative styling.

Tailwind v4 has no `tailwind.config.ts` — all Tailwind configuration,
including the `@theme` block and custom design tokens, lives in
[`app/globals.css`](app/globals.css).

### Design Token Palette

Two token families are registered and available as Tailwind utility classes
(`bg-brand-*`, `text-accent-*`, `border-brand-*`, etc.):

| Family | Range | Purpose |
|---|---|---|
| `brand` | 950 → 50 | Purple spectrum — page backgrounds, card surfaces, borders, muted text |
| `accent` | 700 → 100 | Electric indigo/blue — CTAs, focus rings, interactive highlights |

## Testing Strategy

| Layer | Tooling |
|---|---|
| Unit (components, hooks, utils) | Jest + React Testing Library |
| Integration (API client) | Jest + MSW (Mock Service Worker) |
| E2E (planned) | Playwright |

Test files live co-located with the source in `__tests__/` subfolders or as
`*.spec.tsx` siblings.
