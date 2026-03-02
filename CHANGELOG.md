# Changelog

All notable changes to the SingLab Frontend will be documented in this file.

## [Unreleased]

### Changed
- **Deterministic multi-track synchronization in GlobalPlayer**: Replaced
  arbitrary fixed delays with event-driven synchronization. `prepareAt` now
  seeks all tracks to the exact same `currentTime` (avoiding `fastSeek` whose
  keyframe snapping varies per file), calls `syncAudioTracks()` to correct
  sub-frame browser clamping, then waits for every track to report
  `readyState ≥ HAVE_FUTURE_DATA` via `'canplay'` events (5 s timeout safety
  net) before starting simultaneous playback.
- **`isSyncing` gate for controls UX**: All transport controls (play, stop, seek
  slider, source toggle, stem presets) are disabled and a spinner is shown while
  any synchronization operation is in progress (`isSyncing === true`), preventing
  conflicting user interactions during initialization, seek, and resume.
- **Seek-scrub split**: The seek slider now uses `onChange` to update only the
  displayed time (audio is silently paused while dragging) and `onChangeCommitted`
  to trigger the full sync at the committed position, avoiding unnecessary buffer
  fetches on every pixel of slider movement.
- **Buffering stall recovery**: `'waiting'`/`'stalled'` events on the master
  track now pause all non-master tracks immediately to prevent drift. The
  master's `'playing'` event re-syncs and restarts them automatically.
- **Source-exclusive track management**: The `tracks` memo now builds elements
  exclusively for the current playback source (raw OR separated, never both).
  Switching sources disposes all current audio elements and builds fresh ones
  for the new source, restarting playback from position 0. This eliminates
  cross-source drift and simplifies the audio graph.
- **Refactored to single global player architecture**: Replaced per-card audio
  players with a unified `GlobalPlayer` component at the bottom of the dashboard.

### Removed
- **Legacy per-card player components**: `SongPlayer` and `CustomAudioPlayer`
  components removed in favor of the single global player.
- **AudioManager singleton**: No longer needed with single audio element approach.
- **useAudioState hook**: Replaced with simpler event listeners in `GlobalPlayer`.
- **Separation progress field**: Removed `progress` from `NormalizedSeparationInfo`,
  `PoyoSeparationTaskDetails`, and related types. The PoYo provider does not reliably
  report incremental progress, so the field was removed from the API types and
  adapter interface. The UI now shows a generic "Separating audio…" message without
  percentage values.

### Added
- **Client-side MP3 conversion** (`lib/audio/convertToMp3.ts`) — FFmpeg WASM
  integration for converting any audio/video format to MP3 in the browser. Loaded
  lazily from CDN (single-threaded, no COOP/COEP headers required). Supports:
  MP3, WAV, OGG, WebM, MP4, MOV, FLAC, AAC, M4A. Includes fast path to skip
  re-encoding if input is already MP3. Progress callback for UI updates.
- **Drag-and-drop file upload UI** — `SongCreateDialog` now supports both file
  picker and drag-and-drop interaction for uploading audio files. Visual feedback
  while dragging and helpful hint text for discoverability.
- **Extended audio format support** — File validation improved with MIME type
  checks plus extension-based fallback for cases where MIME type is absent or
  generic (e.g., `.m4a` files). Supports all audio formats FFmpeg can processes.
- **Request timeout handling** — `ApiClient` now enforces a 30-second timeout
  per request. Aborts stalled requests and throws a `408` error code for proper
  error handling in UI (avoids indefinite hangs).
- **API request logging** — `ApiClient` logs outgoing requests (method, path,
  forceRefresh flag) to console for debugging and monitoring.
- **Three-phase upload workflow** — Song creation now shows granular progress:
  converting MP3 → uploading file → registering with API. `SongCreationPhase`
  type updated to include `'converting'` phase.
- **i18n support for new features** — Added translation keys for drag-and-drop
  hints, conversion progress display, format support, and error messages in both
  English and Portuguese.
