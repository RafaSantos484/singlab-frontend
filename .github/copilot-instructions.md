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
6. **Return types** — Always specify return types on all functions and hooks
7. **Environment variables** — Use `NEXT_PUBLIC_` prefix for client-side vars; never access `process.env` directly — use a typed `env.ts` helper
8. **Atomic commits** — Prefer multiple small commits over single large commits
9. **Documentation sync** — Update related docs when modifying code
10. **MUI-first for components** — Prefer Material-UI components over custom HTML elements
11. **Tailwind + MUI hybrid** — Use Tailwind for page layouts, MUI for UI components (forms, buttons, dialogs, cards, etc.)
12. **No agent logs in markdown** — Do NOT create `.md` files containing logs, summaries, or outputs from tools/agents. Markdown files are for actual project documentation only
13. **i18n mandatory** — Every new feature, component, screen, or feedback must use the i18n system (`next-intl`). Never write literal user-visible text directly in UI — all strings must live in `messages/en-US.json` and `messages/pt-BR.json`

## Project Context

**SingLab Frontend**: Next.js + React + TypeScript frontend for a karaoke and
singing practice app. The corresponding backend is `singlab-api` (NestJS +
Firebase Functions).

**Stack**: Next.js 16, React 19, TypeScript 5, Tailwind CSS 4, Jest + React
Testing Library, Firebase Auth + Firestore + Storage (client SDK), ESLint +
Pretters, **next-intl 4** (i18n)

**Key Concepts**:
- Users upload audio (file or URL) → frontend saves to Storage + Firestore
- Frontend requests stem separation via backend proxy (stateless gateway to PoYo AI)
- Frontend polls separation status and writes results to Firestore
- Three tracks become available: original, vocal-only, instrumental
- Karaoke player lets users practice singing over the instrumental
- **Frontend is fully responsible for all Firebase data and file operations**
- Backend only proxies external AI service requests (no Firestore/Storage access)

**Key Paths**:
- Pages/layouts: `app/` (Next.js App Router)
- Reusable components: `components/`
- Shared utils, API client, hooks: `lib/`
- Tests: co-located `__tests__/` folders or `*.spec.tsx` siblings

**Related Repo**: `singlab-api` — NestJS backend acting as a **stateless
gateway** to external AI services. Only two routes: `POST /separations/submit`
and `GET /separations/status`. Authentication uses Firebase ID tokens passed as
`Authorization: Bearer <token>` headers.

## Code Style Rules

## Internationalization (i18n)

This project uses **next-intl v4** for internationalization. Supported locales:
`en-US` (default) and `pt-BR`. URL-segment based routing (`/en-US/dashboard`).

### Mandatory Rules

- **No literal UI strings** — every user-visible text must come from a
  translation key. This includes labels, placeholders, tooltips, error
  messages, ARIA labels, button text, and helper text.
- **Both locales required** — every new key added to `messages/en-US.json`
  must also be added to `messages/pt-BR.json` with a proper translation.
- **Namespace by feature** — add new keys under the appropriate namespace
  (e.g., `SongCreate`, `Dashboard`, `Player`). Create a new namespace for
  entirely new features.
- **Never use hardcoded strings as fallbacks** — if a key is missing, fix the
  translation files; never write `|| 'Fallback text'` in UI.

### Key Architecture

| File | Purpose |
|------|---------|
| `lib/i18n/routing.ts` | Locales and default locale |
| `lib/i18n/navigation.ts` | Locale-aware `Link`, `useRouter`, `usePathname` |
| `lib/i18n/request.ts` | Server-side message loading |
| `lib/i18n/types.d.ts` | TypeScript types for translation keys |
| `messages/en-US.json` | English translations |
| `messages/pt-BR.json` | Brazilian Portuguese translations |

### Usage Pattern

```tsx
// In a client component:
import { useTranslations } from 'next-intl';

export function MyComponent(): React.ReactElement {
  const t = useTranslations('MyNamespace');
  return <Button>{t('submitButton')}</Button>;
}

// In a server component:
import { getTranslations } from 'next-intl/server';

export async function MyPage() {
  const t = await getTranslations('MyNamespace');
  return <h1>{t('pageTitle')}</h1>;
}
```

### Translating Validation Errors (Zod + next-intl)

Zod schemas return **i18n keys** as error messages (relative to the
`Validation` namespace). Components translate them using:

