'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Terminal,
  Check,
  CheckCircle2,
  ChevronDown,
  Copy,
  Loader2,
  Trash2,
  RefreshCw,
} from 'lucide-react';
import { Button } from '@repo/ui/components/button';
import { Badge } from '@repo/ui/components/badge';
import { Switch } from '@repo/ui/components/switch';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@repo/ui/components/dropdown-menu';
import Image from 'next/image';
import { apiUrl } from '@repo/db/api';
import { fetchJson } from '@/lib/fetch-json';
import { toast } from 'sonner';
import { URL_APP } from '@/lib/branding';
import type { ApiKey, ApiKeyCreated } from '@repo/types';

/* ── IDE setup tab types ── */

export type IdeTab = 'claude-code' | 'cursor' | 'windsurf' | 'vscode';

function IdeIcon({ id, className = 'h-6 w-6' }: { id: string; className?: string }) {
  return (
    <Image
      src={`/${id}.png`}
      alt=""
      className={className}
      draggable={false}
      width={24}
      height={24}
    />
  );
}

const IDE_OPTIONS: { id: IdeTab; label: string }[] = [
  { id: 'claude-code', label: 'Claude Code' },
  { id: 'cursor', label: 'Cursor' },
  { id: 'windsurf', label: 'Windsurf' },
  { id: 'vscode', label: 'VS Code' },
];

/* ── Shared sub-components ── */

export function IdePickerGrid({
  selected,
  onSelect,
}: {
  selected: IdeTab;
  onSelect: (id: IdeTab) => void;
}) {
  return (
    <div className="grid grid-cols-4 gap-2">
      {IDE_OPTIONS.map((ide) => (
        <button
          key={ide.id}
          type="button"
          onClick={() => onSelect(ide.id)}
          className={`flex flex-col items-center gap-1.5 rounded-lg border p-3 transition-all duration-150 ${
            selected === ide.id
              ? 'border-white/20 bg-white/10 text-white'
              : 'border-white/[0.06] text-white/50 hover:border-white/[0.12] hover:text-white/70'
          }`}
        >
          <IdeIcon id={ide.id} />
          <span className="text-[10px] font-medium">{ide.label}</span>
        </button>
      ))}
    </div>
  );
}

