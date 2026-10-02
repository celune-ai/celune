/**
 * Brain data export/import.
 *
 * Export streams a versioned JSON document covering agent_memory,
 * memory_relations (the knowledge graph edges), and brain_manifest with
 * its section hashes. Import validates the format version and merges or
 * overwrites the calling workspace's rows.
 */
import { createHash, randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import type { createServiceClient } from '@repo/db/service';

type Db = ReturnType<typeof createServiceClient>;

export const BRAIN_EXPORT_FORMAT = 'celune-brain';
export const BRAIN_FORMAT_VERSION = 1;
export const SUPPORTED_FORMAT_VERSIONS: readonly number[] = [1];

const PAGE_SIZE = 500;
const INSERT_BATCH = 200;
/** Above this many rows the export is gzipped unless the caller opts out. */
export const COMPRESS_ROW_THRESHOLD = 5000;
export const MAX_IMPORT_BYTES = 50 * 1024 * 1024;
export const MAX_DECOMPRESSED_BYTES = 200 * 1024 * 1024;

export const importQuerySchema = z.object({
  mode: z.enum(['merge', 'overwrite']).default('merge'),
});
export type ImportMode = z.infer<typeof importQuerySchema>['mode'];

/** Errors with client-safe messages written by this module. */
export class BrainTransferError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = 'BrainTransferError';
  }

  toResponse(): NextResponse {
    return NextResponse.json({ error: this.message, code: this.code }, { status: this.status });
  }
}

const MEMORY_COLUMNS = [
  'id',
  'key',
  'category',
  'memory_type',
  'content',
  'abstract',
  'overview',
  'tags',
  'source',
  'agent_id',
  'version',
  'importance_score',
  'is_core',
  'is_archived',
  'access_count',
  'last_accessed_at',
  'expires_at',
  'created_at',
  'updated_at',
] as const;

const RELATION_COLUMNS = [
  'id',
  'memory_id',
  'related_type',
  'related_id',
  'relation_type',
  'confidence',
  'is_auto_detected',
  'detected_by',
  'created_at',
] as const;

const MANIFEST_COLUMNS = [
  'id',
  'path',
  'content_hash',
  'version',
  'tier',
  'category',
  'ownership_scope',
  'integration_group',
  'is_core',
  'is_forked',
  'forked_at',
  'update_available',
  'update_summary',
  'description',
  'tags',
  'skill_pack_id',
  'install_source',
  'is_enabled',
  'quality_score',
  'created_at',
  'updated_at',
] as const;

const SECTION_COLUMNS = [
  'manifest_id',
  'section_key',
  'content_hash',
  'is_forked',
  'update_available',
  'update_summary',
] as const;

const uuid = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'must be a UUID');
const isoDate = z.string().max(64);

const memoryRowSchema = z.object({
  id: uuid,
  key: z.string().min(1).max(200),
  category: z.string().max(200),
  memory_type: z.string().max(50).optional(),
  content: z.string(),
  abstract: z.string().max(500).nullable().optional(),
  overview: z.string().nullable().optional(),
  tags: z.string().nullable().optional(),
  source: z.string().max(200).nullable().optional(),
  agent_id: z.string().max(200).optional(),
  version: z.number().int().optional(),
  importance_score: z.number().min(0).max(1).optional(),
  is_core: z.boolean().optional(),
  is_archived: z.boolean().optional(),
  access_count: z.number().int().optional(),
  last_accessed_at: isoDate.nullable().optional(),
  expires_at: isoDate.nullable().optional(),
  created_at: isoDate.optional(),
  updated_at: isoDate.optional(),
});

const relationRowSchema = z.object({
  id: uuid,
  memory_id: uuid,
  related_type: z.enum(['task', 'skill', 'memory']),
  related_id: uuid,
  relation_type: z.string().max(50),
  confidence: z.number().min(0).max(1).optional(),
  is_auto_detected: z.boolean().optional(),
  detected_by: z.string().max(200).nullable().optional(),
  created_at: isoDate.optional(),
});

const sectionRowSchema = z.object({
  section_key: z.string().max(500),
  content_hash: z.string().max(200),
  is_forked: z.boolean().optional(),
  update_available: z.boolean().optional(),
  update_summary: z.string().nullable().optional(),
});

