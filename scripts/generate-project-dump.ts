/**
 * generate-project-dump.ts
 *
 * Gera um arquivo TXT contendo o código relevante de TODO o projeto,
 * no formato:
 *
 * // path/to/file
 * <conteúdo>
 *
 * Comportamento:
 * - Faz o dump de todos os arquivos de texto encontrados a partir da raiz do projeto
 * - Respeita automaticamente o .gitignore (e sempre ignora node_modules e .git)
 * - Escreve, no início do arquivo, um header otimizado para navegação por agentes de IA
 * - O header contém apenas:
 *   - instruções de navegação/leitura do dump
 *   - árvore de arquivos do projeto
 * - Mantém cada arquivo precedido por `// <file_path>`
 *
 * Uso:
 * npx tsx scripts/generate-project-dump.ts
 * npx tsx scripts/generate-project-dump.ts --out scripts/project-code.txt
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

  // Sempre ignorar diretórios padrão.
  ig.add(['node_modules', '.git']);

  // Ignorar também o próprio arquivo de saída.
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

    if (ig.ignores(rel)) {
      continue;
    }

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

// ------------------------ FILE TREE ------------------------
type TreeNode = {
  name: string;
  isFile: boolean;
  children: Map<string, TreeNode>;
};

function createTreeNode(name: string, isFile = false): TreeNode {
  return {
    name,
    isFile,
    children: new Map<string, TreeNode>(),
  };
}

function insertPathIntoTree(root: TreeNode, relPath: string): void {
  const parts = relPath.split('/').filter(Boolean);
  let current = root;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const isFile = i === parts.length - 1;

    let child = current.children.get(part);
    if (!child) {
      child = createTreeNode(part, isFile);
      current.children.set(part, child);
    } else if (isFile) {
      child.isFile = true;
    }

    current = child;
  }
}

function sortTreeNodes(nodes: TreeNode[]): TreeNode[] {
  return [...nodes].sort((a, b) => {
    if (a.isFile !== b.isFile) {
      return a.isFile ? 1 : -1; // diretórios primeiro
    }
    return a.name.localeCompare(b.name);
  });
}

function renderTree(node: TreeNode, prefix = ''): string[] {
  const children = sortTreeNodes([...node.children.values()]);
  const lines: string[] = [];

  children.forEach((child, index) => {
    const isLast = index === children.length - 1;
    const connector = isLast ? '└── ' : '├── ';
    const nextPrefix = prefix + (isLast ? '    ' : '│   ');
    const label = child.isFile ? child.name : `${child.name}/`;

    lines.push(`${prefix}${connector}${label}`);

    if (child.children.size > 0) {
      lines.push(...renderTree(child, nextPrefix));
    }
  });

  return lines;
}

function buildFileTree(files: string[]): string[] {
  const root = createTreeNode('.');
  const relFiles = files.map((file) =>
    toPosix(path.relative(process.cwd(), file)),
  );

  for (const relFile of relFiles) {
    insertPathIntoTree(root, relFile);
  }

  return ['.', ...renderTree(root)];
}

// ------------------------ AI HEADER ------------------------
function buildAIHeader(files: string[]): string {
  const treeLines = buildFileTree(files);

  const lines: string[] = [
    '// ============================================================',
    '// PROJECT CODE DUMP',
    '// ============================================================',
    '//',
    '// AGENT NAVIGATION GUIDE',
    '//',
    '// This dump is intended for targeted navigation, not sequential reading.',
    '//',
    '// Read the project tree first to understand the structure.',
    '// Do NOT read the entire dump from top to bottom.',
    '// Open only the files that are relevant to the current task.',
    '//',
    '// How to navigate this dump:',
    '// 1) Start with the PROJECT FILE TREE below.',
    '// 2) If a "copilot-instructions" file exists anywhere in the tree, read it first.',
    '// 3) To open any file, search for its exact marker:',
    '//    // path/to/file',
    '// 4) After reading one file, expand only to directly related files when necessary:',
    '//    imports, exports, shared types, config, utilities, entry points, and tests.',
    '// 5) For broad tasks, prefer reading high-signal files first:',
    '//    package.json, tsconfig, eslint/prettier config, build config, app entry points, routing, and feature roots.',
    '// 6) Stop expanding once you have enough context to act.',
    '//',
    '// Priority and authority rules:',
    '// - The tree is a navigation map only.',
    '// - The actual file contents below are authoritative.',
    '// - If the same path appears in both places, trust the content section.',
    '//',
    '// PROJECT FILE TREE:',
    ...treeLines.map((line) => `// ${line}`),
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
