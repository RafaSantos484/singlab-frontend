---
applyTo: "**"
---
# GitHub Copilot Instructions

## 🔥 Critical Rules (MUST ALWAYS FOLLOW)

1. **TypeScript strict mode** — Always enabled, never use `any`
2. **Functional components only** — No class components
3. **English only** — All code, comments, docs, commits must be in English
4. **No commit scopes** — Use `feat:`, `fix:`, `chore:` only (no parentheses)
5. **Explicit commit control** — Only commit when explicitly instructed in current message
6. **Return types** — Always specify return types on exported functions and hooks
7. **Environment variables** — Use `NEXT_PUBLIC_` prefix for client-side vars; never access `process.env` directly — use a typed `env.ts` helper
8. **Atomic commits** — Prefer multiple small commits over single large commits
9. **Documentation sync** — Update related docs when modifying code

## Project Context

**SingLab Frontend**: Next.js + React + TypeScript frontend for a karaoke and
singing practice app. The corresponding backend is `singlab-api` (NestJS +
Firebase Functions).

**Stack**: Next.js 16, React 19, TypeScript 5, Tailwind CSS 4, Jest + React
Testing Library, Firebase Auth (client SDK), ESLint + Prettier

**Key Concepts**:
- Users upload audio (file or URL) → backend processes it asynchronously
- Frontend polls job status until AI processing completes
- Three tracks become available: original, vocal-only, instrumental
- Karaoke player lets users practice singing over the instrumental

**Key Paths**:
- Pages/layouts: `app/` (Next.js App Router)
- Reusable components: `components/`
- Shared utils, API client, hooks: `lib/`
- Tests: co-located `__tests__/` folders or `*.spec.tsx` siblings

**Related Repo**: `singlab-api` — NestJS backend; authentication uses Firebase
ID tokens passed as `Authorization: Bearer <token>` headers.

## Code Style Rules

### TypeScript
- Strict mode always enabled
- Explicit types, never `any`
- Use interfaces for props and public APIs
- Use enums for fixed value sets
- Leverage generics for type-safe reusable utilities

### React / Next.js Patterns
- Functional components with typed props interface
- Prefer Server Components; add `'use client'` only when needed
  (event handlers, hooks, browser APIs)
- Co-locate component tests in `__tests__/` subfolder
- Extract reusable logic into custom hooks (`lib/hooks/`)
- Keep components small and single-responsibility

### Naming Conventions
- Components: `PascalCase.tsx`
- Hooks: `use*.ts` (e.g., `useJobStatus.ts`)
- Utilities: `camelCase.ts`
- Tests: `ComponentName.spec.tsx` or `__tests__/ComponentName.test.tsx`
- Route segments: `kebab-case/` (Next.js convention)

### Formatting (Prettier + ESLint)
- Line width: 80 chars
- Indentation: 2 spaces
- Single quotes
- Semicolons required
- Trailing commas: ES5 style

### Documentation
- JSDoc for exported functions, hooks, and complex utilities
- Document props interfaces with comments
- Keep comments concise and in English

### Language Policy
- **All code, comments, docs, and commits MUST be in English**
- Exception: Only if explicitly requested in current message

## UI & Design System

### Color Palette
- **Always** use the project's design tokens — never raw Tailwind colors (e.g.
  `purple-500`, `indigo-600`) or arbitrary hex values
- `brand-*` scale — primary purple spectrum (backgrounds, borders, text)
- `accent-*` scale — electric indigo/blue (CTAs, highlights, focus rings)
- Semantic aliases defined in `globals.css` (use when appropriate):
  - `bg-surface` / `bg-surface-raised` for card/panel backgrounds
  - `border-border` / `border-border-subtle` for dividers and outlines

### Background & Surface Hierarchy
- Page background: `bg-brand-950`
- Card/panel: `bg-brand-900` or `bg-brand-900/75` (with backdrop blur)
- Elevated surface: `bg-brand-800`
- Borders: `border-brand-500/40` (subtle) → `border-brand-300` (focused)

### Text & Contrast
- Body text on dark bg: `text-brand-100` or `text-white`
- Secondary/muted text: minimum `text-brand-100/70` — avoid going below `/50`
  as it fails readability on dark surfaces
- Decorative/disabled text allowed as low as `/40`
- Headings: prefer `bg-gradient-to-r … bg-clip-text text-transparent` for
  brand gradient treatment

### Interactive Elements (Buttons & Links)
- All clickable elements must have `cursor-pointer`
- Disabled states: `disabled:cursor-not-allowed disabled:opacity-50`
- Always provide focus-visible styles:
  `focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300/60`
- Hover states should have a visible, non-jarring color shift (e.g. +1 shade
  on gradient stops, or subtle bg tint)

### Accessibility
- Decorative SVGs must have `aria-hidden="true"`
- Interactive elements must have accessible labels (`aria-label` or visible
  text)
