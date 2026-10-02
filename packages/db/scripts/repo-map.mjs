#!/usr/bin/env node

/**
 * AST Repo Map — Parses the monorepo with ts-morph to produce a structured
 * map of files, exports, and imports. Used for context pruning (only feed
 * relevant files to agents) and PageRank-based file relevance scoring.
 *
 * Usage:
 *   node packages/db/scripts/repo-map.mjs [--out <path>] [--format tree|json] [--top <n>]
 *
 * Outputs:
 *   - JSON map: { files: [{ path, exports, imports, size }], graph: { edges } }
 *   - Or tree view: condensed text representation for prompt injection
 *
 * Performance target: parse 300+ files in <10 seconds.
 */

import { Project, SyntaxKind } from 'ts-morph';
import { resolve, relative, dirname } from 'path';
import { existsSync, writeFileSync, readFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = resolve(__dirname, '../../..');

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = argv.slice(2);
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    }
  }
  return flags;
}

// ---------------------------------------------------------------------------
// tsconfig discovery
// ---------------------------------------------------------------------------

const PROJECTS = [
  'apps/platform/tsconfig.json',
  'packages/db/tsconfig.json',
  'packages/types/tsconfig.json',
  'packages/ui/tsconfig.json',
];

// ---------------------------------------------------------------------------
// Extract exports from a source file
// ---------------------------------------------------------------------------

function extractExports(sourceFile) {
  const exports = [];

  // Named exports: export function foo, export class Bar, export const baz
  for (const decl of sourceFile.getExportedDeclarations()) {
    const [name, nodes] = decl;
    for (const node of nodes) {
      const kind = node.getKindName();
      let type = 'unknown';

      if (kind === 'FunctionDeclaration' || kind === 'ArrowFunction') {
        type = 'function';
      } else if (kind === 'ClassDeclaration') {
        type = 'class';
      } else if (kind === 'InterfaceDeclaration') {
        type = 'interface';
      } else if (kind === 'TypeAliasDeclaration') {
        type = 'type';
      } else if (kind === 'EnumDeclaration') {
        type = 'enum';
      } else if (kind === 'VariableDeclaration') {
        // React components: PascalCase (not ALL_CAPS constants)
        if (/^[A-Z][a-z]/.test(name)) {
          type = 'component';
        } else {
          type = 'variable';
        }
      } else if (kind === 'SourceFile') {
        // Re-export from another module
        type = 're-export';
      }

      exports.push({ name, type });
    }
  }

  return exports;
}

// ---------------------------------------------------------------------------
// Extract imports from a source file
// ---------------------------------------------------------------------------

function extractImports(sourceFile) {
  const imports = [];

  for (const imp of sourceFile.getImportDeclarations()) {
    const moduleSpecifier = imp.getModuleSpecifierValue();
    const namedImports = imp.getNamedImports().map((n) => n.getName());
    const defaultImport = imp.getDefaultImport()?.getText() ?? null;
    const namespaceImport = imp.getNamespaceImport()?.getText() ?? null;

    imports.push({
      from: moduleSpecifier,
      names: namedImports,
      default: defaultImport,
      namespace: namespaceImport,
    });
  }

  return imports;
}

// ---------------------------------------------------------------------------
// Resolve import specifier to a file path (for internal imports)
// ---------------------------------------------------------------------------

