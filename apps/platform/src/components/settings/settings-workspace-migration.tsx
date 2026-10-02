'use client';

import { useEffect, useState } from 'react';
import { CloudUpload, Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@repo/ui/components/button';
import { Input } from '@repo/ui/components/input';
import { apiUrl } from '@repo/db/api';
import { fetchJson } from '@/lib/fetch-json';

type Policy = 'open' | 'plan_limited' | 'metered';
type Change = 'same' | 'adds_limit' | 'removes_limit' | 'changes_limit';

interface FeatureDiffRow {
  feature: string;
  label: string;
  current: Policy;
  target: Policy;
  change: Change;
}

interface MigrationInfo {
  edition: 'cloud' | 'community';
  target_edition: 'cloud' | 'community';
  product_name: string;
  can_move_to_cloud: boolean;
  cloud_url: string | null;
  feature_diff: FeatureDiffRow[];
}

interface MoveResult {
  exported: Record<string, number>;
  imported: {
    counts: Record<string, { inserted: number; skipped: number }>;
    attachments_without_bytes: number;
  };
  cloud_url: string;
}

const POLICY_LABELS: Record<Policy, string> = {
  open: 'No limit',
  plan_limited: 'Limited by plan',
  metered: 'Uses a usage budget',
};

const CHANGE_LABELS: Record<Change, string> = {
  same: 'No change',
  adds_limit: 'Adds a limit',
  removes_limit: 'Removes a limit',
  changes_limit: 'Limit changes',
};

const TABLE_LABELS: Record<string, string> = {
  project_groups: 'Project groups',
  projects: 'Projects',
  tasks: 'Tasks',
  task_comments: 'Comments',
  task_attachments: 'Attachments',
  agent_configs: 'Agent configs',
};

function editionName(edition: 'cloud' | 'community', product: string): string {
  return edition === 'cloud' ? `${product} Cloud` : 'self-hosted';
}

function filenameFrom(header: string | null, fallback: string): string {
  const match = header?.match(/filename="([^"]+)"/);
  return match?.[1] ?? fallback;
}

export function SettingsWorkspaceMigration({ workspaceId }: { workspaceId: string }) {
  const [info, setInfo] = useState<MigrationInfo | null>(null);
  const [exporting, setExporting] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [moving, setMoving] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [moved, setMoved] = useState<MoveResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchJson<MigrationInfo>(apiUrl(`/api/workspace/migration?workspace_id=${workspaceId}`))
      .then((data) => {
        if (!cancelled) setInfo(data);
      })
      .catch(() => {
        if (!cancelled) setInfo(null);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await fetch(
        apiUrl(`/api/workspace/export?workspace_id=${workspaceId}&format=zip`),
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filenameFrom(res.headers.get('content-disposition'), 'celune-workspace.zip');
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Workspace export downloaded');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  const handleMove = async () => {
    setMoving(true);
    setMoved(null);
    try {
      const data = await fetchJson<MoveResult>(
        apiUrl(`/api/workspace/migration/cloud?workspace_id=${workspaceId}`),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api_key: apiKey }),
        },
      );
      setMoved(data);
      toast.success('Workspace copied to Cloud');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Move failed');
    } finally {
      // The key only lives for the request.
      setApiKey('');
      setConfirmed(false);
      setMoving(false);
    }
  };

  const product = info?.product_name ?? 'Celune';
  const target = info ? editionName(info.target_edition, product) : null;

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <h3 className="text-foreground text-sm font-bold">Export workspace</h3>
        <div className="bg-surface-75 border-border rounded-lg border p-4">
          <p className="text-muted-foreground text-xs">
            Download a zip with every project, task, comment, dependency, attachment, agent config,
            and the brain, plus a README and the environment template for the self-hosted Docker
            stack. Provider keys, API keys, and integration tokens are left out. Load it on a
            self-hosted instance with <code>npx @celuneai/cli workspace import</code>.
          </p>
          <Button size="md" className="mt-4" onClick={handleExport} disabled={exporting}>
            {exporting ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-1 h-4 w-4" />
            )}
            Export workspace
          </Button>
        </div>
      </div>

      {info && info.feature_diff.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-foreground text-sm font-bold">What changes on {target}</h3>
          <div className="bg-surface-75 border-border overflow-x-auto rounded-lg border">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-muted-foreground border-border border-b text-left">
                  <th scope="col" className="p-3 font-medium">
                    Feature
                  </th>
                  <th scope="col" className="p-3 font-medium">
                    Here
                  </th>
                  <th scope="col" className="p-3 font-medium">
                    On {target}
                  </th>
                  <th scope="col" className="p-3 font-medium">
                    Change
                  </th>
                </tr>
              </thead>
              <tbody>
                {info.feature_diff.map((row) => (
                  <tr key={row.feature} className="border-border border-b last:border-0">
                    <td className="text-foreground p-3">{row.label}</td>
                    <td className="text-muted-foreground p-3">{POLICY_LABELS[row.current]}</td>
                    <td className="text-muted-foreground p-3">{POLICY_LABELS[row.target]}</td>
                    <td
                      className={
                        row.change === 'same' ? 'text-muted-foreground p-3' : 'text-foreground p-3'
                      }
                    >
                      {CHANGE_LABELS[row.change]}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-muted-foreground text-xs">
            Keys and integrations do not move. Add provider keys, create API keys, and reconnect
            integrations on the target after the move.
          </p>
        </div>
      )}

      {info?.can_move_to_cloud && (
        <div className="space-y-3">
          <h3 className="text-foreground text-sm font-bold">Move to {product} Cloud</h3>
          <div className="bg-surface-75 border-border space-y-3 rounded-lg border p-4">
            <ol className="text-muted-foreground list-decimal space-y-1 pl-4 text-xs">
              <li>
                Create or open a workspace on {product} Cloud
                {info.cloud_url ? ` (${info.cloud_url})` : ''}.
              </li>
              <li>In that workspace, open Settings and create an API key with write scope.</li>
              <li>Paste the key below. It is sent with this one request and never saved.</li>
              <li>
                This instance exports the workspace and uploads it. Rows merge into the Cloud
                workspace, and running it again skips rows that already arrived.
              </li>
            </ol>
            <p className="text-muted-foreground text-xs">
              Nothing on this instance is deleted. Keep it running until you have checked the Cloud
              workspace.
            </p>
            <Input
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="Cloud API key"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              aria-label="Cloud API key"
            />
            <label className="text-muted-foreground flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              I reviewed what changes on {product} Cloud
            </label>
            <Button size="md" onClick={handleMove} disabled={moving || !apiKey || !confirmed}>
              {moving ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <CloudUpload className="mr-1 h-4 w-4" />
              )}
              Move to {product} Cloud
            </Button>

            {moved && (
              <div role="status" className="border-border space-y-1 border-t pt-3">
                {Object.entries(moved.imported.counts).map(([table, counts]) => (
                  <p key={table} className="text-muted-foreground text-xs">
                    <span className="text-foreground font-medium">
                      {TABLE_LABELS[table] ?? table}:
                    </span>{' '}
                    {counts.inserted} copied, {counts.skipped} skipped
                  </p>
                ))}
                {moved.imported.attachments_without_bytes > 0 && (
                  <p className="text-muted-foreground text-xs">
                    {moved.imported.attachments_without_bytes} attachment file(s) were too large to
                    send and stay on this instance.
                  </p>
                )}
                <a
                  href={moved.cloud_url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-foreground text-xs underline"
                >
                  Open {product} Cloud
                </a>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
