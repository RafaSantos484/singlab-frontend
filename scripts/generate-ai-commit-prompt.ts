/**
 * generate-ai-commit-prompt.ts
 *
 * Generates an AI-ready prompt (in English) with enhanced Git workflow & commit rules,
 * and auto-includes repository context (branch, status, staged/unstaged diffs, untracked files).
 * Prints to console and writes to a .txt file.
 *
 * Usage:
 *   npx ts-node generate-ai-commit-prompt.ts
 *   npx ts-node generate-ai-commit-prompt.ts --out ai-prompt.txt --max-lines 8000
 *   npx ts-node generate-ai-commit-prompt.ts --no-diff
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// ------------------------ CLI PARSING ------------------------
type CLIOpts = {
  outPath: string;
  maxLines: number;
  includeDiffs: boolean;
};

function parseArgs(argv: string[]): CLIOpts {
  const defaults: CLIOpts = {
    outPath: 'ai-commit-prompt.txt',
    maxLines: 8000,
    includeDiffs: true,
  };

  const args = [...argv];
  // remove node and script path
  args.shift();
  args.shift();

  let outPath = defaults.outPath;
  let maxLines = defaults.maxLines;
  let includeDiffs = defaults.includeDiffs;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--out' && args[i + 1]) {
      outPath = args[i + 1];
      i++;
    } else if (a === '--max-lines' && args[i + 1]) {
      const v = parseInt(args[i + 1], 10);
      if (!Number.isNaN(v) && v > 0) maxLines = v;
      i++;
    } else if (a === '--no-diff') {
      includeDiffs = false;
    }
  }

  return { outPath, maxLines, includeDiffs };
}

const opts = parseArgs(process.argv);

// ------------------------ UTILITIES ------------------------
function run(cmd: string): string {
  try {
    return execSync(cmd, { stdio: ['ignore', 'pipe', 'pipe'] })
      .toString('utf8')
      .trim();
  } catch {
    return '';
  }
}

function trimToMaxLines(text: string, maxLines: number, label: string): string {
  if (!text) return '';
  const lines = text.split(/\r?\n/);
  if (lines.length <= maxLines) return text;
  const head = lines.slice(0, maxLines).join('\n');
  const omitted = lines.length - maxLines;
  return `${head}\n... [${omitted} more lines omitted from ${label}]`;
}

function inGitRepo(): boolean {
  const res = run('git rev-parse --is-inside-work-tree');
  return res === 'true';
}

function nowISO(): string {
  return new Date().toISOString();
}

// ------------------------ GIT DATA COLLECTION ------------------------
function collectGitContext(includeDiffs: boolean, maxLines: number) {
  if (!inGitRepo()) {
    return {
      branch: '',
      status: '',
      stagedNames: '',
      unstagedNames: '',
      untrackedNames: '',
      stagedDiff: '',
      unstagedDiff: '',
      repoRoot: '',
      warning: 'Not a Git repository. Context will be minimal.',
    };
  }

  const repoRoot = run('git rev-parse --show-toplevel');
  const branch = run('git rev-parse --abbrev-ref HEAD');
  const status = run('git status --porcelain=v1');

  const stagedNames = run('git diff --cached --name-only');
  const unstagedNames = run('git diff --name-only');
  const untrackedNames = run('git ls-files --others --exclude-standard');

  let stagedDiff = '';
  let unstagedDiff = '';

  if (includeDiffs) {
    const rawStaged = run('git diff --cached --no-color');
    const rawUnstaged = run('git diff --no-color');
    stagedDiff = trimToMaxLines(
      rawStaged,
      Math.floor(maxLines / 2),
      'staged diff',
    );
    unstagedDiff = trimToMaxLines(
      rawUnstaged,
      Math.floor(maxLines / 2),
      'unstaged diff',
    );
  }

  return {
    branch,
    status,
    stagedNames,
    unstagedNames,
    untrackedNames,
    stagedDiff,
    unstagedDiff,
    repoRoot,
    warning: '',
  };
}

// ------------------------ STATIC PROMPT (ENGLISH) ------------------------
const staticPrompt = String.raw`## Git Workflow & Commits — Operator Instructions for AI

You are a meticulous Git assistant. Your goal is to **propose the best commit plan and messages** based on the repository context provided below. **Do not run any commands. Do not assume prior instructions.** Follow these rules strictly.

### Branch Naming Convention
- Use **kebab-case** with a short, explicit type prefix:
  - \`feat/\` — New features (e.g., \`feat/add-user-auth\`)
  - \`fix/\` — Bug fixes (e.g., \`fix/cors-headers\`)
  - \`chore/\` — Maintenance, dependencies (e.g., \`chore/update-next\`)
  - \`refactor/\` — Code restructuring (e.g., \`refactor/extract-hook\`)
  - \`style/\` — Formatting only (no logic)
  - \`test/\` — Tests
  - \`docs/\` — Documentation
  - \`ci/\` — CI/CD changes
  - \`hotfix/\` — Emergency production fix
- Allowed chars: lowercase letters, digits, hyphens. Avoid spaces, underscores, and trailing slashes.
- If applicable, you may suffix a ticket ID (e.g., \`feat/add-user-auth-ANPD-123\`), but **do not** put scopes in commit messages.

### Conventional Commits — Message Rules
**IMPORTANT RULE:** Do **not** use optional scopes between the type and \`:\`. Use only the commit **type**.

**Base format:**
\`\`\`
type: description

[optional body]

[optional footer]
\`\`\`

**Commit types:**
- \`feat:\` — New feature
- \`fix:\` — Bug fix
- \`docs:\` — Documentation change
- \`style:\` — Formatting only (no logic)
- \`refactor:\` — Code change that neither adds a feature nor fixes a bug
- \`perf:\` — Performance improvement
- \`test:\` — Test additions or changes
- \`chore:\` — Dependencies, configuration, build, etc.

**Style for the subject line:**
- Imperative mood, present tense (e.g., “add”, “fix”, “update”, not “added/adding/fixed”)
- Lowercase after the colon; no trailing period
- Keep it concise (ideally ≤ 72 chars)

**Body & Footer (when needed):**
- Wrap at ~72–100 chars per line for readability
- Explain the “why” and “how”, not just “what”
- Reference issues: \`Refs #123\`, \`Fixes #456\`
- Breaking changes must include a footer line:
  \`\`\`
  BREAKING CHANGE: describe the breaking change and migration notes
  \`\`\`
- Co-authors:
  \`\`\`
  Co-authored-by: Name <email@example.com>
  \`\`\`

**Correct examples:**
\`\`\`
feat: add JWT authentication to middleware
fix: correct CORS headers for local development
docs: improve Firebase setup instructions
style: format code with Prettier
refactor: extract validation logic to hook
test: add integration tests for POST /api/users
chore: upgrade Next.js to v16.1.0
perf: optimize image loading with lazy loading
\`\`\`

**Incorrect (do not use):**
\`\`\`
❌ feat(auth): add JWT authentication
❌ fix(cors): correct CORS headers
❌ chore(deps): upgrade Next.js
\`\`\`

### ⚠️ Critical — When to Commit
**Only prepare commits if the current chat message explicitly instructs you to do so.**
Requests from previous messages do **not** apply to the current one.

### Analyzing Changes Before Committing
Always verify changes first. Useful commands (you **must not** execute them, but base your reasoning on their output when provided):

\`\`\`bash
# Status of modified files
git status

# Diff of unstaged changes
git diff

# Diff of staged changes
git diff --staged

# Diff for a specific file
git diff path/to/file.ts

# Interactive staging (recommended for atomic commits)
git add -p

# Unstage a file or hunk if needed
git restore --staged path/to/file.ts

# Amend the last commit (only if safe and explicitly requested)
git commit --amend --no-edit
\`\`\`

### Commit Strategy — Prefer Atomic Commits
Make **small, atomic commits**. Each commit should be a single logical change:
- Separate different features or fixes
- Separate refactors from features
- Separate documentation and tests if sizable
- Separate dependency bumps from code changes

**Benefits:**
- Easier review and debugging
- Simplified reverts
- Clear project history

**Example strategy** for a new feature:
\`\`\`bash
git add lib/api/songs.ts
git commit -m "feat: add typed songs API client"

git add components/features/SongCard.tsx
git commit -m "feat: add SongCard component"

git add __tests__/SongCard.spec.tsx
git commit -m "test: add SongCard unit tests"

git add docs/
git commit -m "docs: document SongCard props"
\`\`\`

### Safeguards & Hygiene
- **Never commit secrets** (\`.env\`, API keys), build artifacts (\`dist\`, \`.next\`, \`coverage\`, \`build\`), or dependencies (\`node_modules\`). Use \`.gitignore\`.
- Prefer **textual diffs**; avoid committing large/binary files. Consider Git LFS if needed.
- Ensure code **builds, lints, and tests** pass before finalizing the commit plan.

---

## Your Task (AI) — Output as Copy-Pasteable Git Commands

Given the repository context below, produce a **commit plan** and, for each atomic commit, include **exact Git commands** as copy‑pasteable code blocks:

1. Propose an ordered **commit plan** (atomic commits).
2. For **each commit**, output a **\`bash\` code block** containing:
   - The precise \`git add\` command(s) (file paths or interactive hints like comments for \`-p\` when splitting hunks).
   - The corresponding \`git commit -m "..."\` with the final Conventional Commit message (subject + optional body/footer).
3. Explain the **rationale** for the grouping and commit types (brief).
4. If the diff mixes concerns, show how to split using \`git add -p\` and/or targeted paths, with **separate bash blocks** per commit when necessary.
5. Provide a **PR title** and a short **PR description**, and include an **optional \`bash\` block** with commands to create/update a PR (e.g., \`gh pr create\`) if applicable.

**Important formatting requirements:**
- Use this exact structure in your response:
  - \`Plan:\` bullet list of commits
  - \`Messages:\` list of commits, each followed by a **\`bash\`** code block with the exact \`git add ...\` and \`git commit -m "..."\`
  - \`Rationale:\` 2–5 bullets
  - \`PR:\` title + description, plus an optional **\`bash\`** code block with PR commands
- **Do not execute commands yourself.** Only generate the code blocks for the operator to copy and run.
- Ensure commit messages comply with the rules above (no scopes, imperative mood, ≤ ~72 chars subject).

`;

// ------------------------ DYNAMIC REPO CONTEXT ------------------------
const git = collectGitContext(opts.includeDiffs, opts.maxLines);

const repoContext = [
  '',
  '----------------------------------------',
  '## Repository Context (autodetected)',
  `Timestamp: ${nowISO()}`,
  git.repoRoot ? `Repo root: ${git.repoRoot}` : '',
  git.branch ? `Current branch: ${git.branch}` : '',
  git.warning ? `Warning: ${git.warning}` : '',
  '',
  '### Status (porcelain)',
  git.status ? '```text\n' + git.status + '\n```' : '_No status available_',
  '',
  '### Staged files',
  git.stagedNames ? '```text\n' + git.stagedNames + '\n```' : '_None_',
  '',
  '### Unstaged files',
  git.unstagedNames ? '```text\n' + git.unstagedNames + '\n```' : '_None_',
  '',
  '### Untracked files',
  git.untrackedNames ? '```text\n' + git.untrackedNames + '\n```' : '_None_',
  '',
  opts.includeDiffs
    ? '### Staged diff\n' +
      (git.stagedDiff
        ? '```diff\n' + git.stagedDiff + '\n```'
        : '_No staged diff_')
    : '_Staged diff omitted (flag --no-diff)_',
  '',
  opts.includeDiffs
    ? '### Unstaged diff\n' +
      (git.unstagedDiff
        ? '```diff\n' + git.unstagedDiff + '\n```'
        : '_No unstaged diff_')
    : '_Unstaged diff omitted (flag --no-diff)_',
  '----------------------------------------',
]
  .filter(Boolean)
  .join('\n');

// ------------------------ OUTPUT ------------------------
const finalPrompt = `${staticPrompt}\n${repoContext}\n`;

const resolvedOut = path.resolve(process.cwd(), opts.outPath);
fs.writeFileSync(resolvedOut, finalPrompt, 'utf8');

console.log(finalPrompt);
console.error(
  `\nSaved prompt to: ${resolvedOut}\n` +
    `Options -> includeDiffs=${opts.includeDiffs}, maxLines=${opts.maxLines}\n`,
);
