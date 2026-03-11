/**
 * generate-ai-pr-prompt.ts
 *
 * Generates an AI-ready prompt to craft a polished Pull Request (PR) title & description,
 * with rich formatting and accurate context from Git (branch, base comparison, commit history,
 * diffstat, changed files, optional unified diff).
 *
 * Output: prints to console and writes to a .txt file.
 *
 * Usage examples:
 *   npx ts-node generate-ai-pr-prompt.ts
 *   npx ts-node generate-ai-pr-prompt.ts --out ai-pr-prompt.txt --max-lines 12000
 *   npx ts-node generate-ai-pr-prompt.ts --no-diff --base main --lang pt
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// ------------------------ CLI PARSING ------------------------
type CLIOpts = {
  outPath: string;
  maxLines: number;
  includeDiffs: boolean;
  baseBranchArg?: string;
  lang: 'en' | 'pt';
};

function parseArgs(argv: string[]): CLIOpts {
  const defaults: CLIOpts = {
    outPath: 'ai-pr-prompt.txt',
    maxLines: 10000,
    includeDiffs: true,
    baseBranchArg: undefined,
    lang: 'en',
  };

  const args = [...argv];
  args.shift(); // node
  args.shift(); // script

  let outPath = defaults.outPath;
  let maxLines = defaults.maxLines;
  let includeDiffs = defaults.includeDiffs;
  let baseBranchArg = defaults.baseBranchArg;
  let lang: 'en' | 'pt' = defaults.lang;

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
    } else if (a === '--base' && args[i + 1]) {
      baseBranchArg = args[i + 1];
      i++;
    } else if (a === '--lang' && args[i + 1]) {
      const v = args[i + 1].toLowerCase();
      if (v === 'pt' || v === 'en') lang = v as 'pt' | 'en';
      i++;
    }
  }

  return { outPath, maxLines, includeDiffs, baseBranchArg, lang };
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

function inGitRepo(): boolean {
  const res = run('git rev-parse --is-inside-work-tree');
  return res === 'true';
}

function nowISO(): string {
  return new Date().toISOString();
}

function trimToMaxLines(text: string, maxLines: number, label: string): string {
  if (!text) return '';
  const lines = text.split(/\r?\n/);
  if (lines.length <= maxLines) return text;
  const head = lines.slice(0, maxLines).join('\n');
  const omitted = lines.length - maxLines;
  return `${head}\n... [${omitted} more lines omitted from ${label}]`;
}

function branchExists(name: string): boolean {
  if (!name) return false;
  const res = run(`git rev-parse --verify ${name}`);
  return !!res;
}

function pickBaseBranch(preferred?: string): string {
  if (preferred && branchExists(preferred)) return preferred;

  const candidates = ['develop', 'main', 'master'];
  for (const c of candidates) {
    if (branchExists(c)) return c;
  }
  // fallback: try origin/develop, origin/main, origin/master
  const remoteCandidates = ['origin/develop', 'origin/main', 'origin/master'];
  for (const c of remoteCandidates) {
    if (branchExists(c)) return c;
  }
  return ''; // none found
}

// Extract referenced issues patterns (e.g., "Closes #123", "Fixes #45")
function extractIssueRefs(text: string): string[] {
  const refs = new Set<string>();
  const regex = /\b(?:[Cc]loses|[Ff]ixes|[Rr]esolves)\s+#(\d+)\b/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    refs.add(`#${m[1]}`);
  }
  return Array.from(refs);
}

// ------------------------ GIT CONTEXT FOR PR ------------------------
type GitPRContext = {
  warning?: string;
  repoRoot: string;
  currentBranch: string;
  baseBranch: string;
  mergeBase: string;
  ahead: number;
  behind: number;
  commitsOnBranchOneLine: string;
  commitsOnBranchFull: string;
  diffStat: string;
  nameStatus: string;
  unifiedDiff?: string;
  statusPorcelain: string;
  issueRefs: string[];
};

function collectGitPRContext(
  includeDiffs: boolean,
  maxLines: number,
  baseBranchArg?: string,
): GitPRContext {
  if (!inGitRepo()) {
    return {
      warning: 'Not a Git repository. Context will be minimal.',
      repoRoot: '',
      currentBranch: '',
      baseBranch: '',
      mergeBase: '',
      ahead: 0,
      behind: 0,
      commitsOnBranchOneLine: '',
      commitsOnBranchFull: '',
      diffStat: '',
      nameStatus: '',
      unifiedDiff: '',
      statusPorcelain: '',
      issueRefs: [],
    };
  }

  const repoRoot = run('git rev-parse --show-toplevel');
  const currentBranch =
    run('git branch --show-current') || run('git rev-parse --abbrev-ref HEAD');
  const baseBranch = pickBaseBranch(baseBranchArg);

  const mergeBase = baseBranch ? run(`git merge-base ${baseBranch} HEAD`) : '';
  const aheadBehindRaw = baseBranch
    ? run(`git rev-list --left-right --count ${baseBranch}...HEAD`)
    : '';
  let ahead = 0,
    behind = 0;
  if (aheadBehindRaw) {
    const [behindStr, aheadStr] = aheadBehindRaw.split(/\s+/);
    ahead = parseInt(aheadStr || '0', 10) || 0;
    behind = parseInt(behindStr || '0', 10) || 0;
  }

  const statusPorcelain = run('git status --porcelain=v1');

  const commitsOnBranchOneLine = baseBranch
    ? run(`git log ${baseBranch}..HEAD --oneline`)
    : '';
  const commitsOnBranchFull = baseBranch
    ? run(`git log ${baseBranch}..HEAD --format="%H%n%s%n%b%n---END---"`)
    : '';

  const diffStat = baseBranch ? run(`git diff ${baseBranch}... --stat`) : '';
  const nameStatus = baseBranch
    ? run(`git diff ${baseBranch}... --name-status`)
    : '';

  let unifiedDiff = '';
  if (includeDiffs && baseBranch) {
    const raw = run(`git diff ${baseBranch}... --no-color`);
    unifiedDiff = trimToMaxLines(raw, maxLines, 'unified diff');
  }

  // Aggregate issue refs from commit messages and status
  const issueRefs = extractIssueRefs(commitsOnBranchFull);

  return {
    repoRoot,
    currentBranch,
    baseBranch,
    mergeBase,
    ahead,
    behind,
    commitsOnBranchOneLine,
    commitsOnBranchFull,
    diffStat,
    nameStatus,
    unifiedDiff,
    statusPorcelain,
    issueRefs,
  };
}

// ------------------------ STATIC PROMPT (LANG-AWARE) ------------------------
function buildStaticPrompt(lang: 'en' | 'pt') {
  if (lang === 'pt') {
    return String.raw`## Assistente de Pull Request — Instruções Operacionais para IA

Você é um(a) **assistente de PR meticuloso(a)**. Sua tarefa é **gerar um título e uma descrição de PR** de alta qualidade, com formatação rica e **baseada nos dados de Git** fornecidos.  
**Não execute comandos. Não assuma instruções anteriores.** Siga estritamente as regras.

### Diretrizes de Título (Conventional Commits)
- **Formato:** \`tipo: descrição\` (sem *scope* entre parênteses)
- Tipos válidos: \`feat\`, \`fix\`, \`docs\`, \`style\`, \`refactor\`, \`perf\`, \`test\`, \`chore\`
- Tom imperativo, presente, sem ponto final; ≤ ~72 caracteres

### Formatação Obrigatória da Resposta
- **Sempre** retorne **toda a descrição do PR** dentro de **um único bloco de código Markdown**.
- Use uma estrutura **rica** e escaneável:
  - Título (linha 1 do bloco)
  - Seções com \`#\`, \`##\`, \`###\`
  - Ênfase em termos-chave (**negrito**, *itálico*)
  - Listas curtas e objetivas
  - **Checklist** com caixas para testes/validações
  - **Observações/risks** usando blockquotes quando relevante
- Inclua referências a issues quando possível (por ex., \`Closes #42\`).
- Se houver _breaking changes_, destaque claramente em uma seção própria.

### Análise do Contexto de Git
Use **exclusivamente** o contexto de Git fornecido para garantir precisão:
- **Branch atual** e **branch base** (padrão \`develop\`; use \`main/master\` se aplicável)
- **Histórico de commits deste branch** (mensagens curtas e completas)
- **Comparativo com a base**: \`diff --stat\`, arquivos alterados (name-status) e **diff unificado** (se fornecido)
- **Ahead/Behind** em relação à base
- Referências a issues encontradas nos commits

### Diretrizes de PR
- PRs de **features** devem mirar \`develop\`; **hotfixes** miram \`main/master\`
- O **título do PR** deve obedecer ao Conventional Commits (sem escopo)
- Quando aplicável, inclua \`Closes #...\` ou \`Fixes #...\`

### Estrutura Esperada da Saída (dentro de um único bloco Markdown)
Comece com a **primeira linha sendo o título do PR** no formato Conventional Commits, seguido do corpo com seções como:

- \`# Resumo\` — o que foi entregue (curto, claro)
- \`## Mudanças\` — bullets por área/arquivo/componente
- \`## Notas técnicas\` — decisões, padrões, flags, migrações
- \`## Testes\` — como foram realizados; logs/prints (se relevante)
- \`## Passos de verificação\` — checklist com \`- [ ]\`
- \`## Compatibilidade\` — backward-compat, breakages, migração
- \`## Riscos & Mitigações\` — principais riscos / como mitigar
- \`## Desempenho\` — impactos/perf otimizações (se houver)
- \`## Documentação\` — docs, comentários, READMEs atualizados
- \`## Issues relacionadas\` — \`Closes #...\`, \`Fixes #...\`

### Comandos Opcionais para Criar/Atualizar PR
Após a descrição, **opcionalmente** gere um **segundo bloco \`bash\`** com comandos para criar/atualizar o PR (por ex., com GitHub CLI):
- Use \`--base <branch-base>\`
- Para corpo multiline, prefira arquivo: \`--body-file pr.md\`
- Exemplo:
\`\`\`bash
# (Opcional) salvar a descrição acima em pr.md e criar o PR:
gh pr create --base <BASE> --title "<TÍTULO>" --body-file pr.md
\`\`\`

### Salvaguardas
- **Não** inclua segredos, dumps extensos desnecessários ou dados sensíveis.
- **Não execute** comandos; apenas forneça os blocos para o operador.
- Seja conciso, objetivo e revisável.`;
  }

  // English default
  return String.raw`## Pull Request Assistant — Operator Instructions for AI

You are a **meticulous PR assistant**. Your task is to **generate a high‑quality PR title and description**, with rich formatting, **grounded in the Git context** provided below.  
**Do not run commands. Do not assume prior instructions.** Follow these rules strictly.

### PR Title Rules (Conventional Commits)
- **Format:** \`type: description\` (no optional *scope*)
- Valid types: \`feat\`, \`fix\`, \`docs\`, \`style\`, \`refactor\`, \`perf\`, \`test\`, \`chore\`
- Imperative mood, present tense; no trailing period; ≤ ~72 chars

### Mandatory Output Formatting
- **Always** return the **entire PR description** inside **a single Markdown code block**.
- Use **rich**, review‑friendly structure:
  - Title (line 1 of the block)
  - Headings/subheadings with \`#\`, \`##\`, \`###\`
  - Emphasis (**bold**, *italics*)
  - Short, scannable bullet lists
  - **Checklist** (with \`- [ ]\`) for tests/verification/follow‑ups
  - **Callouts** (blockquotes) for notable notes/risks
- Reference issues when applicable (e.g., \`Closes #42\`).
- Clearly call out any _breaking changes_ in a dedicated section.

### Analyze the Git Context
Use **only** the provided Git context to ensure accuracy:
- **Current branch** and **base branch** (default \`develop\`; use \`main/master\` if applicable)
- **Commit history on this branch** (short and full messages)
- **Base comparison**: \`diff --stat\`, changed files (name‑status), and unified diff (if provided)
- **Ahead/behind** relative to base
- Issue references found in commit messages

### PR Guidelines
- Feature PRs target \`develop\`; hotfixes target \`main/master\`
- **PR title** must follow Conventional Commits (no scope)
- When applicable, include \`Closes #...\` or \`Fixes #...\`

### Expected Output Structure (inside a single Markdown block)
Start with the **first line as the PR title** (Conventional Commits), followed by sections like:

- \`# Summary\` — what this delivers (short, clear)
- \`## Changes\` — bullets grouped by area/file/component
- \`## Technical Notes\` — decisions, patterns, flags, migrations
- \`## Tests\` — how they were conducted; logs/screenshots if relevant
- \`## Verification Steps\` — checklist with \`- [ ]\`
- \`## Compatibility\` — backward‑compat, breakages, migration notes
- \`## Risks & Mitigations\` — main risks and how to mitigate
- \`## Performance\` — impacts/optimizations (if any)
- \`## Documentation\` — docs, comments, READMEs updated
- \`## Related Issues\` — \`Closes #...\`, \`Fixes #...\`

### Optional Commands to Create/Update PR
After the description, **optionally** provide a **second \`bash\` block** with commands to create/update the PR (e.g., GitHub CLI):
- Use \`--base <base-branch>\`
- For multiline body, prefer a file: \`--body-file pr.md\`
- Example:
\`\`\`bash
# (Optional) save the description above into pr.md and create the PR:
gh pr create --base <BASE> --title "<TITLE>" --body-file pr.md
\`\`\`

### Safeguards
- **Do not** include secrets, massive irrelevant dumps, or sensitive data.
- **Do not execute** commands; only output blocks for the operator.
- Be concise, objective, and review‑friendly.`;
}

// ------------------------ DYNAMIC REPO CONTEXT ------------------------
function buildRepoContext(g: GitPRContext, lang: 'en' | 'pt'): string {
  const lines: string[] = [];
  lines.push('');
  lines.push('----------------------------------------');
  lines.push(
    lang === 'pt'
      ? '## Contexto do Repositório (auto)'
      : '## Repository Context (autodetected)',
  );
  lines.push(`Timestamp: ${nowISO()}`);
  if (g.repoRoot) lines.push(`Repo root: ${g.repoRoot}`);
  if (g.currentBranch)
    lines.push(
      (lang === 'pt' ? 'Branch atual: ' : 'Current branch: ') + g.currentBranch,
    );
  if (g.baseBranch)
    lines.push(
      (lang === 'pt' ? 'Branch base: ' : 'Base branch: ') + g.baseBranch,
    );
  if (g.warning) lines.push(`Warning: ${g.warning}`);
  if (g.mergeBase) lines.push(`Merge-base: ${g.mergeBase}`);
  if (g.baseBranch) {
    lines.push('');
    lines.push(lang === 'pt' ? '### Ahead/Behind' : '### Ahead/Behind');
    lines.push('```text');
    lines.push(`ahead: ${g.ahead}, behind: ${g.behind}`);
    lines.push('```');
  }

  lines.push('');
  lines.push(
    lang === 'pt' ? '### Status (porcelain)' : '### Status (porcelain)',
  );
  lines.push(
    g.statusPorcelain
      ? '```text\n' + g.statusPorcelain + '\n```'
      : lang === 'pt'
        ? '_Sem status disponível_'
        : '_No status available_',
  );

  lines.push('');
  lines.push(
    lang === 'pt'
      ? '### Commits neste branch (em relação à base)'
      : '### Commits on this branch (relative to base)',
  );
  lines.push(
    g.commitsOnBranchOneLine
      ? '```text\n' + g.commitsOnBranchOneLine + '\n```'
      : lang === 'pt'
        ? '_Nenhum commit encontrado_'
        : '_No commits found_',
  );

  lines.push('');
  lines.push(
    lang === 'pt'
      ? '### Commits (mensagens completas)'
      : '### Commits (full messages)',
  );
  lines.push(
    g.commitsOnBranchFull
      ? '```text\n' + g.commitsOnBranchFull + '\n```'
      : lang === 'pt'
        ? '_Nenhum commit encontrado_'
        : '_No commits found_',
  );

  lines.push('');
  lines.push(lang === 'pt' ? '### Diffstat vs base' : '### Diffstat vs base');
  lines.push(
    g.diffStat
      ? '```text\n' + g.diffStat + '\n```'
      : lang === 'pt'
        ? '_Sem diffstat_'
        : '_No diffstat_',
  );

  lines.push('');
  lines.push(
    lang === 'pt'
      ? '### Arquivos alterados (name-status)'
      : '### Changed files (name-status)',
  );
  lines.push(
    g.nameStatus
      ? '```text\n' + g.nameStatus + '\n```'
      : lang === 'pt'
        ? '_Nenhum arquivo alterado_'
        : '_No changed files_',
  );

  lines.push('');
  if (g.unifiedDiff !== undefined && g.unifiedDiff !== '') {
    lines.push(
      lang === 'pt'
        ? '### Diff unificado (truncado, se necessário)'
        : '### Unified diff (truncated if needed)',
    );
    lines.push('```diff\n' + g.unifiedDiff + '\n```');
  } else {
    lines.push(
      lang === 'pt'
        ? '_Diff unificado omitido (flag --no-diff)_'
        : '_Unified diff omitted (flag --no-diff)_',
    );
  }

  if (g.issueRefs.length > 0) {
    lines.push('');
    lines.push(
      lang === 'pt'
        ? '### Issues referenciadas detectadas'
        : '### Detected referenced issues',
    );
    lines.push('```text\n' + g.issueRefs.join(', ') + '\n```');
  }

  lines.push('----------------------------------------');
  return lines.join('\n');
}

// ------------------------ OUTPUT ------------------------
(function main() {
  const staticPrompt = buildStaticPrompt(opts.lang);
  const git = collectGitPRContext(
    opts.includeDiffs,
    opts.maxLines,
    opts.baseBranchArg,
  );
  const repoContext = buildRepoContext(git, opts.lang);
  const finalPrompt = `${staticPrompt}\n${repoContext}\n`;

  const resolvedOut = path.resolve(process.cwd(), opts.outPath);
  fs.writeFileSync(resolvedOut, finalPrompt, 'utf8');

  console.log(finalPrompt);
  console.error(
    `\nSaved prompt to: ${resolvedOut}\n` +
      `Options -> includeDiffs=${opts.includeDiffs}, maxLines=${opts.maxLines}, lang=${opts.lang}, base=${git.baseBranch || 'auto-none'}\n`,
  );
})();