- Error messages should use `role="alert"`
- Maintain WCAG AA contrast ratio (≥ 4.5:1) for body text on backgrounds

## Responsive Design & Device Compatibility

### Mobile-First Approach
- **Always design mobile-first** — start with mobile layouts and progressively
  enhance for larger screens
- Use Tailwind's responsive prefixes (`sm:`, `md:`, `lg:`, `xl:`, `2xl:`) to
  adapt layouts across breakpoints
- Test on actual devices or emulators, not just browser resize tools

### Tailwind Breakpoints
- `sm` — 640px (landscape phones)
- `md` — 768px (tablets)
- `lg` — 1024px (desktop)
- `xl` — 1280px (large desktop)
- `2xl` — 1536px (ultra-wide)

### Key Practices
- **Typography scaling** — Use smaller text on mobile (`text-sm`, `text-base`),
  increase on tablets/desktop (`md:text-lg`, `lg:text-xl`)
- **Spacing & padding** — Apply smaller gaps on mobile (`px-4`, `py-3`),
  expand on larger screens (`md:px-6`, `lg:px-8`)
- **Grid & flexbox layouts** — Use single column on mobile, multi-column on
  larger screens (e.g., `grid-cols-1 md:grid-cols-2 lg:grid-cols-3`)
- **Images & media** — Always use `max-w-full` or responsive sizing to prevent
  overflow; include `width` and `height` attributes for Next.js `<Image>`
- **Touch targets** — Minimum 44px × 44px touch area on mobile for buttons and
  interactive elements
- **Viewport meta** — Already configured in layout; ensure no manual viewport
  overrides in components
- **Test landscape mode** — Verify layouts work correctly in both portrait and
  landscape orientations on phones/tablets
- **Font scaling** — Avoid fixed font sizes (px); use relative units that
  scale with responsive prefixes

### Common Patterns
```tsx
/* Single column on mobile, two columns on tablet+ */
<div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
  <Card />
  <Card />
</div>

/* Responsive padding & text size */
<h1 className="text-2xl md:text-3xl lg:text-4xl px-4 md:px-6 py-4 md:py-6">
  Title
</h1>

/* Hide/show content conditionally */
<div className="hidden md:block">
  {/* Only visible on tablet+ */}
</div>
```

## Development Guidelines

### Environment Configuration
- Client-side env vars must be prefixed with `NEXT_PUBLIC_`
- Create a typed `lib/env.ts` module that validates and exports env vars
- Development: `.env.local` (not committed)
- Production: set vars via Vercel dashboard or CI secrets
- Never hard-code credentials or secrets

### Firebase Authentication
- Initialize Firebase client once in `lib/firebase/app.ts` (singleton)
- Auth context provides `currentUser` and `idToken` across the app
- Pass `idToken` as `Authorization: Bearer <token>` to `singlab-api`

### API Client
- Centralize all API calls in `lib/api/`
- Use typed response interfaces matching `singlab-api` DTOs
- Handle loading, error, and success states explicitly

### State Management
- Prefer React built-ins (useState, useContext, useReducer)
- Use a data-fetching library (React Query / SWR) for server state

## Testing Patterns

### Unit Tests (`.spec.tsx` / `.test.tsx`)
- Test single component or function in isolation
- Mock external dependencies (API calls, Firebase, router)
- Use Jest + React Testing Library

### Test Structure Template
```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MyComponent } from '../MyComponent';

describe('MyComponent', () => {
  it('renders correctly', () => {
    render(<MyComponent label="Test" />);
    expect(screen.getByText('Test')).toBeInTheDocument();
  });

  it('calls onClick when button is clicked', async () => {
    const user = userEvent.setup();
    const handleClick = jest.fn();
    render(<MyComponent label="Test" onClick={handleClick} />);
    await user.click(screen.getByRole('button'));
    expect(handleClick).toHaveBeenCalledTimes(1);
  });
});
```

### Running Tests
- `npm test` — Run all tests
- `npm run test:watch` — Watch mode
- `npm run test:coverage` — Coverage report

## Git Workflow & Commits

### ⚠️ Critical: When to Commit

**Only commit if the current chat message explicitly instructs you to do so.**
Previous messages asking to commit do NOT apply to the current message.

### Analyzing Changes Before Committing

Always review changes before committing:

```bash
git status
git diff
git diff --staged
```

### Commit Strategy

Prefer smaller, atomic commits. Each commit = one logical unit of work.

**Example strategy** for a new feature:
```bash
git add lib/api/songs.ts
git commit -m "feat: add typed songs API client"

git add components/features/SongCard.tsx
git commit -m "feat: add SongCard component"

git add __tests__/SongCard.spec.tsx
git commit -m "test: add SongCard unit tests"

git add docs/
git commit -m "docs: document SongCard props"
```

### Pull Request Guidelines
- Target `develop` for features, `master`/`main` for hotfixes
- PR title must follow Conventional Commits format
- Reference issues when applicable (`Closes #42`)