function resolveImportPath(importFrom, sourceFilePath, allFilePaths) {
  // Skip external packages
  if (
    !importFrom.startsWith('.') &&
    !importFrom.startsWith('@/') &&
    !importFrom.startsWith('@repo/')
  ) {
    return null;
  }

  // @repo/* workspace imports
  if (importFrom.startsWith('@repo/')) {
    const parts = importFrom.replace('@repo/', '').split('/');
    const pkg = parts[0]; // e.g., "ui", "db", "types"
    const subpath = parts.slice(1).join('/');

    // Check exports map in package.json
    const pkgJsonPath = resolve(MONOREPO_ROOT, `packages/${pkg}/package.json`);
    if (existsSync(pkgJsonPath)) {
      const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
      const exportsMap = pkgJson.exports || {};

      // Try matching the subpath
      const exportKey = subpath ? `./${subpath}` : '.';
      const exportValue = exportsMap[exportKey];
      if (exportValue) {
        const resolved =
          typeof exportValue === 'string' ? exportValue : exportValue.import || exportValue.default;
        if (resolved) {
          const fullPath = resolve(MONOREPO_ROOT, `packages/${pkg}`, resolved);
          const rel = relative(MONOREPO_ROOT, fullPath);
          return allFilePaths.find((f) => f === rel || f.startsWith(rel.replace(/\.[^.]+$/, '')));
        }
      }
    }

    // Fallback: try common patterns
    const candidates = [
      `packages/${pkg}/src/${subpath || 'index'}.ts`,
      `packages/${pkg}/src/${subpath || 'index'}.tsx`,
      `packages/${pkg}/src/${subpath || 'index'}/index.ts`,
      `packages/${pkg}/src/${subpath || 'index'}/index.tsx`,
    ];
    for (const c of candidates) {
      if (allFilePaths.includes(c)) return c;
    }
    return null;
  }

  // @/* path alias (relative to app's src/)
  if (importFrom.startsWith('@/')) {
    const appDir = sourceFilePath.split('/').slice(0, 2).join('/'); // e.g., "apps/platform"
    const subpath = importFrom.replace('@/', '');
    const candidates = [
      `${appDir}/src/${subpath}.ts`,
      `${appDir}/src/${subpath}.tsx`,
      `${appDir}/src/${subpath}/index.ts`,
      `${appDir}/src/${subpath}/index.tsx`,
    ];
    for (const c of candidates) {
      if (allFilePaths.includes(c)) return c;
    }
    return null;
  }

  // Relative imports
  const sourceDir = dirname(sourceFilePath);
  const resolved = resolve(MONOREPO_ROOT, sourceDir, importFrom);
  const rel = relative(MONOREPO_ROOT, resolved);
  const candidates = [`${rel}.ts`, `${rel}.tsx`, `${rel}/index.ts`, `${rel}/index.tsx`, rel];
  for (const c of candidates) {
    if (allFilePaths.includes(c)) return c;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Build the repo map
// ---------------------------------------------------------------------------

function buildRepoMap() {
  const start = Date.now();

  // Create a single ts-morph project with all tsconfigs
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    compilerOptions: {
      allowJs: true,
      jsx: 4, // react-jsx
      moduleResolution: 100, // bundler
      target: 4, // ES2017
      strict: true,
      skipLibCheck: true,
    },
  });

  // Add source files from all projects, excluding node_modules, .next, dist
  const globs = ['apps/*/src/**/*.{ts,tsx}', 'packages/*/src/**/*.{ts,tsx}'];

  for (const glob of globs) {
    project.addSourceFilesAtPaths(resolve(MONOREPO_ROOT, glob));
  }

  const sourceFiles = project.getSourceFiles();
  const allFilePaths = sourceFiles.map((sf) => relative(MONOREPO_ROOT, sf.getFilePath()));

  const files = [];
  const edges = []; // { from: path, to: path }

  for (const sf of sourceFiles) {
    const filePath = relative(MONOREPO_ROOT, sf.getFilePath());

    // Skip .next, node_modules, dist, test files for map (keep tests in graph though)
    if (
      filePath.includes('.next/') ||
      filePath.includes('node_modules/') ||
      filePath.includes('/dist/')
    ) {
      continue;
    }

    const fileExports = extractExports(sf);
    const fileImports = extractImports(sf);
    const lineCount = sf.getEndLineNumber();

    // Resolve internal imports to file paths
    const resolvedImports = [];
    for (const imp of fileImports) {
      const resolved = resolveImportPath(imp.from, filePath, allFilePaths);
      if (resolved) {
        resolvedImports.push(resolved);
        edges.push({ from: filePath, to: resolved });
      }
    }

    files.push({
      path: filePath,
      lines: lineCount,
      exports: fileExports,
      imports: fileImports.map((i) => i.from),
      internalImports: resolvedImports,
    });
  }

  const elapsed = Date.now() - start;

  return { files, edges, elapsed, fileCount: files.length };
}

// ---------------------------------------------------------------------------
// PageRank computation
// ---------------------------------------------------------------------------

function computePageRank(files, edges, iterations = 20, damping = 0.85) {
  const n = files.length;
  if (n === 0) return {};

  const pathToIdx = {};
  files.forEach((f, i) => {
    pathToIdx[f.path] = i;
  });

  // Build adjacency: incoming links
  const inLinks = Array.from({ length: n }, () => []);
  const outDegree = new Array(n).fill(0);

  for (const edge of edges) {
    const fromIdx = pathToIdx[edge.from];
    const toIdx = pathToIdx[edge.to];
    if (fromIdx !== undefined && toIdx !== undefined && fromIdx !== toIdx) {
      inLinks[toIdx].push(fromIdx);
      outDegree[fromIdx]++;
    }
  }

  // Initialize ranks
  let ranks = new Array(n).fill(1 / n);

  for (let iter = 0; iter < iterations; iter++) {
    const newRanks = new Array(n).fill((1 - damping) / n);
    for (let i = 0; i < n; i++) {
      for (const j of inLinks[i]) {
        if (outDegree[j] > 0) {
          newRanks[i] += damping * (ranks[j] / outDegree[j]);
        }
      }
    }
    ranks = newRanks;
  }

  const result = {};
  files.forEach((f, i) => {
    result[f.path] = ranks[i];
  });
  return result;
}

// ---------------------------------------------------------------------------
// Task-based keyword boosting
// ---------------------------------------------------------------------------

function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

function boostByTask(files, ranks, taskDescription) {
  const tokens = tokenize(taskDescription);
  if (tokens.length === 0) return ranks;

  const boosted = { ...ranks };

  for (const file of files) {
    const searchable = [file.path, ...file.exports.map((e) => e.name), ...file.imports]
      .join(' ')
      .toLowerCase();

    let matchCount = 0;
    for (const token of tokens) {
      if (searchable.includes(token)) matchCount++;
    }

    if (matchCount > 0) {
      const boostFactor = 1 + matchCount / tokens.length;
      boosted[file.path] = (boosted[file.path] || 0) * boostFactor;
    }
  }

  return boosted;
}

