# SingLab Frontend

SingLab is a web application focused on karaoke and singing practice. This
repository contains the frontend, built with Next.js, React, and TypeScript.

The app allows users to submit audio (uploaded files or approved links), request
stem separation (AI or manual upload), and play back the original, vocal-only, and
instrumental tracks for karaoke practice. The frontend is **fully responsible
for all Firebase data and file operations** — the backend acts only as a
stateless proxy between the frontend and external AI services.

## Features

- Next.js 16 with App Router and TypeScript
- Firebase Authentication for user sign-in
- **Client-side audio upload** with three-step flow:
  - Audio format validation (MIME type + extension fallback)
  - Client-side FFmpeg WASM MP3 conversion with progress tracking (supports MP3, WAV, OGG, WebM, MP4, MOV, FLAC, AAC, M4A)
  - Upload converted MP3 to Firebase Storage (bypassing API)
  - Save song metadata directly to Firestore
  - Automatic rollback on failure (orphaned files cleaned up)
- **Drag-and-drop file upload** — Intuitive drag-and-drop UI in song upload dialog
- **Automatic metadata extraction** from audio files
  - Detects title and artist from ID3/audio tags
  - Auto-fills form fields (user can override)
- **Pending activity tracking** — Prevents accidental navigation during uploads/conversions
- **Dual-provider stem separation workflow**:
  - Select provider in separation dialog (`poyo` AI proxy or `local` manual upload)
  - `poyo`: request via backend proxy, poll status, auto-process provider stems
  - `local`: upload stems directly from client and persist stem paths to Firestore
  - Delete existing stems and re-request separation from another provider
- Karaoke playback with vocal / instrumental stem toggle
- Event-driven audio player state synchronization (responds to media keys)
- Song deletion with confirmation dialog
- Lyrics display synchronized with playback (planned)
- Material UI (MUI) for component primitives (forms, dialogs, cards, alerts)
- Tailwind CSS for page-level layout utilities and decorative styling
- Internationalization (i18n) support with `next-intl` (English, Portuguese)
- Jest + React Testing Library for unit tests

## Related Repositories

| Repository | Description |
|---|---|
| [`singlab-api`](https://github.com/your-org/singlab-api) | NestJS + Firebase Functions backend |

## Prerequisites

- Node.js 18+
- npm
- Firebase project (same project used by `singlab-api`)

## Quick Start

See [QUICKSTART.md](QUICKSTART.md) for step-by-step setup instructions.

```bash
cp .env.local.example .env.local
# fill in environment variables
npm install
npm run dev
```

Local app: http://localhost:3000

## Scripts

### Development

```bash
npm run dev         # Start development server
npm run build       # Production build
npm run start       # Start production server
```

### Testing

```bash
npm test                # Run all tests
npm run test:watch      # Watch mode
npm run test:coverage   # Coverage report
```

### Code Quality

```bash
npm run lint            # ESLint
npm run format          # Prettier
npm run type-check      # TypeScript check (no emit)
```

## Project Structure

```
.├── app/                    # Next.js App Router pages and layouts
│   ├── layout.tsx
│   ├── page.tsx
│   ├── [locale]/           # Internationalized routes (en-US, pt-BR)
│   │   ├── login/
│   │   ├── register/
│   │   └── dashboard/
├── components/             # Reusable UI components
│   ├── layout/             # Shared route layouts (auth, dashboard)
│   ├── ui/                 # Visual primitives/brand decorations
│   └── features/           # Feature-specific components (player, dialogs)
├── lib/                    # Shared utilities, hooks, API clients
│   ├── api/                # API client for backend separation proxy only
│   │   ├── song-creation.ts # Two-step upload: Storage → Firestore save
│   │   ├── separations.ts   # Stem separation proxy client (submit, status)
│   │   └── ...
│   ├── async/              # Pending activity tracker (navigation guards)
│   ├── firebase/           # Firebase client (Auth, Firestore CRUD, Storage)
│   ├── hooks/              # Custom React hooks (auth, separation, stem processing)
│   ├── i18n/               # Internationalization routing and utilities
│   ├── separations/        # Provider adapters for separation normalization
│   ├── storage/            # Firebase Storage upload utilities (raw + stems)
│   ├── store/              # Global state (Context + useReducer)
│   ├── theme/              # Central MUI theme configuration
│   └── validation/         # Zod validation schemas (sign-in, user creation)
├── messages/               # i18n translation files (en-US.json, pt-BR.json)
├── public/                 # Static assets
├── .env.local              # Local environment variables (not committed)
├── .env.local.example      # Template for local env vars
├── .env.production.example # Template for production env vars
├── jest.config.ts
├── jest.setup.ts
├── next.config.ts
└── tsconfig.json
```

## Upload & Processing Pipeline

The frontend drives a two-phase song upload and stem processing pipeline:

### 1. Song Upload (Validation → Conversion → Storage → Firestore)

1. User selects audio file via file picker or drag-and-drop in `SongCreateDialog`.
2. Client validates file (size, format via MIME type + extension fallback).
3. Client extracts metadata (title, artist) from audio tags if available.
4. **Client converts audio/video to MP3 using FFmpeg WASM** (fast path if already MP3).
5. **Client uploads converted MP3 to Firebase Storage** at `users/:userId/songs/:songId/raw.mp3`.
6. **Client writes song document directly to Firestore** via `createSongDoc()`.
7. Real-time Firestore listener adds song to global state.
8. **Rollback:** If Firestore write fails after Storage upload, client deletes the uploaded file.

### 2. Stem Separation (Provider-based)

1. User opens `SeparationDialog` from dashboard card or global player.
2. User selects one provider:
  - `poyo` (backend-proxied AI separation)
  - `local` (manual stem upload)

#### `poyo` path

1. Frontend gets signed raw audio URL from Storage and calls `POST /separations/submit`.
2. Backend proxy forwards to PoYo and returns provider task payload.
3. **Frontend writes provider data to Firestore** via `updateSeparatedSongInfo()`.
4. `useSeparationStatus` polls `GET /separations/status?taskId=xxx` every 60s.
5. On `finished` with no stored stems, `useStemAutoProcessor` downloads and uploads stems.
6. **Frontend writes stem paths to Firestore** and UI updates through Firestore listener.

#### `local` path

1. User uploads at least 2 stems (vocals required) via `StemUploadForm`.
2. Client converts each file to MP3 when needed.
3. Client uploads stems to Storage and writes `provider: 'local'` + stem paths to Firestore.
4. Stems become immediately available in `GlobalPlayer` (no polling required).

#### Re-processing

1. User can delete existing stems from dashboard card.
2. Client deletes stem files in Storage and resets `separatedSongInfo` to `null`.
3. User can request a new separation using either provider.

## Environment Variables

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_API_URL` | Base URL of the `singlab-api` backend |
| `NEXT_PUBLIC_FIREBASE_API_KEY` | Firebase client API key |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | Firebase auth domain |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | Firebase project ID |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | Firebase storage bucket |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | Firebase messaging sender ID |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | Firebase app ID |

## License

MIT
