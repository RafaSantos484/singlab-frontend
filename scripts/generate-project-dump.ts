/**
 * generate-project-dump.ts
 *
 * Gera um arquivo TXT contendo o código relevante do projeto,
 * no formato:
 *
 *   // path/to/file
 *   <conteúdo>
 *
 * Melhorias:
 * - Escreve, no início do arquivo, um índice com todos os paths incluídos
 * - Adiciona instruções em inglês otimizadas para uso com IA
 * - Orienta a IA a navegar pelo índice antes de ler conteúdos
 * - Mantém cada arquivo precedido por `// <file_path>`
 * - Recebe arquivos e pastas por argumentos posicionais
 * - Se o item informado for arquivo, inclui apenas aquele arquivo
 * - Se o item informado for pasta, inclui todos os arquivos de texto dentro dela
 *
 * Regras:
 * - Os alvos (arquivos/pastas) devem ser passados na linha de comando
 * - Ignora o que estiver no `.gitignore`
 * - Considera apenas arquivos de texto
 *
 * Uso:
 *   npx tsx scripts/generate-project-dump.ts --out project-code.txt app components lib middleware.ts
 *   npx tsx scripts/generate-project-dump.ts app components
 */

import * as fs from 'fs';
import * as path from 'path';
import ignore from 'ignore';

type CLIOpts = {
  outPath: string;
  targets: string[];
};

function parseArgs(argv: string[]): CLIOpts {
  const args = [...argv];
  args.shift(); // node
  args.shift(); // script

  let outPath = 'project-code.txt';
  const targets: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--out' && args[i + 1]) {
      outPath = args[i + 1];
      i++;
      continue;
    }

    targets.push(arg);
  }

  return { outPath, targets };
}

const opts = parseArgs(process.argv);

function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

function existsFile(relOrAbsPath: string): boolean {
  const abs = path.resolve(process.cwd(), relOrAbsPath);
  return fs.existsSync(abs) && fs.statSync(abs).isFile();
}

