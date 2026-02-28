# Changelog

All notable changes to the SingLab Frontend will be documented in this file.

## [Unreleased]

### Changed
- **Refactored to single global player architecture**: Replaced per-card audio
  players with a unified `GlobalPlayer` component at the bottom of the dashboard.
  Song cards now dispatch actions to load songs into the global player instead of
  embedding individual audio elements. The currently playing song is pinned to
  the top of the list with a "Now Playing" indicator and remains visible
  regardless of filters or sorting.
- Updated global state to include `currentSongId` and `playbackStatus` for
  centralized playback control.

### Removed
- **Legacy per-card player components**: `SongPlayer` and `CustomAudioPlayer`
  components removed in favor of the single global player.
- **AudioManager singleton**: No longer needed with single audio element approach.
- **useAudioState hook**: Replaced with simpler event listeners in `GlobalPlayer`.

### Added

#### Stem Separation Feature
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