const manifestRowSchema = z.object({
  id: uuid,
  path: z.string().min(1).max(1000),
  content_hash: z.string().max(200),
  version: z.string().max(50).optional(),
  tier: z.string().max(50),
  category: z.string().max(50),
  ownership_scope: z.string().max(50).optional(),
  integration_group: z.string().max(100).nullable().optional(),
  is_core: z.boolean().optional(),
  is_forked: z.boolean().optional(),
  forked_at: isoDate.nullable().optional(),
  update_available: z.boolean().optional(),
  update_summary: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  skill_pack_id: uuid.nullable().optional(),
  install_source: z.string().max(50).optional(),
  is_enabled: z.boolean().optional(),
  quality_score: z.number().min(0).max(1).nullable().optional(),
  created_at: isoDate.optional(),
  updated_at: isoDate.optional(),
  sections: z.array(sectionRowSchema).optional(),
});

const exportFileSchema = z.object({
  format: z.literal(BRAIN_EXPORT_FORMAT),
  format_version: z.number().int(),
  exported_at: z.string().optional(),
  source: z.object({ workspace_id: z.string().optional() }).optional(),
  counts: z.record(z.string(), z.number()).optional(),
  agent_memory: z.array(memoryRowSchema).default([]),
  memory_relations: z.array(relationRowSchema).default([]),
  brain_manifest: z.array(manifestRowSchema).default([]),
});

export type BrainExportFile = z.infer<typeof exportFileSchema>;
type MemoryRow = z.infer<typeof memoryRowSchema>;
type RelationRow = z.infer<typeof relationRowSchema>;
type ManifestRow = z.infer<typeof manifestRowSchema>;

export interface ExportCounts {
  agent_memory: number;
  memory_relations: number;
  brain_manifest: number;
}

export interface TableResult {
  inserted: number;
  skipped: number;
}

export interface ImportResult {
  mode: ImportMode;
  format_version: number;
  counts: {
    agent_memory: TableResult;
    memory_relations: TableResult;
    brain_manifest: TableResult;
  };
  deleted?: { agent_memory: number; memory_relations: number; brain_manifest: number };
}

function contentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

async function countRows(db: Db, table: string, workspaceId: string): Promise<number> {
  const { count, error } = await db
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId);
  if (error) throw error;
  return count ?? 0;
}

async function* pageRows<T>(
  db: Db,
  table: string,
  columns: readonly string[],
  workspaceId: string,
): AsyncGenerator<T[]> {
  let from = 0;
  for (;;) {
    const { data, error } = await db
      .from(table)
      .select(columns.join(', '))
      .eq('workspace_id', workspaceId)
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const rows = (data ?? []) as T[];
    if (rows.length === 0) return;
    yield rows;
    if (rows.length < PAGE_SIZE) return;
    from += PAGE_SIZE;
  }
}

async function chunked<T>(items: T[], size: number, fn: (chunk: T[]) => Promise<void>) {
  for (let i = 0; i < items.length; i += size) {
    await fn(items.slice(i, i + size));
  }
}

export async function getExportCounts(db: Db, workspaceId: string): Promise<ExportCounts> {
  const [agent_memory, memory_relations, brain_manifest] = await Promise.all([
    countRows(db, 'agent_memory', workspaceId),
    countRows(db, 'memory_relations', workspaceId),
    countRows(db, 'brain_manifest', workspaceId),
  ]);
  return { agent_memory, memory_relations, brain_manifest };
}

async function attachSections(db: Db, manifests: Record<string, unknown>[]) {
  const ids = manifests.map((m) => m.id as string);
  const { data, error } = await db
    .from('brain_section_hashes')
    .select(SECTION_COLUMNS.join(', '))
    .in('manifest_id', ids);
  if (error) throw error;
  const byManifest = new Map<string, Record<string, unknown>[]>();
  for (const section of (data ?? []) as unknown as Record<string, unknown>[]) {
    const { manifest_id, ...rest } = section;
    const list = byManifest.get(manifest_id as string) ?? [];
    list.push(rest);
    byManifest.set(manifest_id as string, list);
  }
  for (const m of manifests) {
    m.sections = byManifest.get(m.id as string) ?? [];
  }
}

