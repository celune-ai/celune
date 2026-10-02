/**
 * Vault Sync — Obsidian vault → agent_memory bridge.
 *
 * Privacy-first: only files matching .celune-sync allowlist are processed.
 * Uses SHA-256 content hashing for incremental change detection.
 *
 * Flow: read .celune-sync → walk allowed paths → hash → diff → chunk → embed → store
 */

import { createHash } from 'crypto';
import { readFile, readdir, stat, lstat } from 'fs/promises';
import { join, relative, extname, isAbsolute, resolve } from 'path';
import type { createServiceClient } from '@repo/db/service';
import { fireAndForgetEmbedding } from '@/lib/memory-helpers';

type SupabaseClient = ReturnType<typeof createServiceClient>;

const CHUNK_SIZE = 1500;
const CHUNK_OVERLAP = 200;
const MAX_FILE_SIZE = 200_000; // 200KB per file
const MAX_FILES_WALKED = 5000; // prevent large vault from starving cron

/**
 * Validate vault path against allowed root directories.
 * Prevents path traversal attacks (e.g. /etc, /var/secrets).
 */
export function isAllowedVaultRoot(vaultPath: string): boolean {
  if (!isAbsolute(vaultPath)) return false;
  const resolved = resolve(vaultPath);
  const allowedRoots = (process.env.ALLOWED_VAULT_ROOTS ?? '').split(',').filter(Boolean);
  // Default: only allow paths under user's home directory
  const homeDir = process.env.HOME ?? '/Users';
  const roots = allowedRoots.length > 0 ? allowedRoots : [homeDir];
  return roots.some((root) => resolved.startsWith(resolve(root)));
}

// ─── .celune-sync parser ────────────────────────────────────────────────────

export interface SyncConfig {
  /** Glob-like path patterns to include (relative to vault root) */
  allowedPaths: string[];
  /** PARA folder → brain category overrides */
  categoryMap: Record<string, string>;
}

/** Default PARA folder → brain category mapping for Obsidian vaults. */
const DEFAULT_CATEGORY_MAP: Record<string, string> = {
  '00-inbox': 'inbox',
  '01-daily': 'daily-plan',
  '02-personal': 'personal',
  '03-professional': 'professional',
  '04-projects': 'project',
  '05-knowledge': 'reference',
  '06-influences': 'reference',
  '07-archive': 'archive',
};

/**
 * Parse a .celune-sync file into a SyncConfig.
 *
 * Format:
 *   # Comments start with #
 *   # Paths are relative to vault root, gitignore-style
 *   01-daily/
 *   05-knowledge/
 *   04-projects/celune/
 *
 *   # Optional category overrides (key=value after [categories] header)
 *   [categories]
 *   04-projects=project
 *   06-influences=inspiration
 */
export function parseCeluneSync(content: string): SyncConfig {
  const lines = content.split('\n').map((l) => l.trim());
  const allowedPaths: string[] = [];
  const categoryMap: Record<string, string> = { ...DEFAULT_CATEGORY_MAP };
  let inCategorySection = false;

  for (const line of lines) {
    if (!line || line.startsWith('#')) continue;

    if (line === '[categories]') {
      inCategorySection = true;
      continue;
    }

    if (inCategorySection) {
      const eqIdx = line.indexOf('=');
      if (eqIdx > 0) {
        const folder = line.slice(0, eqIdx).trim().replace(/\/$/, '');
        const category = line.slice(eqIdx + 1).trim();
        if (folder && category) categoryMap[folder] = category;
      }
    } else {
      // Path entry — normalize: strip trailing slash, must be non-empty
      const path = line.replace(/\/$/, '');
      if (path) allowedPaths.push(path);
    }
  }

  return { allowedPaths, categoryMap };
}

/**
 * Read and parse .celune-sync from a vault root.
 * Returns null if the file doesn't exist (= nothing syncs).
 */
const MAX_SYNC_CONFIG_SIZE = 100_000; // 100KB max for .celune-sync file

export async function readSyncConfig(vaultPath: string): Promise<SyncConfig | null> {
  try {
    const configPath = join(vaultPath, '.celune-sync');
    const fileStat = await stat(configPath);
    if (fileStat.size > MAX_SYNC_CONFIG_SIZE) return null;
    const content = await readFile(configPath, 'utf-8');
    return parseCeluneSync(content);
  } catch {
    return null; // No .celune-sync = nothing syncs
  }
}

// ─── Path matching ──────────────────────────────────────────────────────────

