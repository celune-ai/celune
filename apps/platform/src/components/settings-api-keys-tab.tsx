'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Copy, Key, Loader2, Plus, Radio, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@repo/ui/components/button';
import { Badge } from '@repo/ui/components/badge';
import { Switch } from '@repo/ui/components/switch';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@repo/ui/components/tabs';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@repo/ui/components/dialog';
import { fetchJson } from '@/lib/fetch-json';
import { apiUrl } from '@repo/db/api';
import { useWorkspace } from '@/providers/workspace-provider';
import type { ApiKey, ApiKeyCreated, ApiKeyScope } from '@repo/types';
import { URL_APP } from '@/lib/branding';

/* ── Tool connection tabs for newly created keys ── */

type ToolTab = 'claude-code' | 'cursor' | 'windsurf' | 'cline' | 'cli-installer';

const TOOL_TABS: { value: ToolTab; label: string }[] = [
  { value: 'claude-code', label: 'Claude Code' },
  { value: 'cursor', label: 'Cursor' },
  { value: 'windsurf', label: 'Windsurf' },
  { value: 'cline', label: 'Cline' },
  { value: 'cli-installer', label: 'CLI Installer' },
];

function mcpJsonConfig(apiUrl: string, apiKey: string) {
  return JSON.stringify(
    {
      mcpServers: {
        celune: {
          type: 'http',
          url: apiUrl,
          headers: { Authorization: `Bearer ${apiKey}` },
        },
      },
    },
    null,
    2,
  );
}

function CodeBlock({
  children,
  onCopy,
  hint,
}: {
  children: string;
  onCopy: (text: string) => void;
  hint?: string;
}) {
  return (
    <div className="space-y-1.5">
      <div className="bg-surface-100 relative rounded px-3 py-2">
        <code className="text-foreground block pr-10 font-mono text-xs whitespace-pre-wrap">
          {children}
        </code>
        <Button
          size="sm"
          variant="ghost"
          className="absolute top-1.5 right-1.5 h-7 w-7 p-0"
          onClick={() => onCopy(children)}
        >
          <Copy className="h-3.5 w-3.5" />
        </Button>
      </div>
      {hint && <p className="text-muted-foreground text-xs">{hint}</p>}
    </div>
  );
}

function NewKeyBanner({
  apiKey,
  onCopy,
  onDismiss,
}: {
  apiKey: string;
  onCopy: (text: string) => void;
  onDismiss: () => void;
}) {
  const origin = typeof window !== 'undefined' ? window.location.origin : URL_APP;
  const mcpUrl = `${origin}/api/mcp`;

  const claudeCodeCmd = `claude mcp add celune --transport http ${mcpUrl} --header "Authorization: Bearer ${apiKey}" --scope user`;
  const jsonConfig = mcpJsonConfig(mcpUrl, apiKey);

  return (
    <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-4">
      <p className="text-foreground mb-2 text-sm font-medium">
        Your new API key (copy it now — it won&apos;t be shown again):
      </p>
      <div className="flex items-center gap-2">
        <code className="bg-surface-100 text-foreground flex-1 rounded px-3 py-2 font-mono text-sm">
          {apiKey}
        </code>
        <Button size="sm" onClick={() => onCopy(apiKey)}>
          <Copy className="h-4 w-4" />
        </Button>
      </div>

      <div className="mt-4 space-y-3">
        <p className="text-foreground text-sm font-medium">Connect your tools:</p>

        <Tabs defaultValue="claude-code" className="w-full">
          <TabsList className="w-full">
            {TOOL_TABS.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value} className="text-xs">
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="claude-code">
            <CodeBlock onCopy={onCopy} hint="Run this command in your terminal.">
              {claudeCodeCmd}
            </CodeBlock>
          </TabsContent>

          <TabsContent value="cursor">
            <CodeBlock onCopy={onCopy} hint="Add to ~/.cursor/mcp.json">
              {jsonConfig}
            </CodeBlock>
          </TabsContent>

          <TabsContent value="windsurf">
            <CodeBlock onCopy={onCopy} hint="Add to ~/.codeium/windsurf/mcp_config.json">
              {jsonConfig}
            </CodeBlock>
          </TabsContent>

          <TabsContent value="cline">
            <CodeBlock
              onCopy={onCopy}
              hint="Add to .vscode/cline_mcp_settings.json (project-level)"
            >
              {jsonConfig}
            </CodeBlock>
          </TabsContent>

          <TabsContent value="cli-installer">
            <CodeBlock onCopy={onCopy} hint="Auto-detects and configures all supported tools.">
              npx @celuneai/cli
            </CodeBlock>
          </TabsContent>
        </Tabs>
      </div>

      <button className="text-muted-foreground mt-3 text-xs underline" onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  );
}