/** Yields the export document as JSON string chunks, one table page at a time. */
export async function* exportChunks(
  db: Db,
  workspaceId: string,
  counts: ExportCounts,
): AsyncGenerator<string> {
  const header = {
    format: BRAIN_EXPORT_FORMAT,
    format_version: BRAIN_FORMAT_VERSION,
    exported_at: new Date().toISOString(),
    source: { workspace_id: workspaceId },
    counts,
  };
  yield JSON.stringify(header).slice(0, -1);

  const tables: Array<{
    key: keyof ExportCounts;
    columns: readonly string[];
    prepare?: (rows: Record<string, unknown>[]) => Promise<void>;
  }> = [
    { key: 'agent_memory', columns: MEMORY_COLUMNS },
    { key: 'memory_relations', columns: RELATION_COLUMNS },
    {
      key: 'brain_manifest',
      columns: MANIFEST_COLUMNS,
      prepare: (rows) => attachSections(db, rows),
    },
  ];

  for (const table of tables) {
    yield `,${JSON.stringify(table.key)}:[`;
    let first = true;
    for await (const page of pageRows<Record<string, unknown>>(
      db,
      table.key,
      table.columns,
      workspaceId,
    )) {
      if (table.prepare) await table.prepare(page);
      for (const row of page) {
        yield (first ? '' : ',') + JSON.stringify(row);
        first = false;
      }
    }
    yield ']';
  }
  yield '}';
}

export function chunksToStream(chunks: AsyncGenerator<string>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await chunks.next();
        if (done) {
          controller.close();
          return;
        }
        controller.enqueue(encoder.encode(value));
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel() {
      await chunks.return(undefined);
    },
  });
}

/** Convenience for callers that want the whole document in memory. */
export async function exportToObject(db: Db, workspaceId: string): Promise<BrainExportFile> {
  const counts = await getExportCounts(db, workspaceId);
  let text = '';
  for await (const chunk of exportChunks(db, workspaceId, counts)) text += chunk;
  return JSON.parse(text) as BrainExportFile;
}

/**
 * Validates an uploaded document. Version is checked before the full schema so
 * a newer file gets a version error rather than a shape error.
 */
export function parseExportFile(input: unknown): BrainExportFile {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new BrainTransferError('invalid_brain_export', 'Body must be a brain export document');
  }
  const doc = input as Record<string, unknown>;
  if (doc.format !== BRAIN_EXPORT_FORMAT) {
    throw new BrainTransferError(
      'invalid_brain_export',
      `Unrecognized export format. Expected format "${BRAIN_EXPORT_FORMAT}"`,
    );
  }
  const version = doc.format_version;
  if (typeof version !== 'number' || !SUPPORTED_FORMAT_VERSIONS.includes(version)) {
    throw new BrainTransferError(
      'unsupported_format_version',
      `Unsupported brain export format_version ${String(version)}. This server supports: ${SUPPORTED_FORMAT_VERSIONS.join(', ')}`,
    );
  }
  const parsed = exportFileSchema.safeParse(doc);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path?.length ? ` at ${issue.path.join('.')}` : '';
    throw new BrainTransferError(
      'invalid_brain_export',
      `Invalid brain export file${where}: ${issue?.message ?? 'schema mismatch'}`,
    );
  }
  return parsed.data;
}

async function existingIds(db: Db, table: string, ids: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  await chunked(ids, PAGE_SIZE, async (chunk) => {
    const { data, error } = await db.from(table).select('id').in('id', chunk);
    if (error) throw error;
    for (const row of (data ?? []) as { id: string }[]) found.add(row.id);
  });
  return found;
}

// PostgREST and Postgres codes for a table that does not exist on this install.
const MISSING_TABLE_CODES = new Set(['PGRST205', '42P01']);

async function idsInWorkspace(
  db: Db,
  table: string,
  ids: string[],
  workspaceId: string,
): Promise<Set<string>> {
  const found = new Set<string>();
  await chunked(ids, PAGE_SIZE, async (chunk) => {
    const { data, error } = await db
      .from(table)
      .select('id')
      .in('id', chunk)
      .eq('workspace_id', workspaceId);
    if (error) {
      if (MISSING_TABLE_CODES.has((error as { code?: string }).code ?? '')) return;
      throw error;
    }
    for (const row of (data ?? []) as { id: string }[]) found.add(row.id);
  });
  return found;
}