```tsx
const tV = useTranslations('Validation');
// ...
helperText={fieldErrors.email
  ? tV(fieldErrors.email as Parameters<typeof tV>[0])
  : undefined
}
```

### Navigation

Always use locale-aware navigation from `@/lib/i18n/navigation` — never from
`next/navigation` or `next/link` directly:

```tsx
import { Link, useRouter, usePathname } from '@/lib/i18n/navigation';
```

---

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

### Tailwind + MUI Hybrid Approach

**Use MUI for:** Form inputs, buttons, dialogs, cards, layouts (Container, Stack, Grid, Box), navigation, notifications, loading states

**Use Tailwind for:** Page-level layouts (`flex`, `grid`, `max-w-`, `px-`, `py-`), responsive spacing (`md:`, `lg:` prefixes), decorative backgrounds

**Never mix:** Don't combine Tailwind classes with MUI component styling. Use `sx` prop for MUI components:
```tsx
// ✅ CORRECT
<Button sx={{ px: 2, py: 1 }}>Click</Button>

// ❌ WRONG
<Button className="px-4 py-2">Click</Button>
```

### Theme & Colors

All colors/spacing come from `lib/theme/muiTheme.ts`:
- **Primary**: `#7c3aed` (brand purple) — use on `variant="contained"` buttons
- **Secondary**: `#818cf8` (accent indigo) — use on `variant="outlined"` buttons
- **Background**: `#0a0520` (brand-950) — use `color="textPrimary"` for text on dark
- **Paper**: `#1e1b4b` (brand-900) — use for cards/dialogs

### Core Components

**TextField** — Always for form inputs, never `<input>`:
```tsx
<TextField
  label="Email"
  type="email"
  error={!!error}
  helperText={error}
  fullWidth
/>
```

**Button** — Use variants explicitly:
```tsx
<Button variant="contained" onClick={submit}>Save</Button>
<Button variant="outlined" onClick={cancel}>Cancel</Button>
```

**Dialog** — For modals:
```tsx
<Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
  <DialogTitle>Title</DialogTitle>
  <DialogContent><Stack spacing={2}>...</Stack></DialogContent>
  <DialogActions><Button onClick={close}>Cancel</Button></DialogActions>
</Dialog>
```

**Stack/Grid** — For layouts:
```tsx
<Stack spacing={2}><TextField /><Button>Submit</Button></Stack>
<Grid container spacing={2}>
  <Grid item xs={12} sm={6} md={4}>Content</Grid>
</Grid>
```

**Card** — For content containers:
```tsx
<Card>
  <CardHeader title="Title" />
  <CardContent>Content</CardContent>
</Card>
```

**Snackbar + Alert** — For notifications (not custom Toast):
```tsx
<Snackbar open={open} onClose={close}>
  <Alert severity="error">{message}</Alert>
</Snackbar>
```

**Typography** — For all text (never raw `<h1>`, `<p>`):
```tsx
<Typography variant="h2">Heading</Typography>
<Typography variant="body1">Body text</Typography>
```

### Responsive Design

**MUI breakpoints** in `sx` prop:
- `xs`: 0px (mobile)
- `md`: 900px (tablet)
- `lg`: 1200px (desktop)

**Patterns:**
```tsx
// Array syntax (mobile, tablet, desktop)
<Box sx={{ p: [2, 3, 4] }}>Content</Box>

// Breakpoint syntax
<Box sx={{
  display: 'grid',
  gridTemplateColumns: '1fr',
  [theme.breakpoints.up('md')]: { gridTemplateColumns: '1fr 1fr' }
}}>Content</Box>
```

**Spacing scale:** `p: 1` = 8px, `p: 2` = 16px, `p: 3` = 24px, `p: 4` = 32px

### Accessibility

- **Use semantic HTML**: `Typography`, `Button`, not custom divs
- **Keyboard navigation**: All interactive elements must be Tab/Enter/Space accessible
- **TextField errors**: Use `error` + `helperText` props (auto-announced)
- **IconButton**: Always include `aria-label`
- **Decorative elements**: Use `aria-hidden="true"`
- **Links**: Use `<a>` or Next.js `Link`, not `<button>`
- **Color contrast**: MUI default theme meets WCAG AA; maintain 4.5:1 ratio for custom colors
- **Touch targets**: Minimum 44px (MUI Button default)

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