- **Stem separation API client** (`lib/api/separations.ts`) — Typed API wrapper
  for separation operations (`requestSeparation`, `refreshSeparationStatus`).
- **`useSeparationStatus` hook** — Manages the complete separation lifecycle:
  submission, automatic polling (5s intervals), status normalization, and error
  handling. Integrates with Firestore real-time updates for separation status.
- **Separation adapter pattern** (`lib/separations/`) — Provider-agnostic
  normalization layer for separation task data. Includes `PoyoSeparationAdapter`
  for normalizing PoYo provider responses into a unified schema. Extensible for
  additional providers.
- **`SongCardItem` component** — Extracted song card UI with separation status
  panel showing: request button (not started), progress bar with refresh (processing),
  available stems (finished), or error message with retry (failed).
- **GlobalPlayer separation support** — Player now supports both raw and separated
  audio playback:
  - Playback source toggle (Raw vs. Separated)
  - Multiple synced `<audio>` elements for separated stems
  - Stem selection UI with toggleable chips
  - Preset mixes: Instrumental (all stems except vocals), Vocals only, All stems
  - Synchronized playhead and volume control across all stems
- **Song type updates** — Added `separatedSongInfo` field to `Song` type to store
  provider-specific separation task data. Updated Firestore synchronization to
  include separation status in real-time listener.

#### Other Additions
- **GlobalPlayer component** (`components/features/GlobalPlayer.tsx`) — Single
  persistent audio player with play/pause/stop controls, progress bar with seek,
  volume control, and responsive design. Displays currently playing song metadata.
- **Player actions in global state**: `PLAYER_LOAD_SONG`, `PLAYER_SET_STATUS`,
  and `PLAYER_STOP` actions for controlling global playback.
- **useGlobalStateDispatch hook** — Allows components to dispatch actions to
  global state.
- **"Now Playing" indicator** — Song cards show a visual badge when playing and
  are pinned to the top of the filtered list.
- **SongDeleteButton component** — Reusable button for deleting songs with
  confirmation dialog, loading state, and comprehensive error handling (401, 403,
  404, network failures). Includes full accessibility features.
- Added `@mui/lab` dependency for additional Material-UI components.
- Design token palette (`brand-*`, `accent-*`) defined via Tailwind v4 `@theme`
  block in `app/globals.css`, replacing the former neutral `zinc` colors. Tokens
  are available as utility classes project-wide.
- Login page refactored with a purple/blue futuristic theme matching the app
  brand: ambient glows, glassmorphism card, gradient CTA button, inline SVG
  logo, waveform and spectrum decorations.
- Login page: added **"Forgot password?"** and **"Create new account"** mock
  buttons (UI only; respective flows not yet implemented).
- `lib/hooks/useSongRawUrl` — custom hook that checks `rawSongInfo.urlInfo.expiresAt`
  and proactively refreshes the signed URL via `GET /songs/:songId/raw/url` when
  within 5 minutes of expiry. Caches the refreshed URL locally for immediate
  playback; subsequent Firestore-pushed updates are picked up automatically.
- Dashboard: Play buttons on song cards trigger global player playback.
- Dashboard: each song card now includes a delete button for removing songs.

## [0.1.0] - 2026-02-27

### Added
- Next.js 16 project scaffold with App Router, TypeScript, and Tailwind CSS.
- Jest + React Testing Library testing setup.
- ESLint and Prettier configuration.
- GitHub Actions for CI and branch enforcement.
- Environment variable templates (`.env.local.example`, `.env.production.example`).
- Project documentation: `README.md`, `ARCHITECTURE.md`, `CONTRIBUTING.md`,
  `QUICKSTART.md`, `CHANGELOG.md`.
- Copilot instructions for consistent AI-assisted development.

## Changelog Guidelines

### Versioning
This project follows [Semantic Versioning](https://semver.org/).

### Changelog Format
- **Added**: New features
- **Changed**: Changes in existing functionality
- **Deprecated**: Soon-to-be removed features
- **Removed**: Removed features
- **Fixed**: Bug fixes
- **Security**: Security fixes
