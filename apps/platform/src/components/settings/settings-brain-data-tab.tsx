'use client';

import { useRef, useState } from 'react';
import { Download, Loader2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@repo/ui/components/button';
import { apiUrl } from '@repo/db/api';
import { fetchJson } from '@/lib/fetch-json';

type ImportMode = 'merge' | 'overwrite';

interface TableCounts {
  inserted: number;
  skipped: number;
}

interface ImportResult {
  mode: ImportMode;
  counts: Record<string, TableCounts>;
  deleted?: Record<string, number>;
}

const TABLE_LABELS: Record<string, string> = {
  agent_memory: 'Memories',
  memory_relations: 'Relations',
  brain_manifest: 'Manifest entries',
};

function filenameFrom(header: string | null, fallback: string): string {
  const match = header?.match(/filename="([^"]+)"/);
  return match?.[1] ?? fallback;
}

export function SettingsBrainDataTab({ workspaceId }: { workspaceId: string }) {
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [mode, setMode] = useState<ImportMode>('merge');
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await fetch(apiUrl(`/api/brain/export?workspace_id=${workspaceId}`));
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filenameFrom(res.headers.get('content-disposition'), 'celune-brain.json');
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Brain export downloaded');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  const handleImport = async () => {
    if (!file) return;
    if (
      mode === 'overwrite' &&
      !window.confirm(
        'Overwrite deletes every memory, relation, and manifest entry in this workspace before importing. Continue?',
      )
    ) {
      return;
    }
    setImporting(true);
    setResult(null);
    try {
      const gzip = file.name.endsWith('.gz');
      const data = await fetchJson<ImportResult>(
        apiUrl(`/api/brain/import?workspace_id=${workspaceId}&mode=${mode}`),
        {
          method: 'POST',
          headers: { 'Content-Type': gzip ? 'application/gzip' : 'application/json' },
          body: file,
        },
      );
      setResult(data);
      setFile(null);
      if (fileInput.current) fileInput.current.value = '';
      toast.success(`Brain import complete (${data.mode})`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <h3 className="text-foreground text-sm font-bold">Export</h3>
        <div className="bg-surface-75 border-border rounded-lg border p-4">
          <p className="text-muted-foreground text-xs">
            Download this workspace&apos;s memories, memory relations, and brain manifest as a
            versioned JSON file. Large exports are gzipped. Use it to move between self-hosted
            Celune and Celune Cloud.
          </p>
          <Button size="md" className="mt-4" onClick={handleExport} disabled={exporting}>
            {exporting ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-1 h-4 w-4" />
            )}
            Export brain data
          </Button>
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="text-foreground text-sm font-bold">Import</h3>
        <div className="bg-surface-75 border-border rounded-lg border p-4">
          <p className="text-muted-foreground text-xs">
            Upload a brain export (.json or .json.gz). Merge keeps existing rows and skips
            duplicates by id, content, or key. Overwrite replaces everything in this workspace.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <input
              ref={fileInput}
              type="file"
              accept=".json,.gz,application/json,application/gzip"
              className="text-muted-foreground text-xs"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>
          <div className="mt-3 flex items-center gap-2">
            <span className="text-muted-foreground text-xs">Mode</span>
            {(['merge', 'overwrite'] as ImportMode[]).map((m) => (
              <Button
                key={m}
                size="sm"
                variant={mode === m ? 'default' : 'ghost'}
                onClick={() => setMode(m)}
              >
                {m}
              </Button>
            ))}
          </div>
          <Button size="md" className="mt-4" onClick={handleImport} disabled={importing || !file}>
            {importing ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Upload className="mr-1 h-4 w-4" />
            )}
            Import brain data
          </Button>

          {result && (
            <div className="border-border mt-4 space-y-1 border-t pt-3">
              {Object.entries(result.counts).map(([table, counts]) => (
                <p key={table} className="text-muted-foreground text-xs">
                  <span className="text-foreground font-medium">
                    {TABLE_LABELS[table] ?? table}:
                  </span>{' '}
                  {counts.inserted} inserted, {counts.skipped} skipped
                  {result.deleted?.[table] !== undefined
                    ? `, ${result.deleted[table]} deleted`
                    : ''}
                </p>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