/* ── Main component ── */

interface NewKeyFormState {
  name: string;
  environment: 'live' | 'test';
  scopes: ApiKeyScope[];
}

export function SettingsApiKeysTab() {
  const { activeWorkspace } = useWorkspace();
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [newlyCreatedKey, setNewlyCreatedKey] = useState<string | null>(null);
  const [form, setForm] = useState<NewKeyFormState>({
    name: '',
    environment: 'live',
    scopes: ['read'],
  });

  const [revokeTarget, setRevokeTarget] = useState<{ id: string; name: string } | null>(null);
  const [revoking, setRevoking] = useState(false);

  const workspaceId = activeWorkspace?.id;

  const fetchKeys = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    try {
      const data = await fetchJson<ApiKey[]>(apiUrl(`/api/api-keys?workspace_id=${workspaceId}`));
      setKeys(data);
    } catch {
      toast.error('Failed to load API keys');
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    fetchKeys();
  }, [fetchKeys]);

  const handleCreate = async () => {
    if (!workspaceId || !form.name.trim()) return;
    setCreating(true);
    try {
      const result = await fetchJson<ApiKeyCreated>(apiUrl('/api/api-keys'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: workspaceId,
          name: form.name.trim(),
          environment: form.environment,
          scopes: form.scopes,
        }),
      });
      setNewlyCreatedKey(result.plaintext_key);
      setShowForm(false);
      setForm({ name: '', environment: 'live', scopes: ['read'] });
      await fetchKeys();
      toast.success('API key created');
    } catch {
      toast.error('Failed to create API key');
    } finally {
      setCreating(false);
    }
  };

  const confirmRevoke = async () => {
    if (!revokeTarget) return;
    setRevoking(true);
    try {
      await fetchJson(apiUrl(`/api/api-keys/${revokeTarget.id}?workspace_id=${workspaceId}`), {
        method: 'DELETE',
      });
      await fetchKeys();
      toast.success('API key revoked');
      setRevokeTarget(null);
    } catch {
      toast.error('Failed to revoke key');
    } finally {
      setRevoking(false);
    }
  };

  const copyKey = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard');
  };

  const toggleScope = (scope: ApiKeyScope) => {
    setForm((f) => ({
      ...f,
      scopes: f.scopes.includes(scope) ? f.scopes.filter((s) => s !== scope) : [...f.scopes, scope],
    }));
  };

  const toggleRealtime = async (keyId: string, enabled: boolean) => {
    // Optimistic update
    setKeys((prev) => prev.map((k) => (k.id === keyId ? { ...k, realtime_enabled: enabled } : k)));
    try {
      await fetchJson(apiUrl(`/api/api-keys/${keyId}?workspace_id=${workspaceId}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ realtime_enabled: enabled }),
      });
    } catch {
      // Revert
      setKeys((prev) =>
        prev.map((k) => (k.id === keyId ? { ...k, realtime_enabled: !enabled } : k)),
      );
      toast.error('Failed to update real-time setting');
    }
  };

  const activeKeys = keys.filter((k) => !k.revoked_at);
  const revokedKeys = keys.filter((k) => k.revoked_at);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-foreground mb-1 flex items-center gap-2 text-lg font-medium">
            <Key className="h-5 w-5" />
            API Keys
          </h2>
          <p className="text-muted-foreground text-sm">
            Create API keys for programmatic access to your workspace.
          </p>
        </div>
        <Button size="md" onClick={() => setShowForm(!showForm)}>
          <Plus className="mr-1.5 h-4 w-4" />
          New Key
        </Button>
      </div>

      {/* Newly created key banner */}
      {newlyCreatedKey && (
        <NewKeyBanner
          apiKey={newlyCreatedKey}
          onCopy={copyKey}
          onDismiss={() => setNewlyCreatedKey(null)}
        />
      )}

      {/* Create form */}
      {showForm && (
        <div className="bg-surface-75 border-border space-y-4 rounded-lg border p-4">
          <div>
            <label className="text-foreground mb-1 block text-sm font-medium">Name</label>
            <input
              type="text"
              className="bg-surface-100 border-border text-foreground w-full rounded border px-3 py-2 text-sm"
              placeholder="e.g., Production API, CI/CD Pipeline"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>

          <div>
            <label className="text-foreground mb-1 block text-sm font-medium">Environment</label>
            <div className="flex gap-2">
              {(['live', 'test'] as const).map((env) => (
                <button
                  key={env}
                  className={`rounded px-3 py-1.5 text-sm font-medium ${
                    form.environment === env
                      ? 'bg-brand text-black'
                      : 'bg-surface-100 text-muted-foreground hover:text-foreground'
                  }`}
                  onClick={() => setForm({ ...form, environment: env })}
                >
                  {env === 'live' ? 'Live' : 'Test'}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-foreground mb-1 block text-sm font-medium">Scopes</label>
            <div className="flex gap-2">
              {(['read', 'write', 'admin'] as const).map((scope) => (
                <button
                  key={scope}
                  className={`rounded px-3 py-1.5 text-sm font-medium ${
                    form.scopes.includes(scope)
                      ? 'bg-brand text-black'
                      : 'bg-surface-100 text-muted-foreground hover:text-foreground'
                  }`}
                  onClick={() => toggleScope(scope)}
                >
                  {scope}
                </button>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button size="md" variant="ghost" onClick={() => setShowForm(false)}>
              Cancel
            </Button>
            <Button
              size="md"
              onClick={handleCreate}
              disabled={creating || !form.name.trim() || form.scopes.length === 0}
            >
              {creating && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Create Key
            </Button>
          </div>
        </div>
      )}

      {/* Keys list */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
        </div>
      ) : activeKeys.length === 0 ? (
        <div className="text-muted-foreground py-12 text-center text-sm">
          No API keys yet. Create one to get started.
        </div>
      ) : (
        <div className="bg-surface-75 border-border divide-border divide-y rounded-lg border">
          {activeKeys.map((key) => (
            <div key={key.id} className="flex items-center justify-between px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-foreground text-sm font-medium">{key.name}</span>
                  <Badge variant={key.environment === 'live' ? 'emerald-dark' : 'blue-dark'}>
                    {key.environment}
                  </Badge>
                  {key.scopes.map((scope) => (
                    <Badge key={scope} variant="outline">
                      {scope}
                    </Badge>
                  ))}
                </div>
                <div className="text-muted-foreground mt-0.5 flex items-center gap-3 text-xs">
                  <code>{key.key_prefix}...••••</code>
                  <span>Created {new Date(key.created_at).toLocaleDateString()}</span>
                  {key.last_used_at && (
                    <span>Last used {new Date(key.last_used_at).toLocaleDateString()}</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <Radio
                    className={`h-3 w-3 ${key.realtime_enabled ? 'text-green-400' : 'text-foreground-lighter'}`}
                  />
                  <span className="text-foreground-lighter text-xs">Live</span>
                  <Switch
                    checked={key.realtime_enabled}
                    onCheckedChange={(v) => toggleRealtime(key.id, v)}
                  />
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setRevokeTarget({ id: key.id, name: key.name })}
                >
                  <Trash2 className="h-4 w-4 text-red-400" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Revoked keys */}
      {revokedKeys.length > 0 && (
        <div>
          <h3 className="text-muted-foreground mb-2 text-sm font-medium">
            Revoked Keys ({revokedKeys.length})
          </h3>
          <div className="bg-surface-75 border-border divide-border divide-y rounded-lg border opacity-60">
            {revokedKeys.map((key) => (
              <div key={key.id} className="flex items-center justify-between px-4 py-2">
                <div>
                  <span className="text-muted-foreground text-sm line-through">{key.name}</span>
                  <span className="text-muted-foreground ml-2 text-xs">
                    Revoked {new Date(key.revoked_at!).toLocaleDateString()}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {/* Revoke confirmation dialog */}
      <Dialog open={!!revokeTarget} onOpenChange={(open) => !open && setRevokeTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-400" />
              Revoke API Key
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to revoke <strong>{revokeTarget?.name}</strong>? This action
              cannot be undone. Any integrations using this key will immediately stop working.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRevokeTarget(null)} disabled={revoking}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmRevoke} disabled={revoking}>
              {revoking ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
              Revoke Key
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