function existsDir(relOrAbsPath: string): boolean {
  const abs = path.resolve(process.cwd(), relOrAbsPath);
  return fs.existsSync(abs) && fs.statSync(abs).isDirectory();
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

// ------------------------ TARGET COLLECTION ------------------------
function collectFilesFromTargets(targets: string[]): {
  files: string[];
  missingTargets: string[];
  ignoredTargets: string[];
  nonTextTargets: string[];
} {
  const collected = new Set<string>();
  const missingTargets: string[] = [];
  const ignoredTargets: string[] = [];
  const nonTextTargets: string[] = [];

  for (const target of targets) {
    const abs = path.resolve(process.cwd(), target);
    const rel = toPosix(path.relative(process.cwd(), abs));

    if (!fs.existsSync(abs)) {
      missingTargets.push(target);
      continue;
    }

    if (ig.ignores(rel)) {
      ignoredTargets.push(rel);
      continue;
    }

    const stat = fs.statSync(abs);

    if (stat.isDirectory()) {
      for (const file of walk(abs)) {
        collected.add(path.resolve(file));
      }
      continue;
    }

    if (stat.isFile()) {
      if (!looksLikeTextFile(abs)) {
        nonTextTargets.push(rel);
        continue;
      }

      collected.add(abs);
    }
  }

  const files = [...collected].sort((a, b) => {
    const relA = toPosix(path.relative(process.cwd(), a));
    const relB = toPosix(path.relative(process.cwd(), b));
    return relA.localeCompare(relB);
  });

  return {
    files,
    missingTargets,
    ignoredTargets,
    nonTextTargets,
  };
}

// ------------------------ AI HEADER ------------------------
function buildAIHeader(
  files: string[],
  originalTargets: string[],
  missingTargets: string[],
  ignoredTargets: string[],
  nonTextTargets: string[],
): string {
  const relFiles = files.map((file) =>
    toPosix(path.relative(process.cwd(), file)),
  );

  const relTargets = originalTargets.map((target) =>
    toPosix(path.relative(process.cwd(), path.resolve(process.cwd(), target))),
  );

  const lines: string[] = [
    '// ============================================================',
    '// PROJECT CODE DUMP',
    '// ============================================================',
    '//',
    '// PURPOSE',
    '// This document aggregates selected project files to enable efficient AI-assisted analysis and changes.',
    '// The included files were collected ONLY from the explicit inputs (files/folders) passed to the script.',
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
    '// MANDATORY RESPONSE STRUCTURE',
    '// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    '// Your reply MUST follow this exact structure — every section is required:',
    '//',
    '//   ── PLAN ──',
    '//   Ordered steps you will take. List every affected file: existing, new, or deleted.',
    '//   Be concise and specific. No vague descriptions.',
    '//',
    '//   ── CHANGES ──',
    '//   All code output MUST use Markdown code blocks with the language identifier.',
    '//   Every file MUST be preceded by its path as a comment, then immediately followed by its code block.',
    '//',
    '//   Format for each file:',
    '//',
    '//   // <file_path>',
    '//   ```<lang>',
    '//   <file content>',
    '//   ```',
    '//',
    '//   Example:',
    '//   // app/components/Button.tsx',
    '//   ```tsx',
    '//   export function Button() { ... }',
    '//   ```',
    '//',
    '//   ┌─ FULL FILE vs PARTIAL UPDATE — DECISION RULE ───────────────┐',
    '//   │                                                             │',
    '//   │  ≤ ~1000 lines  →  ALWAYS return the FULL FILE.             │',
    '//   │  > ~1000 lines  →  MAY return PARTIAL UPDATE (see below).   │',
    '//   │                                                             │',
    '//   │  When in doubt, prefer FULL FILE. Only use partial updates  │',
    '//   │  when the file is clearly large and returning it fully      │',
    '//   │  would add substantial noise with no benefit.               │',
    '//   └─────────────────────────────────────────────────────────────┘',
    '//',
    '//   PARTIAL UPDATE format (only for files > ~1000 lines):',
    '//',
    '//   // <file_path>',
    '//   [PARTIAL UPDATE]',
    '//',
    '//   Change 1',
    '//   - Operation : REPLACE BLOCK | INSERT AFTER BLOCK | INSERT BEFORE BLOCK | DELETE BLOCK',
    '//   - Block type: function | class | component | hook | method | type | interface |',
    '//                 constant block | JSX block | other identifiable logical block',
    '//   - Location  : exact name of the enclosing function/component/class/block + approx. line range',
    '//   - Search anchor:',
    '//   ```<lang>',
    '//   <unique existing snippet that unambiguously locates the block>',
    '//   ```',
    '//   - Replacement:',
    '//   ```<lang>',
    '//   <full replacement block>',
    '//   ```',
    '//',
    '//   Change 2',
    '//   - Operation : ...',
    '//   (repeat for each change in the same file)',
    '//',
    '//   Rules for partial updates:',
    '//   • Prefer replacing WHOLE LOGICAL BLOCKS (full function, component, hook, class, type, JSX section)',
    '//     even when only a few lines inside changed. Avoid line-level micro-patches.',
    '//   • Search anchors MUST be unique in the file. Use function names, exports, type declarations,',
    '//     component names, or distinctive comments as anchors.',
    '//   • For INSERT operations, supply both the full anchor block and the full block to insert.',
    '//   • For DELETE, supply the exact block to remove and clearly state its location.',
    '//   • Every change MUST be precise enough for a developer to apply without ambiguity.',
    '//   • Number changes sequentially when multiple edits target the same file.',
    '//   • NEVER write vague instructions like "update this function accordingly".',
    '//     Always provide the exact code.',
    '//',
    '//   ── DOCS ──',
    '//   Update or create documentation to reflect the changes:',
    '//   • README or docs/*.md files impacted by the changes',
    '//   • Inline code comments and JSDoc/TSDoc blocks where relevant',
    '//   • Usage examples if any API or public behavior changed',
    '//   Apply the same FULL FILE / PARTIAL UPDATE rule as for code files.',
    '//',
    '//   ── NOTES ──',
    '//   • Justify key architectural decisions and trade-offs.',
    '//   • If you chose PARTIAL UPDATE for any file, briefly explain why.',
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
    '// - ALL code output MUST be inside Markdown code blocks (``` fences).',
    '// - Every file block MUST be preceded by // <file_path>.',
    '// - Files with ≤ ~500 lines MUST be returned in full. No exceptions.',
    '// - The FILE INDEX is a navigation aid only; actual content follows BEGIN FILE CONTENTS.',
    '// - If a path appears in both the index and the content area, the content area is authoritative.',
    '//',
    '// INPUT TARGETS:',
    ...relTargets.map((rel) => `// ${rel}`),
    '//',
  ];

  if (missingTargets.length > 0) {
    lines.push('// MISSING TARGETS:');
    lines.push(
      ...missingTargets.map((target) => {
        const rel = toPosix(
          path.relative(process.cwd(), path.resolve(process.cwd(), target)),
        );
        return `// ${rel}`;
      }),
    );
    lines.push('//');
  }

  if (ignoredTargets.length > 0) {
    lines.push('// IGNORED TARGETS (.gitignore):');
    lines.push(...ignoredTargets.map((rel) => `// ${rel}`));
    lines.push('//');
  }

  if (nonTextTargets.length > 0) {
    lines.push('// NON-TEXT TARGETS SKIPPED:');
    lines.push(...nonTextTargets.map((rel) => `// ${rel}`));
    lines.push('//');
  }

  lines.push('// FILE INDEX:');
  lines.push(...relFiles.map((rel) => `// ${rel}`));
  lines.push('//');
  lines.push('// ============================================================');
  lines.push('// BEGIN FILE CONTENTS');
  lines.push('// ============================================================');
  lines.push('');

  return lines.join('\n');
}

// ------------------------ BUILD OUTPUT ------------------------
function generateDump(): string {
  if (opts.targets.length === 0) {
    return [
      '// ============================================================',
      '// PROJECT CODE DUMP',
      '// ============================================================',
      '// No input targets were provided.',
      '//',
      '// Pass files and/or folders as positional arguments, for example:',
      '//   npx tsx scripts/generate-project-dump.ts --out project-code.txt app components lib middleware.ts',
    ].join('\n');
  }

  const { files, missingTargets, ignoredTargets, nonTextTargets } =
    collectFilesFromTargets(opts.targets);

  if (files.length === 0) {
    return [
      '// ============================================================',
      '// PROJECT CODE DUMP',
      '// ============================================================',
      '// No text files were found from the provided input targets.',
      '//',
      '// Input targets:',
      ...opts.targets.map((target) => {
        const rel = toPosix(
          path.relative(process.cwd(), path.resolve(process.cwd(), target)),
        );
        return `// ${rel}`;
      }),
      ...(missingTargets.length > 0
        ? [
            '//',
            '// Missing targets:',
            ...missingTargets.map((target) => {
              const rel = toPosix(
                path.relative(
                  process.cwd(),
                  path.resolve(process.cwd(), target),
                ),
              );
              return `// ${rel}`;
            }),
          ]
        : []),
      ...(ignoredTargets.length > 0
        ? [
            '//',
            '// Ignored by .gitignore:',
            ...ignoredTargets.map((rel) => `// ${rel}`),
          ]
        : []),
      ...(nonTextTargets.length > 0
        ? [
            '//',
            '// Non-text targets skipped:',
            ...nonTextTargets.map((rel) => `// ${rel}`),
          ]
        : []),
    ].join('\n');
  }

  const out: string[] = [];
  out.push(
    buildAIHeader(
      files,
      opts.targets,
      missingTargets,
      ignoredTargets,
      nonTextTargets,
    ),
  );

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

fs.writeFileSync(resolved, dump, 'utf8');

console.log('\nProject dump generated successfully!');
console.log(`Saved at: ${resolved}\n`);

if (opts.targets.length > 0) {
  console.log('Input targets:');
  for (const target of opts.targets) {
    console.log(`- ${target}`);
  }
  console.log('');
}