async function deleteWorkspaceRows(db: Db, table: string, workspaceId: string): Promise<number> {
  const { data, error } = await db
    .from(table)
    .delete()
    .eq('workspace_id', workspaceId)
    .select('id');
  if (error) throw error;
  return (data ?? []).length;
}

interface Target {
  workspaceId: string;
  orgId: string | null;
  userId: string;
}

async function importMemories(
  db: Db,
  target: Target,
  rows: MemoryRow[],
  idMap: Map<string, string>,
): Promise<TableResult> {
  const byId = new Set<string>();
  const byKey = new Map<string, string>();
  const byHash = new Map<string, string>();
  for await (const page of pageRows<{ id: string; key: string; content: string }>(
    db,
    'agent_memory',
    ['id', 'key', 'content'],
    target.workspaceId,
  )) {
    for (const row of page) {
      byId.add(row.id);
      if (!byKey.has(row.key)) byKey.set(row.key, row.id);
      const h = contentHash(row.content);
      if (!byHash.has(h)) byHash.set(h, row.id);
    }
  }

  let skipped = 0;
  const candidates: MemoryRow[] = [];
  for (const row of rows) {
    const hash = contentHash(row.content);
    const existing = byId.has(row.id) ? row.id : (byHash.get(hash) ?? byKey.get(row.key));
    if (existing) {
      idMap.set(row.id, existing);
      skipped++;
      continue;
    }
    byId.add(row.id);
    byKey.set(row.key, row.id);
    byHash.set(hash, row.id);
    candidates.push(row);
  }

  const taken = await existingIds(
    db,
    'agent_memory',
    candidates.map((r) => r.id),
  );
  const toInsert = candidates.map((row) => {
    const id = taken.has(row.id) ? randomUUID() : row.id;
    idMap.set(row.id, id);
    return {
      ...row,
      id,
      workspace_id: target.workspaceId,
      org_id: target.orgId,
      user_id: target.userId,
    };
  });

  let inserted = 0;
  await chunked(toInsert, INSERT_BATCH, async (batch) => {
    const { data, error } = await db
      .from('agent_memory')
      .upsert(batch, { onConflict: 'workspace_id,key', ignoreDuplicates: true })
      .select('id');
    if (error) throw error;
    const landed = new Set(((data ?? []) as { id: string }[]).map((r) => r.id));
    for (const row of batch) {
      if (!landed.has(row.id)) {
        // The key landed in this workspace after the read above; drop the mapping so relations skip it.
        for (const [from, to] of idMap) if (to === row.id) idMap.delete(from);
        skipped++;
      }
    }
    inserted += landed.size;
  });

  return { inserted, skipped };
}

function relationKey(r: {
  memory_id: string;
  related_type: string;
  related_id: string;
  relation_type: string;
}): string {
  return `${r.memory_id}|${r.related_type}|${r.related_id}|${r.relation_type}`;
}

async function importRelations(
  db: Db,
  target: Target,
  rows: RelationRow[],
  idMap: Map<string, string>,
): Promise<TableResult> {
  const seen = new Set<string>();
  for await (const page of pageRows<RelationRow>(
    db,
    'memory_relations',
    ['id', 'memory_id', 'related_type', 'related_id', 'relation_type'],
    target.workspaceId,
  )) {
    for (const row of page) seen.add(relationKey(row));
  }

  // Task and skill edges keep their ids, so they must point at rows in the
  // target workspace. Memory edges are remapped through idMap, which only
  // holds memories that live in the target workspace.
  const linkedIds = async (type: 'task' | 'skill', table: string) =>
    idsInWorkspace(
      db,
      table,
      [...new Set(rows.filter((r) => r.related_type === type).map((r) => r.related_id))],
      target.workspaceId,
    );
  const localTasks = await linkedIds('task', 'tasks');
  const localSkills = await linkedIds('skill', 'skills');

  let skipped = 0;
  const candidates: RelationRow[] = [];
  for (const row of rows) {
    const memoryId = idMap.get(row.memory_id);
    const relatedId =
      row.related_type === 'memory'
        ? idMap.get(row.related_id)
        : (row.related_type === 'task' ? localTasks : localSkills).has(row.related_id)
          ? row.related_id
          : undefined;
    if (!memoryId || !relatedId) {
      skipped++;
      continue;
    }
    const mapped = { ...row, memory_id: memoryId, related_id: relatedId };
    const key = relationKey(mapped);
    if (seen.has(key)) {
      skipped++;
      continue;
    }
    seen.add(key);
    candidates.push(mapped);
  }

  const taken = await existingIds(
    db,
    'memory_relations',
    candidates.map((r) => r.id),
  );
  const toInsert = candidates.map((row) => ({
    ...row,
    id: taken.has(row.id) ? randomUUID() : row.id,
    workspace_id: target.workspaceId,
  }));

  let inserted = 0;
  await chunked(toInsert, INSERT_BATCH, async (batch) => {
    const { data, error } = await db
      .from('memory_relations')
      .upsert(batch, {
        onConflict: 'memory_id,related_type,related_id,relation_type',
        ignoreDuplicates: true,
      })
      .select('id');
    if (error) throw error;
    const landed = (data ?? []).length;
    inserted += landed;
    skipped += batch.length - landed;
  });

  return { inserted, skipped };
}

