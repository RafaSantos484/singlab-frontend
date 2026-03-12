/**
 * generate-project-dump.ts
 *
 * Gera um arquivo TXT contendo o código relevante de TODO o projeto,
 * no formato:
 *
 *   // path/to/file
 *   <conteúdo>
 *
 * Comportamento:
 * - Faz o dump de todos os arquivos de texto encontrados a partir da raiz do projeto
 * - Respeita automaticamente o .gitignore (e sempre ignora node_modules e .git)
 * - Escreve, no início do arquivo, um índice com todos os paths incluídos
 * - Adiciona instruções em inglês otimizadas para uso com IA
 * - Orienta a IA a navegar pelo índice antes de ler conteúdos
 * - Mantém cada arquivo precedido por `// <file_path>`
 * - Instrui a IA a retornar alterações como um único script bash executável
 *
 * Uso:
 *   npx tsx scripts/generate-project-dump.ts
 *   npx tsx scripts/generate-project-dump.ts --out scripts/project-code.txt
 */

import * as fs from 'fs';
import * as path from 'path';
import ignore from 'ignore';

type CLIOpts = {
  outPath: string;
};

function parseArgs(argv: string[]): CLIOpts {
  const args = [...argv];
  args.shift(); // node
  args.shift(); // script

  let outPath = 'scripts/project-code.txt';

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--out' && args[i + 1]) {
      outPath = args[i + 1];
      i++;
      continue;
    }
  }

  return { outPath };
}

const opts = parseArgs(process.argv);

function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

const TEXT_FILE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.mts',
  '.cts',
  '.json',
  '.jsonc',
  '.md',
  '.mdx',
  '.txt',
  '.yml',
  '.yaml',
  '.env',
  '.env.local',
  '.env.development',
  '.env.production',
  '.env.test',
  '.css',
  '.scss',
  '.sass',
  '.less',
  '.html',
  '.htm',
  '.svg',
  '.xml',
  '.graphql',
  '.gql',
  '.sql',
  '.prisma',
  '.sh',
  '.bash',
  '.zsh',
  '.gitignore',
  '.gitattributes',
  '.editorconfig',
  '.prettierrc',
  '.eslintrc',
  '.npmrc',
  '.nvmrc',
  '.dockerignore',
  '.conf',
  '.ini',
  '.toml',
  '.lock',
]);

const BINARY_FILE_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.bmp',
  '.ico',
  '.avif',
  '.mp4',
  '.mov',
  '.avi',
  '.mkv',
  '.webm',
  '.mp3',
  '.wav',
  '.flac',
  '.ogg',
  '.m4a',
  '.aac',
  '.pdf',
  '.zip',
  '.rar',
  '.7z',
  '.tar',
  '.gz',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.eot',
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.bin',
  '.wasm',
  '.class',
  '.jar',
  '.pyc',
]);

function getFileExtensions(filePath: string): string[] {
  const base = path.basename(filePath).toLowerCase();
  const exts: string[] = [];

  const ext = path.extname(base);
  if (ext) exts.push(ext);

  if (base.startsWith('.')) {
    exts.push(base);
  }

  return [...new Set(exts)];
}

function looksLikeTextFile(filePath: string): boolean {
  const exts = getFileExtensions(filePath);

  if (exts.some((ext) => TEXT_FILE_EXTENSIONS.has(ext))) {
    return true;
  }

  if (exts.some((ext) => BINARY_FILE_EXTENSIONS.has(ext))) {
    return false;
  }

  try {
    const fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(8192);
    const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, 0);
    fs.closeSync(fd);

    if (bytesRead === 0) {
      return true;
    }

    let suspicious = 0;

    for (let i = 0; i < bytesRead; i++) {
      const byte = buffer[i];

      if (byte === 0) {
        return false;
      }

      const isAllowedControl = byte === 9 || byte === 10 || byte === 13;
      const isPrintableAscii = byte >= 32 && byte <= 126;
      const isLikelyUtf8 = byte >= 128;

      if (!isAllowedControl && !isPrintableAscii && !isLikelyUtf8) {
        suspicious++;
      }
    }

    return suspicious / bytesRead < 0.1;
  } catch {
    return false;
  }
}

// ------------------------ LOAD .gitignore ------------------------
function loadIgnore(): ReturnType<typeof ignore> {
  const ig = ignore();
  const gitignorePath = path.join(process.cwd(), '.gitignore');

  if (fs.existsSync(gitignorePath)) {
    const content = fs.readFileSync(gitignorePath, 'utf8');
    ig.add(content.split(/\r?\n/));
  }

  // sempre ignorar
  ig.add(['node_modules', '.git']);

  // ignorar também o próprio arquivo de saída
  const outRel = toPosix(
    path.relative(process.cwd(), path.resolve(process.cwd(), opts.outPath)),
  );
  if (outRel && outRel !== '') {
    ig.add([outRel]);
  }

  return ig;
}

