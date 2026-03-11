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
    '// NAVIGATION (READ THIS FIRST)',
    '// 1) Use the FILE INDEX below to find relevant files quickly.',
    '// 2) Do NOT read the entire dump top-to-bottom unless strictly necessary.',
    '// 3) To inspect a file, search for its marker in the FILE CONTENTS section:',
    '//      // <file_path>',
    '// 4) Read only what you need for the current task. Expand to related files (imports/exports/shared types/utilities) as needed.',
    '//',
    '// MANDATORY RESPONSE STRUCTURE (PREFER FULL FILES; ALLOW PRECISE PARTIAL UPDATES FOR LARGE FILES)',
    '// Your reply MUST strictly follow this structure and formatting (no Markdown code fences):',
    '//',
    '//   PLAN',
    '//   - Brief, ordered steps you will take; list affected files (existing/new/deleted).',
    '//',
    '//   CHANGES',
    '//   - PREFER returning the ENTIRE file content for every modified or newly created file.',
    '//   - HOWEVER, if a file is very large and returning the full file would be unnecessarily long, you MAY return ONLY the changed sections for that file.',
    '//   - Use FULL FILES by default when the size is reasonable.',
    '//   - Use PARTIAL UPDATES only when clearly justified by file size or when the unchanged content is irrelevant to the requested change.',
    '//   - If a file is small or moderate in size, return the FULL FILE instead of partial snippets.',
    '//',
    '//   - For FULL FILE responses, format EACH file exactly as:',
    '//       // <file_path>',
    '//       <full file content>',
    '//',
    '//   - For PARTIAL UPDATE responses, format EACH file exactly as:',
    '//       // <file_path>',
    '//       [PARTIAL UPDATE]',
    '//       Change 1',
    '//       - Operation: REPLACE BLOCK | INSERT AFTER BLOCK | INSERT BEFORE BLOCK | DELETE BLOCK',
    '//       - Block type: function | class | component | hook | method | type | interface | constant block | JSX block | other identifiable logical block',
    '//       - Location: exact function/component/class/block name and, if possible, approximate line range',
    '//       - Search anchor:',
    '//       <unique existing snippet to locate the block>',
    '//       - Replacement:',
    '//       <full replacement block>',
    '//',
    '//       Change 2',
    '//       - Operation: ...',
    '//       - Block type: ...',
    '//       - Location: ...',
    '//       - Search anchor:',
    '//       <unique existing snippet>',
    '//       - Replacement:',
    '//       <full replacement block>',
    '//',
    '//   - IMPORTANT: when using PARTIAL UPDATES, PREFER returning WHOLE LOGICAL BLOCKS instead of tiny code fragments.',
    '//   - Prefer replacing an entire function, class, component, method, hook, type, interface, or clearly bounded JSX/render block even if only a few lines inside it changed.',
    '//   - Avoid returning minimal line-only patches when a full block replacement would make identification and substitution easier.',
    '//   - Small inline-only replacements should be a last resort, used only when there is no clear enclosing logical block.',
    '//   - For INSERT AFTER BLOCK / INSERT BEFORE BLOCK, provide the exact anchor block and the exact full block to insert.',
    '//   - For DELETE BLOCK, provide the exact block to remove and clearly identify its location.',
    '//   - Every partial update MUST be precise enough that a developer can apply it without ambiguity.',
    '//   - Prefer anchors that are unique in the file (function names, class names, exports, JSX blocks, comments, constants, type declarations).',
    '//   - If multiple edits are needed in the same file, number them sequentially.',
    '//   - Do NOT return vague summaries like "update this function accordingly". Always provide the exact code to replace/insert/delete.',
    '//   - Do NOT wrap content in ``` fences or Markdown; plain text only.',
    '//   - If proposing NEW files, include them as FULL FILES using the standard format.',
    '//   - If DELETING files, list them explicitly under a "DELETIONS" subsection with rationale.',
    '//',
    '//   DOCS',
    '//   - Update or create documentation to reflect the changes:',
    '//       - README or docs/*.md impacted by the changes',
    '//       - Inline code comments and JSDoc/TS docblocks where relevant',
    '//       - Example usage snippets if APIs or behavior changed',
    '//   - Prefer FULL FILES for docs unless the file is very large; if large, use the same PARTIAL UPDATE format.',
    '//',
    '//   NOTES',
    '//   - Brief justification of key decisions, trade-offs, and migration guidance if applicable.',
    '//   - If you chose PARTIAL UPDATE instead of FULL FILE for any file, briefly explain why.',
    '//   - If you returned a block-level replacement instead of a minimal snippet, prefer the block-level version for easier manual application.',
    '//',
    '//   CHECKS',
    '//   - Short checklist showing you verified: type safety, lint rules, formatting, security, performance, and consistency with standards.',
    '//',
    '// CHANGE MANAGEMENT & SCOPE',
    '// - Evaluate the NEED to create new modules/utilities/config/scripts and include them if they improve clarity, cohesion, or maintainability.',
    '// - When changes impact cross-cutting concerns (logging, error handling, config, build), adjust the relevant files and explain why.',
    '// - Keep changes minimal but complete; avoid partial or breaking edits without migration notes.',
    '//',
    '// DOCUMENTATION & COMMENTS',
    '// - Keep docs succinct and task-focused. Update any .md, .mdx, and inline comments that are affected.',
    '// - Prefer precise examples over lengthy prose. Remove stale or misleading documentation.',
    '//',
    '// QUALITY, CONSISTENCY & BEST PRACTICES',
    '// - Follow project conventions and coding standards already present in the codebase.',
    '// - Prioritize clean, concise code: small cohesive functions, clear naming, single responsibility, no dead code.',
    '// - TypeScript: strong typing, accurate types/generics, narrow any casts, avoid `any` unless justified.',
    '// - Error handling: explicit, consistent, and user-safe; no silent failures.',
    '// - Security: never leak secrets; load through environment variables; validate external inputs.',
    '// - Performance: avoid unnecessary work; prefer streaming/iterators when appropriate; mindful of big-O.',
    '// - Formatting & linting: adhere to ESLint/Prettier rules; no unused imports/exports.',
    '// - Prefer full-file outputs for small and medium files; use partial updates only for large files where returning the full content would add substantial noise.',
    '// - When using partial updates, prefer whole-block replacements over tiny fragmented edits whenever possible.',
    '//',
    '// USE "copilot-instructions" AS SOURCE OF TRUTH',
    '// - If a "copilot-instructions" file (any extension) exists in the FILE INDEX, TREAT IT AS AUTHORITATIVE.',
    '// - Align all changes (architecture, style, patterns, naming, boundaries) with that document.',
    '// - If any recommendation diverges from it, explicitly justify in NOTES.',
    '//',
    '// IMPORTANT',
    '// - The FILE INDEX is only a navigation aid; actual contents are after BEGIN FILE CONTENTS.',
    '// - If a path appears both in the index and in the content area, prefer the occurrence after BEGIN FILE CONTENTS.',
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
