# SingLab Frontend

SingLab is a web application focused on karaoke and singing practice. This
repository contains the frontend, built with Next.js, React, and TypeScript.

The app allows users to submit audio (uploaded files or approved links), track
the AI processing pipeline (vocal separation + lyrics transcription), and play
back the original, vocal-only, and instrumental tracks for karaoke practice.

## Features

- Next.js 16 with App Router and TypeScript
- Firebase Authentication for user sign-in
- Song submission (file upload or approved link)
- Async job tracking for AI processing pipeline
- Karaoke playback with vocal / instrumental stem toggle
- Event-driven audio player state synchronization (responds to media keys)
- Song deletion with confirmation dialog
- Lyrics display synchronized with playback (planned)
- Material UI (MUI) for component primitives (forms, dialogs, cards, alerts)
- Tailwind CSS for page-level layout utilities and decorative styling
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
.
├── app/                    # Next.js App Router pages and layouts
│   ├── layout.tsx
│   ├── page.tsx
│   ├── login/
│   ├── register/
│   └── dashboard/
├── components/             # Reusable UI components
│   ├── layout/             # Shared route layouts (auth, dashboard)
│   ├── ui/                 # Visual primitives/brand decorations
│   └── features/           # Feature-specific components (player, dialogs)
├── lib/                    # Shared utilities, hooks, API clients
│   ├── api/                # API client for singlab-api
│   │   └── song-creation.ts # Song upload validation/service layer
│   ├── firebase/           # Firebase client initialization
│   ├── theme/              # Central MUI theme configuration
│   ├── validation/         # Zod validation schemas (sign-in, user creation)
│   └── hooks/              # Custom React hooks
├── public/                 # Static assets
├── .env.local              # Local environment variables (not committed)
├── .env.local.example      # Template for local env vars
├── .env.production.example # Template for production env vars
├── jest.config.ts
├── jest.setup.ts
├── next.config.ts
└── tsconfig.json
```

## Processing Pipeline (Backend)

The frontend drives the following pipeline orchestrated by `singlab-api`:

1. User submits audio (file upload or approved link).
2. API normalizes audio with FFmpeg.
3. AI service separates vocals from instrumental.
4. AI service transcribes lyrics from the vocal stem.
5. Three tracks are stored: original, vocal-only, instrumental.
6. Frontend polls job status and unlocks playback on completion.

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