const ig = loadIgnore();

// ------------------------ WALK DIRECTORY ------------------------
function* walk(dir: string): Generator<string> {
  const items = fs.readdirSync(dir, { withFileTypes: true });

  for (const item of items) {
    const full = path.join(dir, item.name);
    const rel = toPosix(path.relative(process.cwd(), full));

    if (ig.ignores(rel)) continue;

    if (item.isDirectory()) {
      yield* walk(full);
    } else if (item.isFile() && looksLikeTextFile(full)) {
      yield full;
    }
  }
}

// ------------------------ COLLECT ALL PROJECT FILES ------------------------
function collectAllFiles(): string[] {
  const collected = new Set<string>();

  for (const file of walk(process.cwd())) {
    collected.add(path.resolve(file));
  }

  return [...collected].sort((a, b) => {
    const relA = toPosix(path.relative(process.cwd(), a));
    const relB = toPosix(path.relative(process.cwd(), b));
    return relA.localeCompare(relB);
  });
}

// ------------------------ AI HEADER ------------------------
function buildAIHeader(files: string[]): string {
  const relFiles = files.map((file) =>
    toPosix(path.relative(process.cwd(), file)),
  );

  const lines: string[] = [
    '// ============================================================',
    '// PROJECT CODE DUMP',
    '// ============================================================',
    '//',
    '// PURPOSE',
    '// This document aggregates ALL project source files (respecting .gitignore) to enable',
    '// efficient AI-assisted analysis and changes.',
    '//',
    '// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    '// AGENT NAVIGATION — READ THIS BEFORE ANYTHING ELSE',
    '// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    '// 1) Start by reading the FILE INDEX to understand the project structure.',
    '// 2) Do NOT read the entire dump top-to-bottom; jump only to relevant files.',
    '// 3) To locate a file, search for its exact marker:',
    '//      // <file_path>',
    '// 4) Expand to related files (imports, exports, shared types, utilities) only as needed.',
    '// 5) If a "copilot-instructions" file exists in the FILE INDEX, read it FIRST — it is authoritative.',
    '//',
    '// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    '// DELIVERABLE FORMAT',
    '// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    '// All code changes MUST be delivered as a SINGLE self-contained bash script',
    '// to be executed at the PROJECT ROOT. The script must:',
    '//',
    '//   • Handle ALL file operations: create, edit, rename/move, delete.',
    "//   • Write file contents using heredoc (cat << 'EOF') or printf — never echo for multi-line.",
    '//   • Be idempotent where possible (e.g., mkdir -p, rm -f).',
    '//   • Precede every operation with a comment describing what is being done.',
    '//   • Be enclosed in a SINGLE ```bash code block.',
    '//   • Never split changes across multiple scripts or "apply manually" instructions.',
    '//',
    '//   Example:',
    '//',
    '//   ```bash',
    '//   #!/usr/bin/env bash',
    '//   set -euo pipefail',
    '//',
    '//   # Create/overwrite app/components/Button.tsx',
    '//   mkdir -p app/components',
    "//   cat << 'EOF' > app/components/Button.tsx",
    '//   export function Button() {',
    '//     return <button>Click me</button>;',
    '//   }',
    '//   EOF',
    '//',
    '//   # Delete deprecated file',
    '//   rm -f app/components/OldButton.tsx',
    '//',
    '//   # Rename file',
    '//   mv app/utils/helpers.ts app/utils/formatters.ts',
    '//   ```',
    '//',
    '// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    '// MANDATORY RESPONSE STRUCTURE',
    '// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    '// Your reply MUST follow this exact structure — every section is required:',
    '//',
    '//   ── PLAN ──',
    '//   Ordered steps you will take. List every affected file: existing, new, or deleted.',
    '//   Be concise and specific. No vague descriptions.',
    '//',
    '//   ── CHANGES ──',
    '//   A SINGLE bash script (as described in DELIVERABLE FORMAT) that applies ALL changes.',
    '//   Every file write MUST use heredoc or printf. Never truncate file contents.',
    '//',
    '//   ── DOCS ──',
    '//   Update or create documentation to reflect the changes:',
    '//   • README or docs/*.md files impacted by the changes',
    '//   • Inline code comments and JSDoc/TSDoc blocks where relevant',
    '//   • Usage examples if any API or public behavior changed',
    '//   Include doc file writes inside the same bash script under CHANGES.',
    '//',
    '//   ── NOTES ──',
    '//   • Justify key architectural decisions and trade-offs.',
    '//   • Include migration guidance if behavior or interfaces changed.',
    '//   • Flag any assumptions made due to missing context.',
    '//',
    '//   ── CHECKS ──',
    '//   A short checklist confirming you verified:',
    '//   [ ] Type safety and TypeScript correctness',
    '//   [ ] Lint rules and formatting (ESLint / Prettier)',
    '//   [ ] No unused imports, exports, or dead code',
    '//   [ ] Security (no secret leaks, inputs validated)',
    '//   [ ] Performance (no unnecessary re-renders, queries, or allocations)',
    '//   [ ] Consistency with existing project conventions',
    '//',
    '// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    '// SCOPE & CHANGE MANAGEMENT',
    '// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    '// - Evaluate whether new modules, utilities, config, or scripts improve clarity or cohesion',
    '//   and include them if justified.',
    '// - When changes touch cross-cutting concerns (logging, error handling, config, build),',
    '//   update ALL relevant files and explain the reasoning in NOTES.',
    '// - Keep changes minimal but complete. Never leave the codebase in a broken or partial state.',
    '// - Provide migration notes for any breaking changes.',
    '//',
    '// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    '// CODE QUALITY & BEST PRACTICES',
    '// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    '// - Follow ALL conventions already present in the codebase.',
    '// - TypeScript: strong typing, precise generics, narrow `any` usage, explicit return types.',
    '// - Functions: small, single-responsibility, clearly named. No dead code.',
    '// - Error handling: explicit, consistent, user-safe. No silent failures or swallowed exceptions.',
    '// - Security: load secrets via environment variables only. Validate and sanitize all external input.',
    '// - Performance: avoid unnecessary work; prefer streaming/iterators for large data; be O-complexity-aware.',
    '// - Formatting: adhere strictly to ESLint and Prettier rules.',
    '//',
    '// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    '// AUTHORITATIVE INSTRUCTIONS FILE',
    '// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    '// If a "copilot-instructions" file (any extension) appears in the FILE INDEX:',
    '// - Treat it as the SINGLE SOURCE OF TRUTH for architecture, patterns, naming, and boundaries.',
    '// - Every decision you make MUST align with it.',
    '// - If any recommendation in this header conflicts with it, the instructions file wins.',
    '//   Justify any intentional deviation explicitly in NOTES.',
    '//',
    '// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    '// IMPORTANT REMINDERS',
    '// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    '// - ALL changes MUST be inside a single bash script code block. No exceptions.',
    '// - Never instruct the developer to "manually edit" a file — automate everything.',
    "// - heredoc (cat << 'EOF') MUST be used for multi-line file content. No inline echo chains.",
    '// - The FILE INDEX is a navigation aid only; actual content follows BEGIN FILE CONTENTS.',
    '// - If a path appears in both the index and the content area, the content area is authoritative.',
    '//',
    '// FILE INDEX:',
    ...relFiles.map((rel) => `// ${rel}`),
    '//',
    '// ============================================================',
    '// BEGIN FILE CONTENTS',
    '// ============================================================',
    '',
  ];

  return lines.join('\n');
}

// ------------------------ BUILD OUTPUT ------------------------
function generateDump(): string {
  const files = collectAllFiles();

  if (files.length === 0) {
    return [
      '// ============================================================',
      '// PROJECT CODE DUMP',
      '// ============================================================',
      '// No text files were found in the project root.',
      '//',
      `// Searched from: ${toPosix(process.cwd())}`,
    ].join('\n');
  }

  const out: string[] = [];
  out.push(buildAIHeader(files));

  for (const file of files) {
    const rel = toPosix(path.relative(process.cwd(), file));

    let content: string;
    try {
      content = fs.readFileSync(file, 'utf8');
    } catch (err) {
      content = `/* Error reading file: ${(err as Error).message} */`;
    }

    out.push(`// ${rel}\n${content}\n`);
  }

  return out.join('\n');
}

// ------------------------ WRITE FILE ------------------------
const dump = generateDump();
const resolved = path.resolve(process.cwd(), opts.outPath);

fs.mkdirSync(path.dirname(resolved), { recursive: true });
fs.writeFileSync(resolved, dump, 'utf8');

console.log('\nFull project dump generated successfully!');
console.log(`Saved at: ${resolved}\n`);