/** Check if a relative file path is allowed by the sync config. */
export function isPathAllowed(relativePath: string, config: SyncConfig): boolean {
  if (config.allowedPaths.length === 0) return false;
  return config.allowedPaths.some((allowed) => {
    return relativePath === allowed || relativePath.startsWith(allowed + '/');
  });
}

/** Resolve brain category for a file path based on its top-level folder. */
export function resolveCategory(relativePath: string, config: SyncConfig): string {
  // Match the deepest folder first, then fall back to top-level
  const parts = relativePath.split('/');
  for (let i = parts.length - 1; i >= 0; i--) {
    const prefix = parts.slice(0, i + 1).join('/');
    if (config.categoryMap[prefix]) return config.categoryMap[prefix];
  }
  // Try just the top-level folder
  if (parts[0] && config.categoryMap[parts[0]]) {
    return config.categoryMap[parts[0]];
  }
  return 'reference'; // default category
}

// ─── File walking ───────────────────────────────────────────────────────────

interface VaultFile {
  relativePath: string;
  absolutePath: string;
  content: string;
  hash: string;
  category: string;
}

/** Walk vault directory and collect allowed .md files with content + hash. */
export async function collectVaultFiles(
  vaultPath: string,
  config: SyncConfig,
): Promise<VaultFile[]> {
  const files: VaultFile[] = [];

  async function walk(dir: string): Promise<void> {
    if (files.length >= MAX_FILES_WALKED) return;

    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return; // Skip unreadable directories
    }

    for (const entry of entries) {
      if (files.length >= MAX_FILES_WALKED) return;

      const fullPath = join(dir, entry.name);
      const relPath = relative(vaultPath, fullPath);

      // Skip hidden files/folders, node_modules, and symlinks (prevent traversal)
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      if (entry.isSymbolicLink()) continue;

      // Double-check with lstat for symlinks that readdir may not flag
      try {
        const lstats = await lstat(fullPath);
        if (lstats.isSymbolicLink()) continue;
      } catch {
        continue;
      }

      if (entry.isDirectory()) {
        // Only recurse into allowed paths
        const isAllowedDir = config.allowedPaths.some(
          (p) => relPath === p || relPath.startsWith(p + '/') || p.startsWith(relPath + '/'),
        );
        if (isAllowedDir) await walk(fullPath);
      } else if (entry.isFile() && extname(entry.name) === '.md') {
        if (!isPathAllowed(relPath, config)) continue;

        try {
          const fileStat = await stat(fullPath);
          if (fileStat.size > MAX_FILE_SIZE) continue;

          const content = await readFile(fullPath, 'utf-8');
          if (content.trim().length < 50) continue; // Skip near-empty files

          const hash = createHash('sha256').update(content).digest('hex');
          const category = resolveCategory(relPath, config);

          files.push({ relativePath: relPath, absolutePath: fullPath, content, hash, category });
        } catch {
          // Skip unreadable files
        }
      }
    }
  }

  await walk(vaultPath);
  return files;
}

// ─── Chunking ───────────────────────────────────────────────────────────────

/** Extract frontmatter from markdown content. */
function extractFrontmatter(content: string): { frontmatter: string; body: string } {
  if (!content.startsWith('---')) return { frontmatter: '', body: content };
  const endIdx = content.indexOf('---', 3);
  if (endIdx === -1) return { frontmatter: '', body: content };
  return {
    frontmatter: content.slice(3, endIdx).trim(),
    body: content.slice(endIdx + 3).trim(),
  };
}

/** Split text into overlapping chunks at sentence/paragraph boundaries. */
function chunkText(text: string): string[] {
  if (text.length <= CHUNK_SIZE) return [text];

  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = start + CHUNK_SIZE;
    if (end >= text.length) {
      chunks.push(text.slice(start).trim());
      break;
    }

    // Find paragraph or sentence boundary near chunk end
    const segment = text.slice(start, end + 100);
    const paraEnd = segment.lastIndexOf('\n\n', CHUNK_SIZE);
    if (paraEnd > CHUNK_SIZE * 0.6) {
      end = start + paraEnd + 2;
    } else {
      const sentenceEnd = segment.lastIndexOf('. ', CHUNK_SIZE);
      if (sentenceEnd > CHUNK_SIZE * 0.6) {
        end = start + sentenceEnd + 2;
      }
    }

    chunks.push(text.slice(start, end).trim());
    start = end - CHUNK_OVERLAP;
  }

  return chunks.filter((c) => c.length > 50);
}

// ─── Sync engine ────────────────────────────────────────────────────────────

