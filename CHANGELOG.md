# Changelog

All notable changes to the SingLab Frontend will be documented in this file.

## [Unreleased]

### Added
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
- `components/features/SongPlayer` — inline `<audio controls>` player for a
  single song. Delegates signed URL management to `useSongRawUrl`; shows a
  spinner while refreshing and an error message on failure.
- Dashboard: each song card now renders an inline `SongPlayer` for direct
  playback without leaving the page.

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