### Firebase Data & Storage
- All Firestore CRUD operations are handled directly by the frontend
- Song documents: `lib/firebase/songs.ts` (create, update, delete)
- User documents: `lib/firebase/users.ts` (create user profile)
- Storage uploads: `lib/storage/` (raw audio, separated stems)
- The backend does **not** access Firestore or Cloud Storage

### API Client
- `lib/api/` contains only the separation proxy client (submit, status)
- No song or user API endpoints — those operate directly via Firebase
- Use typed response interfaces matching backend DTOs
- Handle loading, error, and success states explicitly

### State Management
- Prefer React built-ins (useState, useContext, useReducer)
- Use a data-fetching library (React Query / SWR) for server state

## Form & Component Patterns

**Form with validation:**
```tsx
const [email, setEmail] = useState('');
const [error, setError] = useState<string | null>(null);

const handleSubmit = async (e: React.FormEvent) => {
  e.preventDefault();
  if (!email.includes('@')) {
    setError('Invalid email');
    return;
  }
  // API call
};

return (
  <Stack component="form" onSubmit={handleSubmit} spacing={2}>
    {error && <Alert severity="error">{error}</Alert>}
    <TextField
      label="Email"
      value={email}
      onChange={(e) => setEmail(e.target.value)}
      error={!!error}
      helperText={error}
      fullWidth
    />
    <Button type="submit" variant="contained" fullWidth>Submit</Button>
  </Stack>
);
```

**Controlled Dialog:**
```tsx
const [open, setOpen] = useState(false);
const [title, setTitle] = useState('');
const handleSubmit = async () => { /* API call */ setOpen(false); };

return (
  <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
    <DialogTitle>Create</DialogTitle>
    <DialogContent sx={{ pt: 2 }}>
      <TextField autoFocus label="Title" value={title} onChange={(e) => setTitle(e.target.value)} fullWidth />
    </DialogContent>
    <DialogActions>
      <Button onClick={() => setOpen(false)}>Cancel</Button>
      <Button variant="contained" onClick={handleSubmit}>Create</Button>
    </DialogActions>
  </Dialog>
);
```

**File Input (hidden trigger):**
```tsx
const inputRef = useRef<HTMLInputElement>(null);
return (
  <Box>
    <input ref={inputRef} type="file" accept="audio/*" style={{ display: 'none' }} />
    <Button onClick={() => inputRef.current?.click()} fullWidth>Choose File</Button>
  </Box>
);
```

## Testing Patterns

### Unit Tests (`.spec.tsx` / `.test.tsx`)
- Test single component or function in isolation
- Mock external dependencies (API calls, Firebase, router)
- Use Jest + React Testing Library
- For MUI components: Mocks handled in `jest.setup.ts` (ThemeProvider, etc.)

### MUI Component Testing

**MUI components automatically include:**
- Focus management
- Keyboard navigation (Tab, Enter, Space)
- ARIA labels and roles
- Disabled state handling

**Test MUI components like normal React components:**

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { myComponent } from '../myComponent';
import { Button } from '@mui/material';