export interface VaultSyncResult {
  filesProcessed: number;
  filesSkipped: number;
  chunksCreated: number;
  errors: string[];
}

/**
 * Main vault sync pipeline.
 *
 * 1. Read .celune-sync allowlist
 * 2. Walk allowed paths, hash files
 * 3. Compare hashes to stored state — only process changed files
 * 4. Chunk changed files → upsert into agent_memory
 * 5. Clean up removed files
 * 6. Update vault_sync_sources with new hashes
 */
export async function syncVault(
  supabase: SupabaseClient,
  workspaceId: string,
  vaultPath: string,
  storedHashes: unknown,
): Promise<VaultSyncResult> {
  // Validate storedHashes is a proper object (could be null/corrupt from JSONB)
  const safeHashes: Record<string, string> =
    storedHashes && typeof storedHashes === 'object' && !Array.isArray(storedHashes)
      ? (storedHashes as Record<string, string>)
      : {};
  const result: VaultSyncResult = {
    filesProcessed: 0,
    filesSkipped: 0,
    chunksCreated: 0,
    errors: [],
  };

  // 1. Read .celune-sync
  const config = await readSyncConfig(vaultPath);
  if (!config || config.allowedPaths.length === 0) {
    result.errors.push('No .celune-sync file or no allowed paths configured');
    return result;
  }

  // 2. Collect files
  const files = await collectVaultFiles(vaultPath, config);

  // 3. Compare hashes — find changed files
  const newHashes: Record<string, string> = {};
  const changedFiles: VaultFile[] = [];

  for (const file of files) {
    newHashes[file.relativePath] = file.hash;
    if (safeHashes[file.relativePath] === file.hash) {
      result.filesSkipped++;
    } else {
      changedFiles.push(file);
    }
  }

  // 4. Process changed files
  for (const file of changedFiles) {
    try {
      const { body } = extractFrontmatter(file.content);
      const chunks = chunkText(body);

      // Build memory rows
      const rows = chunks.map((chunk, i) => ({
        key: `vault-sync:${workspaceId}:${file.relativePath}:chunk-${i}`,
        content: chunk,
        category: file.category,
        memory_type: 'knowledge' as const,
        source: 'vault-sync',
        importance_score: 0.5,
        workspace_id: workspaceId,
        is_archived: false,
        is_core: false,
        tags: ['vault-sync', file.category],
        metadata: {
          vault_path: file.relativePath,
          chunk_index: i,
          total_chunks: chunks.length,
          content_hash: file.hash,
        },
      }));

      const { data, error } = await supabase
        .from('agent_memory')
        .upsert(rows, { onConflict: 'key' })
        .select('id, key');

      if (error) {
        result.errors.push(`Upsert failed for ${file.relativePath}: ${error.message}`);
        continue;
      }

      const stored = data?.length ?? 0;
      result.chunksCreated += stored;
      result.filesProcessed++;

      // Fire-and-forget embeddings
      if (data) {
        for (const row of data) {
          const chunkIdx = parseInt(row.key.split(':').pop()?.replace('chunk-', '') ?? '0', 10);
          const chunk = chunks[chunkIdx];
          if (chunk) fireAndForgetEmbedding(supabase, row.id, chunk);
        }
      }
    } catch (err) {
      result.errors.push(
        `Failed processing ${file.relativePath}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // 5. Clean up removed files — delete memories for files no longer in vault/allowlist
  const removedPaths = Object.keys(safeHashes).filter((p) => !newHashes[p]);
  for (const removedPath of removedPaths) {
    // Escape LIKE metacharacters to prevent wildcard injection from persisted paths
    const escapedPath = removedPath.replace(/[%_\\]/g, '\\$&');
    await supabase
      .from('agent_memory')
      .delete()
      .eq('workspace_id', workspaceId)
      .eq('source', 'vault-sync')
      .like('key', `vault-sync:${workspaceId}:${escapedPath}:%`);
  }

  // 6. Update vault_sync_sources with new hashes
  await supabase
    .from('vault_sync_sources')
    .update({
      file_hashes: newHashes,
      files_synced: Object.keys(newHashes).length,
      chunks_created: result.chunksCreated,
      sync_config: config,
      last_synced_at: new Date().toISOString(),
      status: result.errors.length > 0 && result.filesProcessed === 0 ? 'failed' : 'complete',
      updated_at: new Date().toISOString(),
    })
    .eq('workspace_id', workspaceId)
    .eq('vault_path', vaultPath);

  return result;
}
