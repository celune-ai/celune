'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Copy, Globe, Loader2, Plus, Trash2, Power, PowerOff } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@repo/ui/components/button';
import { Badge } from '@repo/ui/components/badge';
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

interface WebhookEndpoint {
  id: string;
  workspace_id: string;
  url: string;
  events: string[];
  description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface WebhookCreateResponse extends WebhookEndpoint {
  secret: string;
}

const ALL_WEBHOOK_EVENTS = [
  'task.created',
  'task.completed',
  'task.updated',
  'agent.status_changed',
  'usage.threshold_reached',
  'billing.invoice_paid',
] as const;

const EVENT_LABELS: Record<string, string> = {
  'task.created': 'Task Created',
  'task.completed': 'Task Completed',
  'task.updated': 'Task Updated',
  'agent.status_changed': 'Agent Status Changed',
  'usage.threshold_reached': 'Usage Threshold',
  'billing.invoice_paid': 'Invoice Paid',
};

interface FormState {
  url: string;
  description: string;
  events: string[];
}

export function SettingsWebhooksTab() {
  const { activeWorkspace } = useWorkspace();
  const [endpoints, setEndpoints] = useState<WebhookEndpoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [newlyCreatedSecret, setNewlyCreatedSecret] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>({
    url: '',
    description: '',
    events: ['task.completed'],
  });

  const [deleteTarget, setDeleteTarget] = useState<{ id: string; url: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const workspaceId = activeWorkspace?.id;

  const fetchEndpoints = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    try {
      const data = await fetchJson<{ endpoints: WebhookEndpoint[] }>(
        apiUrl(`/api/webhooks/endpoints?workspace_id=${workspaceId}`),
      );
      setEndpoints(data.endpoints ?? []);
    } catch {
      toast.error('Failed to load webhook endpoints');
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    fetchEndpoints();
  }, [fetchEndpoints]);

  const handleCreate = async () => {
    if (!workspaceId || !form.url.trim() || form.events.length === 0) return;
    setCreating(true);
    try {
      const result = await fetchJson<WebhookCreateResponse>(apiUrl('/api/webhooks/endpoints'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: workspaceId,
          url: form.url.trim(),
          description: form.description.trim() || undefined,
          events: form.events,
        }),
      });
      setNewlyCreatedSecret(result.secret);
      setShowForm(false);
      setForm({ url: '', description: '', events: ['task.completed'] });
      await fetchEndpoints();
      toast.success('Webhook endpoint created');
    } catch {
      toast.error('Failed to create webhook endpoint');
    } finally {
      setCreating(false);
    }
  };

  const toggleActive = async (endpoint: WebhookEndpoint) => {
    try {
      await fetchJson(
        apiUrl(`/api/webhooks/endpoints/${endpoint.id}?workspace_id=${workspaceId}`),
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ is_active: !endpoint.is_active }),
        },
      );
      await fetchEndpoints();
      toast.success(endpoint.is_active ? 'Webhook disabled' : 'Webhook enabled');
    } catch {
      toast.error('Failed to update webhook');
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await fetchJson(
        apiUrl(`/api/webhooks/endpoints/${deleteTarget.id}?workspace_id=${workspaceId}`),
        { method: 'DELETE' },
      );
      await fetchEndpoints();
      toast.success('Webhook endpoint deleted');
      setDeleteTarget(null);
    } catch {
      toast.error('Failed to delete webhook endpoint');
    } finally {
      setDeleting(false);
    }
  };

  const copySecret = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard');
  };

  const toggleEvent = (event: string) => {
    setForm((f) => ({
      ...f,
      events: f.events.includes(event) ? f.events.filter((e) => e !== event) : [...f.events, event],
    }));
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-foreground mb-1 flex items-center gap-2 text-lg font-medium">
            <Globe className="h-5 w-5" />
            Webhooks
          </h2>
          <p className="text-muted-foreground text-sm">
            Send real-time event notifications to external URLs.
          </p>
        </div>
        <Button size="md" onClick={() => setShowForm(!showForm)}>
          <Plus className="mr-1.5 h-4 w-4" />
          New Endpoint
        </Button>
      </div>

      {/* Newly created secret banner */}
      {newlyCreatedSecret && (
        <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-4">
          <p className="text-foreground mb-2 text-sm font-medium">
            Your webhook signing secret (copy it now — it won&apos;t be shown again):
          </p>
          <div className="flex items-center gap-2">
            <code className="bg-surface-100 text-foreground flex-1 rounded px-3 py-2 font-mono text-sm">
              {newlyCreatedSecret}
            </code>
            <Button size="sm" onClick={() => copySecret(newlyCreatedSecret)}>
              <Copy className="h-4 w-4" />
            </Button>
          </div>
          <p className="text-muted-foreground mt-2 text-xs">
            Use this secret to verify webhook signatures via the{' '}
            <code className="text-xs">X-Webhook-Signature</code> header (HMAC-SHA256).
          </p>
          <button
            className="text-muted-foreground mt-2 text-xs underline"
            onClick={() => setNewlyCreatedSecret(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Create form */}
      {showForm && (
        <div className="bg-surface-75 border-border space-y-4 rounded-lg border p-4">
          <div>
            <label className="text-foreground mb-1 block text-sm font-medium">Endpoint URL</label>
            <input
              type="url"
              className="bg-surface-100 border-border text-foreground w-full rounded border px-3 py-2 text-sm"
              placeholder="https://example.com/webhooks"
              value={form.url}
              onChange={(e) => setForm({ ...form, url: e.target.value })}
            />
          </div>

          <div>
            <label className="text-foreground mb-1 block text-sm font-medium">
              Description <span className="text-muted-foreground font-normal">(optional)</span>
            </label>
            <input
              type="text"
              className="bg-surface-100 border-border text-foreground w-full rounded border px-3 py-2 text-sm"
              placeholder="e.g., Production task notifications"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>

          <div>
            <label className="text-foreground mb-2 block text-sm font-medium">Events</label>
            <div className="flex flex-wrap gap-2">
              {ALL_WEBHOOK_EVENTS.map((event) => (
                <button
                  key={event}
                  className={`rounded px-3 py-1.5 text-sm font-medium ${
                    form.events.includes(event)
                      ? 'bg-brand text-black'
                      : 'bg-surface-100 text-muted-foreground hover:text-foreground'
                  }`}
                  onClick={() => toggleEvent(event)}
                >
                  {EVENT_LABELS[event] ?? event}
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
              disabled={creating || !form.url.trim() || form.events.length === 0}
            >
              {creating && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Create Endpoint
            </Button>
          </div>
        </div>
      )}

      {/* Endpoints list */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
        </div>
      ) : endpoints.length === 0 ? (
        <div className="text-muted-foreground py-12 text-center text-sm">
          No webhook endpoints yet. Create one to start receiving event notifications.
        </div>
      ) : (
        <div className="bg-surface-75 border-border divide-border divide-y rounded-lg border">
          {endpoints.map((ep) => (
            <div key={ep.id} className="flex items-center justify-between px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-foreground truncate text-sm font-medium">{ep.url}</span>
                  <Badge
                    style={{
                      backgroundColor: ep.is_active ? '#34B27B20' : '#71717A20',
                      borderColor: ep.is_active ? '#34B27B' : '#71717A',
                      color: ep.is_active ? '#34B27B' : '#71717A',
                    }}
                  >
                    {ep.is_active ? 'active' : 'disabled'}
                  </Badge>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  {ep.events.map((event) => (
                    <Badge
                      key={event}
                      style={{
                        backgroundColor: '#71717A20',
                        borderColor: '#71717A',
                        color: '#71717A',
                      }}
                    >
                      {EVENT_LABELS[event] ?? event}
                    </Badge>
                  ))}
                </div>
                <div className="text-muted-foreground mt-0.5 flex items-center gap-3 text-xs">
                  {ep.description && <span>{ep.description}</span>}
                  <span>Created {new Date(ep.created_at).toLocaleDateString()}</span>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => toggleActive(ep)}
                  title={ep.is_active ? 'Disable' : 'Enable'}
                >
                  {ep.is_active ? (
                    <PowerOff className="h-4 w-4 text-yellow-400" />
                  ) : (
                    <Power className="h-4 w-4 text-green-400" />
                  )}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setDeleteTarget({ id: ep.id, url: ep.url })}
                >
                  <Trash2 className="h-4 w-4 text-red-400" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Delete confirmation dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-400" />
              Delete Webhook Endpoint
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to delete the endpoint <strong>{deleteTarget?.url}</strong>?
              This action cannot be undone. Any pending deliveries will be cancelled.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={deleting}>
              {deleting ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
              Delete Endpoint
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