async function importManifest(db: Db, target: Target, rows: ManifestRow[]): Promise<TableResult> {
  const paths = new Set<string>();
  for await (const page of pageRows<{ path: string }>(
    db,
    'brain_manifest',
    ['id', 'path'],
    target.workspaceId,
  )) {
    for (const row of page) paths.add(row.path);
  }

  let skipped = 0;
  const candidates: ManifestRow[] = [];
  for (const row of rows) {
    if (paths.has(row.path)) {
      skipped++;
      continue;
    }
    paths.add(row.path);
    candidates.push(row);
  }

  const taken = await existingIds(
    db,
    'brain_manifest',
    candidates.map((r) => r.id),
  );
  const prepared = candidates.map(({ sections, ...row }) => ({
    row: {
      ...row,
      id: taken.has(row.id) ? randomUUID() : row.id,
      workspace_id: target.workspaceId,
      org_id: target.orgId,
    },
    sections: sections ?? [],
  }));

  let inserted = 0;
  await chunked(prepared, INSERT_BATCH, async (batch) => {
    const { data, error } = await db
      .from('brain_manifest')
      .upsert(
        batch.map((b) => b.row),
        { onConflict: 'workspace_id,path', ignoreDuplicates: true },
      )
      .select('id');
    if (error) throw error;
    const landed = new Set(((data ?? []) as { id: string }[]).map((r) => r.id));
    inserted += landed.size;
    skipped += batch.length - landed.size;

    const sectionRows = batch
      .filter((b) => landed.has(b.row.id))
      .flatMap((b) => b.sections.map((s) => ({ ...s, manifest_id: b.row.id })));
    if (sectionRows.length > 0) {
      const { error: sectionError } = await db.from('brain_section_hashes').insert(sectionRows);
      if (sectionError) throw sectionError;
    }
  });

  return { inserted, skipped };
}

export async function importBrain(
  db: Db,
  target: Target,
  file: BrainExportFile,
  mode: ImportMode,
): Promise<ImportResult> {
  const result: ImportResult = {
    mode,
    format_version: file.format_version,
    counts: {
      agent_memory: { inserted: 0, skipped: 0 },
      memory_relations: { inserted: 0, skipped: 0 },
      brain_manifest: { inserted: 0, skipped: 0 },
    },
  };

  if (mode === 'overwrite') {
    // Relations reference memories; section hashes cascade from the manifest.
    const memory_relations = await deleteWorkspaceRows(db, 'memory_relations', target.workspaceId);
    const agent_memory = await deleteWorkspaceRows(db, 'agent_memory', target.workspaceId);
    const brain_manifest = await deleteWorkspaceRows(db, 'brain_manifest', target.workspaceId);
    result.deleted = { agent_memory, memory_relations, brain_manifest };
  }

  const idMap = new Map<string, string>();
  result.counts.agent_memory = await importMemories(db, target, file.agent_memory, idMap);
  result.counts.memory_relations = await importRelations(db, target, file.memory_relations, idMap);
  result.counts.brain_manifest = await importManifest(db, target, file.brain_manifest);
  return result;
}

export async function resolveWorkspaceOrg(db: Db, workspaceId: string): Promise<string | null> {
  const { data, error } = await db
    .from('workspaces')
    .select('org_id')
    .eq('id', workspaceId)
    .maybeSingle();
  if (error) throw error;
  return (data as { org_id?: string | null } | null)?.org_id ?? null;
}