// ---------------------------------------------------------------------------
// Tree view formatter
// ---------------------------------------------------------------------------

function formatTree(files, ranks, topN) {
  // Sort by PageRank descending
  const sorted = [...files]
    .map((f) => ({ ...f, rank: ranks[f.path] || 0 }))
    .sort((a, b) => b.rank - a.rank);

  const displayed = topN ? sorted.slice(0, topN) : sorted;

  const lines = ['# Repo Map (by relevance)', ''];

  // Group by directory
  const groups = {};
  for (const f of displayed) {
    const parts = f.path.split('/');
    const dir = parts.slice(0, -1).join('/');
    if (!groups[dir]) groups[dir] = [];
    groups[dir].push(f);
  }

  for (const [dir, dirFiles] of Object.entries(groups)) {
    lines.push(`## ${dir}/`);
    for (const f of dirFiles) {
      const fileName = f.path.split('/').pop();
      const exportNames = f.exports
        .filter((e) => e.type !== 're-export')
        .map((e) => {
          const prefix =
            e.type === 'component'
              ? '*'
              : e.type === 'function'
                ? 'f'
                : e.type === 'type' || e.type === 'interface'
                  ? 'T'
                  : '';
          return prefix ? `${prefix}:${e.name}` : e.name;
        })
        .join(', ');
      const rankStr = (f.rank * 1000).toFixed(1);
      lines.push(`  ${fileName} (${f.lines}L, r=${rankStr}) → ${exportNames || '(no exports)'}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Caching
// ---------------------------------------------------------------------------

const CACHE_DIR = resolve(MONOREPO_ROOT, '.cache');
const CACHE_FILE = resolve(CACHE_DIR, 'repo-map.json');

function getGitHash() {
  try {
    // Hash of all tracked TS/TSX file content (fast via git)
    return execSync('git ls-files -s -- "*.ts" "*.tsx" | git hash-object --stdin', {
      cwd: MONOREPO_ROOT,
      encoding: 'utf-8',
    }).trim();
  } catch {
    return null;
  }
}

function loadCache() {
  if (!existsSync(CACHE_FILE)) return null;
  try {
    const raw = readFileSync(CACHE_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveCache(data, gitHash) {
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(CACHE_FILE, JSON.stringify({ gitHash, ...data }), 'utf-8');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const flags = parseArgs(process.argv);

  if (flags.help) {
    console.log(`repo-map.mjs — AST-based monorepo map for context pruning.

Usage:
  node packages/db/scripts/repo-map.mjs [--out <path>] [--format tree|json] [--top <n>] [--task "description"]

Flags:
  --out      Write output to file (default: stdout)
  --format   Output format: json (default) or tree (condensed text for prompts)
  --top      Only show top N files by PageRank relevance
  --task     Task description for keyword-boosted relevance scoring
  --force    Skip cache and force full reparse
  --help     Show this help`);
    process.exit(0);
  }

  const format = flags.format || 'json';
  const topN = flags.top ? parseInt(flags.top, 10) : null;

  let files, edges, elapsed, fileCount;

  // Check cache
  const gitHash = getGitHash();
  const cached = !flags.force ? loadCache() : null;

  if (cached && gitHash && cached.gitHash === gitHash) {
    console.error(`Cache hit (${CACHE_FILE})`);
    files = cached.files;
    edges = cached.edges;
    elapsed = 0;
    fileCount = files.length;
  } else {
    console.error('Parsing monorepo...');
    const result = buildRepoMap();
    files = result.files;
    edges = result.edges;
    elapsed = result.elapsed;
    fileCount = result.fileCount;
    console.error(`Parsed ${fileCount} files in ${elapsed}ms`);

    // Save to cache
    if (gitHash) {
      saveCache({ files, edges }, gitHash);
      console.error(`Cache saved to ${CACHE_FILE}`);
    }
  }

  console.error('Computing PageRank...');
  let ranks = computePageRank(files, edges);

  if (flags.task) {
    console.error(`Boosting for task: "${flags.task.slice(0, 60)}..."`);
    ranks = boostByTask(files, ranks, flags.task);
  }

  let output;
  if (format === 'tree') {
    output = formatTree(files, ranks, topN);
  } else {
    // Add rank to each file for JSON output
    const rankedFiles = files.map((f) => ({
      ...f,
      rank: parseFloat((ranks[f.path] || 0).toFixed(6)),
    }));

    // Sort by rank descending
    rankedFiles.sort((a, b) => b.rank - a.rank);

    if (topN) {
      rankedFiles.splice(topN);
    }

    output = JSON.stringify(
      {
        generated: new Date().toISOString(),
        fileCount,
        edgeCount: edges.length,
        parseTimeMs: elapsed,
        files: rankedFiles,
        edges,
      },
      null,
      2,
    );
  }

  if (flags.out) {
    writeFileSync(flags.out, output, 'utf-8');
    console.error(`Written to ${flags.out}`);
  } else {
    console.log(output);
  }
}

main();