describe('MyComponent', () => {
  it('renders MUI button', () => {
    render(<Button>Click me</Button>);
    expect(screen.getByRole('button', { name: /click me/i })).toBeInTheDocument();
  });

  it('calls onClick when button is clicked', async () => {
    const user = userEvent.setup();
    const handleClick = jest.fn();
    render(<Button onClick={handleClick}>Click</Button>);
    await user.click(screen.getByRole('button'));
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('shows error state on TextField', () => {
    render(<TextField error helperText="This field is required" />);
    expect(screen.getByText('This field is required')).toBeInTheDocument();
  });

  it('handles Dialog interactions', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Dialog open={false} />);
    
    rerender(<Dialog open={true} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    
    await user.keyboard('{Escape}');
    rerender(<Dialog open={false} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
```

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

### MUI Testing Setup (jest.setup.ts)

Ensure `jest.setup.ts` includes:

```typescript
// Material-UI theme and context mocks
import { createTheme, ThemeProvider } from '@mui/material/styles';
import '@testing-library/jest-dom';

const theme = createTheme({
  palette: {
    primary: { main: '#7c3aed' },
    background: { default: '#0a0520', paper: '#1e1b4b' },
  },
});

// Global wrapper for all tests (if needed):
// jest.mock('@mui/material/styles', () => ({
//   ...jest.requireActual('@mui/material/styles'),
//   ThemeProvider: ({ children }) => children,
// }));
```

### Running Tests
- `npm test` — Run all tests
- `npm run test:watch` — Watch mode
- `npm run test:coverage` — Coverage report

### Accessibility Testing
- Use `screen.getByRole()` instead of `getByTestId()` when possible
- This ensures components are accessible (proper roles, labels, etc.)
- Test keyboard navigation (Tab, Enter, Escape) for dialogs and menus
- Verify error announcements in form fields work correctly

## MUI Quick Reference & Best Practices

### Component Usage At-a-Glance

| Component | Use For | Variant/Key Props |
|-----------|---------|------------------|
| **TextField** | Form inputs, search | `label`, `type`, `error`, `helperText`, `fullWidth` |
| **Button** | Primary actions | `variant="contained"`, `onClick` |
| **Button** | Secondary actions | `variant="outlined"` |
| **LoadingButton** | Async actions | `loading={bool}`, auto-spinner |
| **Dialog** | Modal overlays | `open={bool}`, `onClose` |
| **Card** | Content containers | Single wrapper for related content |
| **Stack** | Spacing layouts | `spacing={2}`, `direction="row"` |
| **Grid** | Responsive layouts | `container`, `item`, `xs={12} sm={6} md={4}` |
| **Box** | Styling wrapper | `sx={{ ... }}` for custom styles |
| **Snackbar** | Notifications | `open`, `autoHideDuration`, `anchorOrigin` |
| **Alert** | Error/success messages | Inside Snackbar, `severity="error"` |
| **Typography** | All text | `variant="h2"`, `variant="body1"`, etc. |
| **CircularProgress** | Loading spinners | Use with `Box` for centering |
| **Skeleton** | Content placeholders | `variant="text"`, `variant="rectangular"` |
| **Avatar** | User avatars | `src={url}`, `alt`, or initials |
| **IconButton** | Icon-only buttons | `aria-label` required, `size="small"` |
| **AppBar** | Top navigation | `position="static"` with Toolbar |
| **Menu** | Dropdown menus | `anchorEl`, `open`, `onClose` |

### Common Patterns Summary

```tsx
// Form with validation
<TextField error={!!error} helperText={error} />

// Async button with spinner
<LoadingButton loading={isLoading} onClick={handleSubmit}>
  Submit
</LoadingButton>

// Dialog with form
<Dialog open={open} onClose={handleClose}>
  <DialogTitle>Title</DialogTitle>
  <DialogContent><Stack spacing={2}>...</Stack></DialogContent>
  <DialogActions><Button /><Button /></DialogActions>
</Dialog>

// Responsive grid
<Grid container spacing={2}>
  <Grid item xs={12} sm={6} md={4}>Content</Grid>
</Grid>

// Notification
<Snackbar open={open} onClose={handleClose}>
  <Alert severity="error">{message}</Alert>
</Snackbar>
```

### Common Pitfalls to Avoid

1. ❌ **Mixing MUI + Tailwind on same component**
   - ✅ Use either `sx` prop (MUI) or className (Tailwind), never both

2. ❌ **Adding Tailwind classes to MUI components**
   - ✅ `<Button sx={{ px: 2, py: 1 }}>` not `<Button className="px-4 py-2">`

3. ❌ **Using HTML input instead of TextField**
   - ✅ Always use `<TextField>` for form fields

4. ❌ **Manual styling instead of spacing system**
   - ✅ Use `spacing={2}` in Stack/Box instead of calculating px values

5. ❌ **Forgetting `aria-label` on IconButton**
   - ✅ `<IconButton aria-label="delete">` — accessibility required

6. ❌ **Using hardcoded colors instead of theme palette**
   - ✅ Use `color="primary"` or `sx={{ color: 'primary.main' }}`

7. ❌ **Forgetting `fullWidth` on modals**
   - ✅ `<Dialog fullWidth maxWidth="sm">` for proper sizing

8. ❌ **Multiple Snackbars stacked visually**
   - ✅ One Snackbar with conditional content is sufficient

## Git Workflow & Commits

### Branch Naming Convention
- `feat/` - New features (e.g., `feat/add-user-auth`)
- `fix/` - Bug fixes (e.g., `fix/cors-headers`)
- `chore/` - Dependencies, maintenance (e.g., `chore/update-next`)
- `refactor/` - Code restructuring (e.g., `refactor/extract-hook`)
- `style/` - Formatting, no logic changes
- `test/` - Test additions/modifications
- `docs/` - Documentation updates
- `ci/` - CI/CD configuration changes
- `hotfix/` - Production emergency fixes

### Conventional Commits Pattern

**IMPORTANT RULE**: Do not use optional scopes between the type and ':'. Use only the commit type.

**Base Format**:
```
type: description

[optional body]

[optional footer]
```

**Commit Types**:
- `feat:` - New feature
- `fix:` - Bug fix
- `docs:` - Documentation changes
- `style:` - Code changes that don't affect logic (formatting, Prettier, ESLint)
- `refactor:` - Code change that neither adds feature nor fixes bug
- `perf:` - Performance improvements
- `test:` - Test additions or modifications
- `chore:` - Dependency, configuration, build changes, etc

**Correct Examples**:
```
feat: add JWT authentication to middleware
fix: correct CORS headers for local development
docs: improve Firebase setup instructions
style: format code with Prettier
refactor: extract validation logic to hook
test: add integration tests for POST /api/users
chore: upgrade Next.js to v16.1.0
perf: optimize image loading with lazy loading
```

**Incorrect Examples** (do not use):
```
❌ feat(auth): add JWT authentication
❌ fix(cors): correct CORS headers
❌ chore(deps): upgrade Next.js
```

### Pre-commit Checklist

Before committing, ensure:
1. ✅ `npm run lint` passes without errors
2. ✅ `npm run format` has been executed
3. ✅ `npm test` passes (or skip specific tests if documented)
4. ✅ TypeScript compiles: `tsc --noEmit`
5. ✅ Reviewed changes with `git diff` or `git diff --staged`
6. ✅ Commit message follows Conventional Commits (no scopes)
7. ✅ Changes are atomic (one topic per commit)
8. ✅ Commit message is clear and descriptive

### ⚠️ Critical: When to Commit

**Only commit if the current chat message explicitly instructs you to do so.**
Previous messages asking to commit do NOT apply to the current message.

### Analyzing Changes Before Committing

Always verify and review the changes before committing:

```bash
# Check status of all modified files
git status

# View detailed differences of unstaged files
git diff

# View differences of staged files (in staging area)
git diff --staged

# Check changes of a specific file
git diff src/components/MyComponent.tsx

# View summary of changes before making multiple commits
git log -1 --name-status
```

### Commit Strategy

**Prefer smaller, atomic commits over single large commits.** Each commit should represent a single logical unit of work that can be reviewed and understood independently.

**Benefits of atomic commits:**
- Easier code review and understanding of changes
- Simpler git history for debugging and bisecting
- Better for reverting specific features without affecting others
- Clearer project history and commit messages

**When to split into multiple commits:**
- Different features or fixes should be separate commits
- Component/utility additions separate from page or feature logic
- Documentation updates separate from code changes
- Test additions can be separate from implementation if large

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

This creates a clean, reviewable history instead of one monolithic commit.

### Formatting for PR Descriptions and Commit Comments

When providing a PR description or commit comments, always output the response
as a Markdown code block.

### Rich PR Formatting Requirement

When asked to generate a PR title/description for the current branch, return a
well-structured Markdown response (inside a code block) that uses formatting to
enhance readability and clarity. Enrich the output using:
- Headings and subheadings (e.g., `#`, `##`, `###`) for sections
- Emphasis for key terms (bold, italics)
- Task lists with checkboxes for tests, verification, or follow-ups
- Short, scannable bullet lists for changes and impacts
- Optional callouts (blockquotes) for important notes or risks

The goal is a polished, review-friendly PR description that highlights scope,
tests, and notable changes without being verbose.

### Analyzing Git Context for PR Descriptions

When generating a PR title/description, analyze git context to ensure accuracy:

```bash
# Get current branch name
git branch --show-current

# View commits on this branch (not on develop)
git log develop..HEAD --oneline

# View full commit details for context
git log develop..HEAD --format="%B"

# Compare changes with develop
git diff develop... --stat
```

**Important**: Use the branch name and commit history as context, not just current
session information. This ensures the PR title/description accurately reflects what
was actually implemented in the branch.

### Pull Request Guidelines
- Target `develop` for features, `master`/`main` for hotfixes
- PR title must follow Conventional Commits format
- Reference issues when applicable (`Closes #42`)
