# SingLab Frontend

SingLab is a web application focused on karaoke and singing practice. This
repository contains the frontend, built with Next.js, React, and TypeScript.

The app allows users to submit audio (uploaded files or approved links), track
the AI processing pipeline (vocal separation + lyrics transcription), and play
back the original, vocal-only, and instrumental tracks for karaoke practice.

## Features

- Next.js 16 with App Router and TypeScript
- Firebase Authentication for user sign-in
- **Client-side audio upload** with two-step flow:
  - Upload raw audio directly to Firebase Storage (bypassing API)
  - Register song metadata via JSON API call
  - Automatic rollback on failure (orphaned files cleaned up)
- **Pending activity tracking** — Prevents accidental navigation during uploads
- Song submission with automatic metadata extraction from audio files
  - Detects title and artist from ID3/audio tags
  - Auto-fills form fields (user can override)
- **Stem separation workflow** with auto-processing:
  - Request separation via API (triggers backend PoYo task)
  - Client auto-detects separation completion via Firestore listener
  - Client downloads stems from provider and uploads to Firebase Storage
  - Backend validates and finalizes stem availability
- Async job tracking for AI processing pipeline (vocal separation, lyrics transcription)
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
│   ├── api/                # API client for singlab-api
│   │   ├── song-creation.ts # Two-step upload: Storage → API registration
│   │   ├── separations.ts   # Stem separation API client
│   │   └── ...
│   ├── async/              # Pending activity tracker (navigation guards)
│   ├── firebase/           # Firebase client initialization
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

### 1. Song Upload (Client → Storage → API)

1. User selects audio file in `SongCreateDialog`.
2. Client validates file (size, format).
3. Client generates stable `songId` (Firestore doc ID).
4. **Client uploads raw audio to Firebase Storage** at `users/:userId/songs/:songId/raw.mp3`.
5. Client registers song metadata with API via `POST /songs` (JSON only).
6. Backend validates that the Storage file exists and creates Firestore document.
7. Real-time Firestore listener adds song to global state.
8. **Rollback:** If API call fails after Storage upload, client deletes the uploaded file.

### 2. Stem Separation & Auto-Processing

1. User clicks "Request Separation" on a song card.
2. Frontend calls `POST /songs/:id/separation`.
3. Backend initiates PoYo separation task and updates Firestore `providerData`.
4. `useSeparationStatus` hook polls task status (Firestore listener propagates changes).
5. When `status=finished` and `stems=null`, **`useStemAutoProcessor` auto-triggers**:
   - Extracts stem URLs from `providerData` (via `PoyoSeparationAdapter`).
   - Downloads each stem from PoYo as Blob.
   - Uploads stems to Firebase Storage at `users/:userId/songs/:songId/stems/:stemName.mp3`.
   - Calls `PUT /songs/:id/separation/stems` to notify backend of storage paths.
6. Backend validates Storage files and updates Firestore with stem paths.
7. **Rollback:** If API call fails, client deletes uploaded stems.
8. Real-time listener updates `song.separatedSongInfo.stems` in global state.
9. Stems become available in `GlobalPlayer`.

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
