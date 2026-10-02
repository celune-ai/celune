import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync, strToU8, zipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkExportHeader, detectKind, runWorkspaceImport } from '../commands/workspace.js';

const doc = (format_version: number, format = 'celune-workspace') =>
  strToU8(JSON.stringify({ format, format_version, tasks: [] }));

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'celune-workspace-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeExport(name: string, bytes: Uint8Array): string {
  const path = join(dir, name);
  writeFileSync(path, bytes);
  return path;
}

describe('checkExportHeader', () => {
  it('reads the header from a zip, gzip, or plain JSON export', () => {
    expect(checkExportHeader(zipSync({ 'workspace.json': doc(1) }))).toEqual({ format_version: 1 });
    expect(checkExportHeader(gzipSync(doc(1)))).toEqual({ format_version: 1 });
    expect(checkExportHeader(doc(1))).toEqual({ format_version: 1 });
  });

  it('rejects newer versions, other formats, and archives without the document', () => {
    expect(() => checkExportHeader(doc(2))).toThrowError(
      /Unsupported workspace export format_version 2/,
    );
    expect(() => checkExportHeader(doc(1, 'celune-brain'))).toThrowError(/Not a workspace export/);
    expect(() => checkExportHeader(zipSync({ 'README.md': strToU8('hi') }))).toThrowError(
      /no workspace\.json/,
    );
    expect(() => checkExportHeader(strToU8('not json'))).toThrowError(/not valid JSON/);
  });
});

describe('runWorkspaceImport', () => {
  it('uploads the archive with the API key and the right content type', async () => {
    const zip = zipSync({ 'workspace.json': doc(1), 'attachments/x/a.md': strToU8('a') });
    const file = writeExport('export.zip', zip);
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ mode: 'merge', counts: { tasks: { inserted: 3, skipped: 0 } } }),
          { status: 200 },
        ),
    );

    const result = await runWorkspaceImport({
      file,
      apiUrl: 'http://localhost:3000',
      apiKey: 'test_live_key',
      mode: 'merge',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.counts.tasks).toEqual({ inserted: 3, skipped: 0 });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://localhost:3000/api/workspace/import?mode=merge');
    expect(init.headers).toEqual({
      Authorization: 'Bearer test_live_key',
      'Content-Type': 'application/zip',
    });
    expect(new Uint8Array(init.body as Uint8Array)).toEqual(zip);
  });

  it('stops before upload when the version is not supported', async () => {
    const file = writeExport('export.json', doc(3));
    const fetchImpl = vi.fn();
    await expect(
      runWorkspaceImport({
        file,
        apiUrl: 'http://localhost:3000',
        apiKey: 'k',
        mode: 'merge',
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrowError(/format_version 3/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('reports the server error message', async () => {
    const file = writeExport('export.json.gz', gzipSync(doc(1)));
    expect(detectKind(gzipSync(doc(1)))).toBe('gzip');
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }),
    );
    await expect(
      runWorkspaceImport({
        file,
        apiUrl: 'http://localhost:3000',
        apiKey: 'k',
        mode: 'overwrite',
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrowError('Import failed: Forbidden');
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('mode=overwrite');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/gzip');
  });
});