function mcpJsonConfig(mcpUrl: string, apiKey: string) {
  return JSON.stringify(
    {
      mcpServers: {
        celune: {
          type: 'http',
          url: mcpUrl,
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
  multiline = false,
}: {
  children: string;
  onCopy: (text: string) => void;
  multiline?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    onCopy(children);
    setCopied(true);
    toast.success('Copied to clipboard');
    setTimeout(() => setCopied(false), 2000);
  }

  if (multiline) {
    return (
      <div className="relative overflow-hidden rounded-lg border border-white/[0.08] bg-[#171717]">
        <div className="max-h-64 overflow-auto px-5 py-4 pr-12">
          <code className="block font-mono text-[13px] leading-7 whitespace-pre-wrap text-white/90">
            {children}
          </code>
        </div>
        <button
          type="button"
          className={`absolute top-3 right-3 flex h-7 w-7 items-center justify-center rounded transition-colors ${
            copied ? 'text-emerald-400' : 'text-white/50 hover:bg-white/10 hover:text-white/[0.66]'
          }`}
          onClick={handleCopy}
        >
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="relative overflow-hidden rounded-lg border border-white/[0.08] bg-[#171717]">
        <div className="overflow-x-hidden px-5 py-3">
          <code className="font-mono text-[13px] leading-7 whitespace-nowrap text-white/90">
            {children}
          </code>
        </div>
        <div className="absolute inset-y-0 right-0 flex items-center">
          <div className="h-full w-12 bg-gradient-to-l from-[#171717] to-transparent" />
          <div className="flex h-full items-center bg-[#171717] pr-3">
            <button
              type="button"
              className={`flex h-7 w-7 items-center justify-center rounded transition-colors ${
                copied
                  ? 'text-emerald-400'
                  : 'text-white/50 hover:bg-white/10 hover:text-white/[0.66]'
              }`}
              onClick={handleCopy}
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Helpers ── */

function resolveIdeName(
  name: string,
  clientMeta?: ApiKey['client_metadata'],
): { label: string; icon: string; version?: string } {
  // Prefer MCP-detected client identity when available
  const clientName = clientMeta?.name;
  const version = clientMeta?.version ?? undefined;
  const source = clientName ?? name;
  const lower = source.toLowerCase();

  if (lower.includes('claude')) return { label: 'Claude Code', icon: 'claude-code', version };
  if (lower.includes('cursor')) return { label: 'Cursor', icon: 'cursor', version };
  if (lower.includes('windsurf')) return { label: 'Windsurf', icon: 'windsurf', version };
  if (lower.includes('cline') || lower.includes('vscode') || lower.includes('vs code'))
    return { label: 'VS Code', icon: 'vscode', version };
  if (lower.includes('cli')) return { label: 'Claude Code', icon: 'claude-code', version };
  return { label: clientName ?? name, icon: 'claude-code', version };
}

function timeAgo(date: string): string {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(date).toLocaleDateString();
}

/* ── Main Panel ── */

interface IdeSetupPanelProps {
  workspaceId: string;
  /** Show connected keys list with revoke (settings mode) vs. onboarding flow */
  variant?: 'settings' | 'onboarding';
}

export function IdeSetupPanel({ workspaceId, variant = 'settings' }: IdeSetupPanelProps) {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);

  // IDE setup state — default to expanded when no connections yet
  const [expanded, setExpanded] = useState(true);
  const [ideMode, setIdeMode] = useState<'cli' | 'mcp'>('cli');
  const [ideTab, setIdeTab] = useState<IdeTab>('claude-code');
  const [generatingKey, setGeneratingKey] = useState(false);
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);

  const [detailsOpen, setDetailsOpen] = useState(false);

  // Device authorization flow
  const [deviceCode, setDeviceCode] = useState('');
  const [deviceCodeVerifying, setDeviceCodeVerifying] = useState(false);
  const [deviceCodeError, setDeviceCodeError] = useState<string | null>(null);

  const fetchKeys = useCallback(async () => {
    try {
      const data = await fetchJson<ApiKey[]>(
        apiUrl(`/api/api-keys?workspace_id=${workspaceId}&include_org=true`),
      );
      const active = data.filter((k) => !k.revoked_at);
      setKeys(active);
      // Auto-collapse setup when any key exists (pending or connected)
      if (active.length > 0) setExpanded(false);
    } catch {
      // Silent
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    fetchKeys();
  }, [fetchKeys]);

  const connected = keys.filter((k) => k.last_used_at != null);
  const pending = keys.filter((k) => k.last_used_at == null);
  const hasConnected = connected.length > 0;
  const hasPending = pending.length > 0;

  // Poll for new connections when expanded OR when pending keys are waiting
  useEffect(() => {
    if (!expanded && !hasPending) return;
    const interval = setInterval(fetchKeys, 5_000);
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') fetchKeys();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [expanded, hasPending, fetchKeys]);

  function handleDeviceCodeChange(value: string) {
    const clean = value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (clean.length <= 8) {
      setDeviceCode(clean.length > 4 ? `${clean.slice(0, 4)}-${clean.slice(4)}` : clean);
    }
    setDeviceCodeError(null);
  }

  async function handleDeviceVerify() {
    const code = deviceCode.replace('-', '');
    if (code.length !== 8) return;

    setDeviceCodeVerifying(true);
    setDeviceCodeError(null);

    try {
      const res = await fetch(apiUrl('/api/auth/device/verify'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_code: deviceCode, workspace_id: workspaceId }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setDeviceCodeError(body.error || 'Verification failed');
        return;
      }

      toast.success('Device authorized! Your terminal will finish setup automatically.');
      setDeviceCode('');
      setExpanded(false);
      // Poll until the CLI uses the key (transitions from pending → connected)
      void fetchKeys();
      setTimeout(() => void fetchKeys(), 3_000);
      setTimeout(() => void fetchKeys(), 8_000);
      setTimeout(() => void fetchKeys(), 15_000);
    } catch {
      setDeviceCodeError('Could not reach server. Try again.');
    } finally {
      setDeviceCodeVerifying(false);
    }
  }

  async function handleGenerateKey() {
    setGeneratingKey(true);
    try {
      const result = await fetchJson<ApiKeyCreated>(
        apiUrl(`/api/api-keys?workspace_id=${workspaceId}`),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            workspace_id: workspaceId,
            name: 'IDE Connection',
            environment: 'live',
            scopes: ['write'],
          }),
        },
      );
      setGeneratedKey(result.plaintext_key);
    } catch {
      toast.error('Failed to generate API key');
    } finally {
      setGeneratingKey(false);
    }
  }

  async function handleRevoke(keyId: string) {
    try {
      await fetchJson(apiUrl(`/api/api-keys/${keyId}?workspace_id=${workspaceId}`), {
        method: 'DELETE',
      });
      toast.success('Connection revoked');
      setRevoking(null);
      fetchKeys();
    } catch {
      toast.error('Failed to revoke connection');
    }
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text);
  }

  async function toggleRealtime(keyId: string, enabled: boolean) {
    // Optimistic update
    setKeys((prev) => prev.map((k) => (k.id === keyId ? { ...k, realtime_enabled: enabled } : k)));
    try {
      await fetchJson(apiUrl(`/api/api-keys/${keyId}?workspace_id=${workspaceId}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ realtime_enabled: enabled }),
      });
    } catch {
      setKeys((prev) =>
        prev.map((k) => (k.id === keyId ? { ...k, realtime_enabled: !enabled } : k)),
      );
      toast.error('Failed to update real-time setting');
    }
  }

  const origin = typeof window !== 'undefined' ? window.location.origin : URL_APP;
  const mcpUrl = `${origin}/api/mcp`;

  if (loading) {
    return (
      <div className="border-border overflow-hidden rounded-lg border">
        <div className="p-6">
          <div className="mb-4 flex items-center justify-between">
            <div className="space-y-1.5">
              <div className="bg-surface-200 h-5 w-44 animate-pulse rounded" />
              <div className="bg-surface-200 h-4 w-72 animate-pulse rounded" />
            </div>
          </div>
          <div className="bg-surface-200 h-14 w-full animate-pulse rounded-lg" />
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="border-border overflow-hidden rounded-lg border">
        <div className="p-6">
          {/* Header */}
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/[0.06]">
                <Terminal className="h-5 w-5 text-white/[0.66]" />
              </div>
              <div className="space-y-1">
                <h3 className="text-foreground text-sm font-semibold">IDE Connections</h3>
                <p className="text-foreground-lighter text-xs">
                  {hasConnected
                    ? 'Active connections between your coding tools and Celune.'
                    : 'Connect your IDE to collaborate with your agents.'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {variant === 'settings' && !expanded && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setRefreshing(true);
                    fetchKeys();
                  }}
                  disabled={refreshing}
                  className="h-8 w-8 p-0"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
                </Button>
              )}
              {hasConnected && !expanded ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="border-white/10 text-white/70 hover:bg-white/5 hover:text-white"
                    >
                      <CheckCircle2 className="text-brand h-3.5 w-3.5" />
                      Connected
                      <ChevronDown className="ml-1 h-3 w-3 opacity-50" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="end"
                    sideOffset={4}
                    className="min-w-[var(--radix-dropdown-menu-trigger-width)] border-white/10 bg-[#1a1a1a]"
                  >
                    <DropdownMenuItem
                      onClick={() => setExpanded(true)}
                      className="cursor-pointer text-sm text-white/70 focus:bg-black/30 focus:text-white/70"
                    >
                      Manage
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : hasConnected || !expanded ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="border-white/10 text-white/70 hover:bg-white/5 hover:text-white"
                  onClick={() => setExpanded(!expanded)}
                >
                  {hasConnected ? (expanded ? 'Cancel' : 'Manage') : '+ Add Connection'}
                </Button>
              ) : null}
            </div>
          </div>

          {/* Connected keys list (settings variant) */}
          {variant === 'settings' && keys.length > 0 && !expanded && (
            <div className="divide-border divide-y rounded-lg border border-white/[0.06]">
              {connected.map((key) => {
                const ide = resolveIdeName(key.name, key.client_metadata);
                return (
                  <div key={key.id} className="flex items-center gap-3 px-4 py-3">
                    <Image
                      src={`/${ide.icon}.png`}
                      alt=""
                      className="h-8 w-8 rounded"
                      draggable={false}
                      width={32}
                      height={32}
                    />
                    <div className="min-w-0 flex-1">
                      <span className="text-foreground text-sm font-medium">
                        {ide.label}
                        {key.client_metadata?.plan && (
                          <span className="text-foreground-lighter ml-1 font-normal">
                            – {key.client_metadata.plan}
                          </span>
                        )}
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {key.last_used_at && (
                        <span className="text-foreground-lighter text-xs">
                          Last active {timeAgo(key.last_used_at)}
                        </span>
                      )}
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                        Connected
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setRevoking(key.id)}
                      className="text-foreground-lighter hover:text-destructive shrink-0 rounded p-1.5 transition-colors hover:bg-white/5"
                      aria-label="Revoke connection"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                );
              })}
              {keys
                .filter((k) => k.last_used_at == null)
                .map((key) => {
                  const ide = resolveIdeName(key.name, key.client_metadata);
                  return (
                    <div key={key.id} className="flex items-center gap-3 px-4 py-3">
                      <Image
                        src={`/${ide.icon}.png`}
                        alt=""
                        className="h-8 w-8 rounded"
                        draggable={false}
                        width={32}
                        height={32}
                      />
                      <div className="min-w-0 flex-1">
                        <span className="text-foreground text-sm font-medium">{ide.label}</span>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-white/40" />
                        <span className="text-foreground-lighter text-xs">
                          Waiting for first connection…
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setRevoking(key.id)}
                        className="text-foreground-lighter hover:text-destructive shrink-0 rounded p-1.5 transition-colors hover:bg-white/5"
                        aria-label="Revoke connection"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  );
                })}
            </div>
          )}

          {/* Connection Settings + Details — below key list */}
          {variant === 'settings' && connected.length > 0 && !expanded && (
            <div className="mt-4 border-t border-white/[0.06] pt-4">
              {/* Settings — toggleable controls */}
              {connected.map((key) => (
                <div key={key.id} className="flex items-center justify-between py-2">
                  <div>
                    <p className="text-foreground text-sm">Real-time workspace events</p>
                    <p className="text-foreground-lighter text-xs">
                      Stream task updates, agent activity, and workspace changes to your IDE.
                    </p>
                  </div>
                  <Switch
                    checked={key.realtime_enabled}
                    onCheckedChange={(v) => toggleRealtime(key.id, v)}
                  />
                </div>
              ))}

              {/* Details — collapsible accordion */}
              <div className="mt-3 border-t border-white/[0.06] pt-3">
                <button
                  type="button"
                  onClick={() => setDetailsOpen(!detailsOpen)}
                  className="text-foreground-lighter hover:text-foreground flex w-full items-center gap-1.5 text-xs transition-colors"
                >
                  <ChevronDown
                    className={`h-3 w-3 transition-transform duration-200 ${detailsOpen ? 'rotate-0' : '-rotate-90'}`}
                  />
                  Connection Details
                </button>
                <div
                  className="grid transition-[grid-template-rows] duration-200 ease-in-out"
                  style={{ gridTemplateRows: detailsOpen ? '1fr' : '0fr' }}
                >
                  <div className="overflow-hidden">
                    <div className="mt-3 space-y-3">
                      {connected.map((key) => {
                        const ide = resolveIdeName(key.name, key.client_metadata);
                        return (
                          <div
                            key={key.id}
                            className="grid grid-cols-[1fr_1fr] gap-x-6 gap-y-2 text-xs"
                          >
                            {connected.length > 1 && (
                              <div className="text-foreground col-span-2 mb-1 text-xs font-medium">
                                {ide.label}
                              </div>
                            )}
                            <div className="flex items-center justify-between">
                              <span className="text-foreground-lighter">API Key</span>
                              <span className="text-foreground font-mono text-xs">
                                {key.key_prefix}...
                              </span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-foreground-lighter">Permissions</span>
                              <div className="flex gap-1">
                                {key.scopes.map((scope) => (
                                  <Badge
                                    key={scope}
                                    variant="outline"
                                    className="px-1.5 py-0 text-[10px]"
                                  >
                                    {scope}
                                  </Badge>
                                ))}
                              </div>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-foreground-lighter">Environment</span>
                              <Badge
                                variant={key.environment === 'live' ? 'emerald-dark' : 'blue-dark'}
                                className="px-1.5 py-0 text-[10px]"
                              >
                                {key.environment}
                              </Badge>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-foreground-lighter">Rate limit</span>
                              <span className="text-foreground text-xs">
                                {key.rate_limit_per_minute} req/min
                              </span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-foreground-lighter">Created</span>
                              <span className="text-foreground text-xs">
                                {new Date(key.created_at).toLocaleDateString('en-US', {
                                  month: 'short',
                                  day: 'numeric',
                                  year: 'numeric',
                                })}
                              </span>
                            </div>
                            {key.client_metadata?.name && (
                              <div className="flex items-center justify-between">
                                <span className="text-foreground-lighter">MCP Client</span>
                                <span className="text-foreground text-xs">
                                  {key.client_metadata.name}
                                  {key.client_metadata.version
                                    ? ` v${key.client_metadata.version}`
                                    : ''}
                                </span>
                              </div>
                            )}
                            {key.client_metadata?.plan && (
                              <div className="flex items-center justify-between">
                                <span className="text-foreground-lighter">Plan</span>
                                <span className="text-foreground text-xs">
                                  {key.client_metadata.plan}
                                </span>
                              </div>
                            )}
                            {key.client_metadata?.user_agent && (
                              <div className="col-span-2 flex items-center justify-between">
                                <span className="text-foreground-lighter">User Agent</span>
                                <span className="text-foreground max-w-[240px] truncate font-mono text-[10px]">
                                  {key.client_metadata.user_agent}
                                </span>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Empty state (no keys, not expanded) */}
          {keys.length === 0 && !expanded && (
            <div className="bg-surface-75 rounded-lg border border-dashed border-white/10 p-6 text-center">
              <Terminal className="text-foreground-lighter mx-auto mb-2 h-6 w-6" />
              <p className="text-foreground text-sm font-medium">No IDE connections</p>
              <p className="text-foreground-lighter mt-1 text-xs">
                Click &quot;+ Add Connection&quot; to connect your IDE.
              </p>
            </div>
          )}

          {/* Expandable IDE setup */}
          <div
            className="grid transition-[grid-template-rows] duration-300 ease-in-out"
            style={{ gridTemplateRows: expanded ? '1fr' : '0fr' }}
          >
            <div className="overflow-hidden">
              <div className="mt-5 space-y-4 border-t border-white/[0.06] pt-5">
                {/* Automatic / Manual toggle */}
                <div className="flex rounded-lg border border-white/[0.08] p-0.5">
                  <button
                    type="button"
                    onClick={() => setIdeMode('cli')}
                    className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-all duration-150 ${
                      ideMode === 'cli'
                        ? 'bg-white/10 text-white'
                        : 'text-white/50 hover:text-white/70'
                    }`}
                  >
                    Automatic
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIdeMode('mcp');
                      if (!generatedKey && !generatingKey) void handleGenerateKey();
                    }}
                    className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-all duration-150 ${
                      ideMode === 'mcp'
                        ? 'bg-white/10 text-white'
                        : 'text-white/50 hover:text-white/70'
                    }`}
                  >
                    Manual
                  </button>
                </div>

                {/* Automatic tab — Device Authorization Flow */}
                {ideMode === 'cli' && (
                  <div className="space-y-4">
                    <IdePickerGrid selected={ideTab} onSelect={setIdeTab} />

                    <div>
                      <p className="mb-3 text-xs text-white/[0.66]">
                        Run this command in your terminal:
                      </p>
                      <CodeBlock onCopy={copyToClipboard}>
                        {`npx @celuneai/cli setup --tool ${ideTab === 'vscode' ? 'cline' : ideTab}`}
                      </CodeBlock>
                    </div>

                    <div>
                      <p className="mb-2 text-xs text-white/[0.66]">
                        Then enter the code shown in your terminal:
                      </p>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={deviceCode}
                          onChange={(e) => handleDeviceCodeChange(e.target.value)}
                          placeholder="XXXX-XXXX"
                          autoComplete="off"
                          className="flex-1 rounded-lg border border-white/[0.08] bg-[#171717] px-4 py-2.5 text-center font-mono text-sm tracking-[0.2em] text-white/90 placeholder:text-white/20 focus:border-white/20 focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={handleDeviceVerify}
                          disabled={deviceCode.replace('-', '').length !== 8 || deviceCodeVerifying}
                          className="rounded-lg bg-white/10 px-4 py-2.5 text-xs font-medium text-white transition-colors hover:bg-white/[0.15] disabled:pointer-events-none disabled:opacity-40"
                        >
                          {deviceCodeVerifying ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            'Verify'
                          )}
                        </button>
                      </div>
                      {deviceCodeError && (
                        <p className="mt-1.5 text-xs text-red-400">{deviceCodeError}</p>
                      )}
                    </div>
                  </div>
                )}

                {/* Manual tab */}
                {ideMode === 'mcp' && (
                  <div className="space-y-4">
                    <IdePickerGrid selected={ideTab} onSelect={setIdeTab} />
                    {generatingKey ? (
                      <div className="flex items-center justify-center py-4">
                        <Loader2 className="h-4 w-4 animate-spin text-white/[0.66]" />
                        <span className="ml-2 text-xs text-white/[0.66]">
                          Generating API key...
                        </span>
                      </div>
                    ) : generatedKey ? (
                      <div>
                        {ideTab === 'claude-code' && (
                          <>
                            <p className="mb-2 text-xs text-white/[0.66]">
                              Paste into terminal to add the Celune MCP server
                            </p>
                            <CodeBlock onCopy={copyToClipboard} multiline>
                              {`claude mcp add celune --transport http ${mcpUrl} --header "Authorization: Bearer ${generatedKey}" --scope user`}
                            </CodeBlock>
                          </>
                        )}

                        {ideTab === 'cursor' && (
                          <>
                            <p className="mb-2 text-xs text-white/[0.66]">
                              Add to ~/.cursor/mcp.json
                            </p>
                            <CodeBlock onCopy={copyToClipboard} multiline>
                              {mcpJsonConfig(mcpUrl, generatedKey)}
                            </CodeBlock>
                          </>
                        )}

                        {ideTab === 'windsurf' && (
                          <>
                            <p className="mb-2 text-xs text-white/[0.66]">
                              Add to ~/.codeium/windsurf/mcp_config.json
                            </p>
                            <CodeBlock onCopy={copyToClipboard} multiline>
                              {mcpJsonConfig(mcpUrl, generatedKey)}
                            </CodeBlock>
                          </>
                        )}

                        {ideTab === 'vscode' && (
                          <>
                            <p className="mb-2 text-xs text-white/[0.66]">
                              Add to .vscode/mcp.json in your project
                            </p>
                            <CodeBlock onCopy={copyToClipboard} multiline>
                              {mcpJsonConfig(mcpUrl, generatedKey)}
                            </CodeBlock>
                          </>
                        )}
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Revoke confirmation dialog (settings only) */}
      {variant === 'settings' && revoking && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-surface-100 border-border w-full max-w-sm rounded-lg border p-6 shadow-xl">
            <h3 className="text-foreground text-base font-semibold">Revoke Connection?</h3>
            <p className="text-foreground-lighter mt-2 text-sm">
              This will immediately disconnect this IDE from Celune. The tool will need to be
              reconnected to resume agent collaboration.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setRevoking(null)}>
                Cancel
              </Button>
              <Button variant="destructive" size="sm" onClick={() => handleRevoke(revoking)}>
                Revoke
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
