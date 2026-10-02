'use client';

import { useCallback, useEffect, useState } from 'react';
import Image from 'next/image';
import {
  CheckCircle2,
  Circle,
  ExternalLink,
  KeyRound,
  Loader2,
  Settings,
  XCircle,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@repo/ui/components/button';
import { Badge } from '@repo/ui/components/badge';
import { Input } from '@repo/ui/components/input';
import { Label } from '@repo/ui/components/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@repo/ui/components/dialog';
import { apiUrl } from '@repo/db/api';
import { fetchJson } from '@/lib/fetch-json';
import { useWorkspace } from '@/providers/workspace-provider';
import { getIntegrationLogoPath } from '@/lib/integrations-registry';
import type { IntegrationMeta, IntegrationStatus, IntegrationStatusResult } from '@repo/types';
import { GitHubReviewSettings } from '@/components/settings/github-review-settings';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AI_PROVIDER_IDS = new Set(['anthropic', 'openai', 'elevenlabs', 'groq']);

const PROVIDER_KEY_HINTS: Record<string, { placeholder: string; description: string }> = {
  anthropic: {
    placeholder: 'sk-ant-...',
    description: 'Powers AI agents, chat, and task generation.',
  },
  openai: {
    placeholder: 'sk-...',
    description: 'Enables GPT-powered agents and transcription.',
  },
  elevenlabs: {
    placeholder: 'xi-...',
    description: 'Voice synthesis and cloning. Included in your plan — BYOK for higher limits.',
  },
  groq: {
    placeholder: 'gsk_...',
    description: 'Fast LLM inference for Groq-powered agents.',
  },
};

const STATUS_DISPLAY: Record<
  IntegrationStatus,
  { label: string; color: string; icon: typeof CheckCircle2 }
> = {
  connected: { label: 'Connected', color: 'text-green-400', icon: CheckCircle2 },
  disconnected: { label: 'Not connected', color: 'text-foreground-lighter', icon: Circle },
  error: { label: 'Error', color: 'text-red-400', icon: XCircle },
  not_configured: { label: 'Not configured', color: 'text-foreground-lighter', icon: Settings },
};

// ---------------------------------------------------------------------------
// BYOK inline form
// ---------------------------------------------------------------------------

function ByokForm({
  integrationId,
  onKeyAdded,
}: {
  integrationId: string;
  onKeyAdded: () => void;
}) {
  const { activeWorkspace } = useWorkspace();
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  const hints = PROVIDER_KEY_HINTS[integrationId];

  const handleSubmit = async () => {
    if (!name.trim() || !key.trim()) return;
    setSaving(true);
    setResult(null);
    try {
      const params = activeWorkspace?.id ? `?workspace_id=${activeWorkspace.id}` : '';
      await fetchJson(apiUrl(`/api/provider-keys${params}`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: integrationId, name: name.trim(), key: key.trim() }),
      });
      setResult({ success: true, message: 'Key validated and saved.' });
      toast.success('API key connected');
      setName('');
      setKey('');
      onKeyAdded();
    } catch (err) {
      setResult({
        success: false,
        message: err instanceof Error ? err.message : 'Failed to save key',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="byok-name" className="text-xs">
          Key Name
        </Label>
        <Input
          id="byok-name"
          placeholder="e.g. Production Key"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={255}
          className="h-8 text-sm"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="byok-key" className="text-xs">
          API Key
        </Label>
        <Input
          id="byok-key"
          type="password"
          placeholder={hints?.placeholder ?? 'Paste your key'}
          value={key}
          onChange={(e) => setKey(e.target.value)}
          autoComplete="off"
          className="h-8 text-sm"
        />
        <p className="text-foreground-muted text-[11px]">
          Validated against the provider, then AES-256 encrypted. Never stored in plaintext.
        </p>
      </div>

      {result && (
        <div
          className={`flex items-start gap-2 rounded-md p-2.5 text-xs ${
            result.success
              ? 'bg-success/10 text-success-foreground'
              : 'bg-destructive/10 text-destructive'
          }`}
        >
          {result.success ? (
            <CheckCircle2 size={13} className="mt-0.5 shrink-0" />
          ) : (
            <XCircle size={13} className="mt-0.5 shrink-0" />
          )}
          <span>{result.message}</span>
        </div>
      )}

      <Button
        size="sm"
        className="w-full"
        onClick={handleSubmit}
        disabled={saving || !name.trim() || !key.trim()}
      >
        {saving ? (
          <>
            <Loader2 size={13} className="mr-1.5 animate-spin" />
            Validating...
          </>
        ) : (
          <>
            <KeyRound size={13} className="mr-1.5" />
            Connect Key
          </>
        )}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main dialog
// ---------------------------------------------------------------------------

interface IntegrationDialogProps {
  open: boolean;
  onClose: () => void;
  integration: IntegrationMeta | null;
  status: IntegrationStatusResult | undefined;
  onStatusChange?: () => void;
  onNavigateTab?: (tab: string) => void;
}

export function IntegrationDialog({
  open,
  onClose,
  integration,
  status,
  onStatusChange,
  onNavigateTab,
}: IntegrationDialogProps) {
  const { activeWorkspace } = useWorkspace();
  const [showByokForm, setShowByokForm] = useState(false);
  const [planUsage, setPlanUsage] = useState<{
    used: number;
    limit: number | null;
    plan: string;
  } | null>(null);
  const [ttsUsage, setTtsUsage] = useState<{
    used: number;
    limit: number | null;
  } | null>(null);
  const [usageFetchError, setUsageFetchError] = useState(false);
  const [usageRetrying, setUsageRetrying] = useState(false);

  // Fetch plan usage when dialog opens for an AI provider
  const fetchUsage = useCallback(() => {
    if (!integration || !AI_PROVIDER_IDS.has(integration.id)) return;
    if (!activeWorkspace?.id) return;

    setUsageFetchError(false);
    fetchJson<{ plan: string; metrics: { key: string; used: number; limit: number | null }[] }>(
      apiUrl(`/api/workspaces/usage?workspace_id=${activeWorkspace.id}`),
    )
      .then((data) => {
        const llmMetric = data.metrics?.find((m) => m.key === 'llm_cost');
        if (llmMetric) {
          setPlanUsage({ used: llmMetric.used, limit: llmMetric.limit, plan: data.plan });
        }
        const ttsMet = data.metrics?.find((m) => m.key === 'tts');
        if (ttsMet) {
          setTtsUsage({ used: ttsMet.used, limit: ttsMet.limit });
        }
      })
      .catch(() => {
        setUsageFetchError(true);
      })
      .finally(() => setUsageRetrying(false));
  }, [integration, activeWorkspace?.id]);

  useEffect(() => {
    if (!open) return;
    fetchUsage();
  }, [open, fetchUsage]);

  const handleKeyAdded = useCallback(() => {
    setShowByokForm(false);
    onStatusChange?.();
  }, [onStatusChange]);

  const handleOpenChange = useCallback(
    (isOpen: boolean) => {
      if (!isOpen) {
        onClose();
        setShowByokForm(false);
        setPlanUsage(null);
        setTtsUsage(null);
        setUsageFetchError(false);
      }
    },
    [onClose],
  );

  if (!integration) return null;

  const logoPath = getIntegrationLogoPath(integration.id);
  const currentStatus = status?.status ?? 'disconnected';
  const statusConfig = STATUS_DISPLAY[currentStatus];
  const StatusIcon = statusConfig.icon;
  const isAiProvider = AI_PROVIDER_IDS.has(integration.id);
  const isConnected = currentStatus === 'connected';

  // Determine the action to show
  const getAction = () => {
    switch (integration.id) {
      case 'github':
        return {
          label: isConnected ? 'Manage Connection' : 'Connect GitHub',
          tab: 'workspace',
        };
      case 'slack':
        return {
          label: isConnected ? 'Manage Connection' : 'Connect Slack',
          tab: 'notifications',
        };
      case 'stripe':
        return { label: 'Manage Billing', tab: 'billing' };
      default:
        return null;
    }
  };

  const action = getAction();
  const hints = PROVIDER_KEY_HINTS[integration.id];

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="bg-surface-200 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg">
              {logoPath ? (
                <Image
                  src={logoPath}
                  alt={integration.name}
                  className="h-5 w-5 object-contain"
                  width={20}
                  height={20}
                />
              ) : (
                <Settings className="text-foreground h-5 w-5" />
              )}
            </div>
            <div>
              <DialogTitle className="text-base">{integration.name}</DialogTitle>
              <DialogDescription className="mt-0.5 flex items-center gap-1.5">
                <StatusIcon className={`h-3 w-3 ${statusConfig.color}`} />
                <span className={`text-xs ${statusConfig.color}`}>{statusConfig.label}</span>
                {status?.details && (
                  <>
                    <span className="text-foreground-muted">·</span>
                    <span className="text-foreground-lighter text-xs">{status.details}</span>
                  </>
                )}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-5 pt-2">
          {/* Description */}
          <p className="text-foreground-lighter text-sm leading-relaxed">
            {integration.description}
          </p>

          {/* ── AI Provider: dual path ── */}
          {isAiProvider && (
            <div className="space-y-3">
              {/* Path 1: Use Celune's (plan-included) */}
              <div className="border-border rounded-lg border p-4">
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-2.5">
                    <Zap size={16} className="text-brand mt-0.5 shrink-0" />
                    <div>
                      <p className="text-foreground text-sm font-medium">Use Celune&apos;s</p>
                      <p className="text-foreground-lighter mt-0.5 text-xs">
                        Included in your plan. Usage is metered against your plan limits.
                      </p>
                    </div>
                  </div>
                  <Badge variant="secondary" className="text-foreground-light shrink-0 text-[10px]">
                    <Zap size={10} className="mr-1" />
                    Plan
                  </Badge>
                </div>

                {/* Mini usage meter */}
                {planUsage && planUsage.limit !== null && (
                  <div className="mt-3 space-y-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-foreground-lighter">
                        LLM budget: ${planUsage.used.toFixed(2)} / ${planUsage.limit.toFixed(0)}
                      </span>
                      <span className="text-foreground-muted">
                        {Math.round((planUsage.used / planUsage.limit) * 100)}%
                      </span>
                    </div>
                    <div className="bg-surface-200 h-1.5 w-full overflow-hidden rounded-full">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${Math.min(100, (planUsage.used / planUsage.limit) * 100)}%`,
                          backgroundColor:
                            planUsage.used / planUsage.limit > 0.8
                              ? 'var(--warning-default)'
                              : 'var(--brand-default)',
                        }}
                      />
                    </div>
                  </div>
                )}
                {planUsage && planUsage.limit === null && (
                  <p className="text-foreground-muted mt-2 text-[11px]">Unlimited on your plan.</p>
                )}

                {/* TTS usage meter for ElevenLabs */}
                {integration.id === 'elevenlabs' && ttsUsage && ttsUsage.limit !== null && (
                  <div className="mt-2 space-y-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-foreground-lighter">
                        TTS: {ttsUsage.used.toFixed(1)} / {ttsUsage.limit.toFixed(0)} min
                      </span>
                      <span className="text-foreground-muted">
                        {Math.round((ttsUsage.used / ttsUsage.limit) * 100)}%
                      </span>
                    </div>
                    <div className="bg-surface-200 h-1.5 w-full overflow-hidden rounded-full">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${Math.min(100, (ttsUsage.used / ttsUsage.limit) * 100)}%`,
                          backgroundColor:
                            ttsUsage.used / ttsUsage.limit > 0.8
                              ? 'var(--warning-default)'
                              : 'var(--brand-default)',
                        }}
                      />
                    </div>
                  </div>
                )}
                {integration.id === 'elevenlabs' && ttsUsage && ttsUsage.limit === null && (
                  <p className="text-foreground-muted mt-2 text-[11px]">
                    TTS: Unlimited on your plan.
                  </p>
                )}

                {/* Usage fetch error */}
                {usageFetchError && !planUsage && (
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-foreground-muted text-[11px]">Usage unavailable</span>
                    <button
                      type="button"
                      className="text-brand hover:text-brand/80 text-[11px] underline underline-offset-2"
                      disabled={usageRetrying}
                      onClick={() => {
                        setUsageRetrying(true);
                        fetchUsage();
                      }}
                    >
                      {usageRetrying ? 'Retrying...' : 'Retry'}
                    </button>
                  </div>
                )}
              </div>

              {/* Path 2: Bring Your Own Key */}
              <div className="border-border rounded-lg border p-4">
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-2.5">
                    <KeyRound size={16} className="text-foreground-light mt-0.5 shrink-0" />
                    <div>
                      <p className="text-foreground text-sm font-medium">Bring Your Own Key</p>
                      <p className="text-foreground-lighter mt-0.5 text-xs">
                        {hints?.description ?? 'Connect your own API key for unlimited usage.'}{' '}
                        Bypasses plan limits — you pay the provider directly.
                      </p>
                    </div>
                  </div>
                  {isConnected && (
                    <Badge
                      variant="secondary"
                      className="text-success-foreground shrink-0 gap-1 text-[10px]"
                    >
                      <CheckCircle2 size={10} />
                      BYOK
                    </Badge>
                  )}
                </div>

                {/* BYOK action area */}
                <div className="mt-3">
                  {isConnected && !showByokForm ? (
                    <div className="flex items-center justify-between">
                      <span className="text-foreground-muted text-xs">
                        Your own key is connected.
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={() => {
                          onClose();
                          onNavigateTab?.('developer');
                        }}
                      >
                        Manage Keys
                      </Button>
                    </div>
                  ) : showByokForm ? (
                    <ByokForm integrationId={integration.id} onKeyAdded={handleKeyAdded} />
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full"
                      onClick={() => setShowByokForm(true)}
                    >
                      <KeyRound size={13} className="mr-1.5" />
                      Add Your Own Key
                    </Button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ── OAuth/platform integrations ── */}
          {!isAiProvider && (
            <div className="space-y-3">
              {/* Scope info */}
              <div className="flex items-center gap-2">
                <span className="text-foreground-lighter text-xs font-medium tracking-wider uppercase">
                  Scope
                </span>
                <span className="text-foreground text-sm">
                  {integration.scope === 'platform' ? 'Platform-level' : 'Workspace-level'}
                </span>
              </div>

              {/* Platform integration status */}
              {integration.scope === 'platform' && (
                <p className="text-foreground-lighter text-xs">
                  {isConnected
                    ? 'Configured by the platform administrator.'
                    : 'Requires an environment variable to be configured by the platform admin.'}
                </p>
              )}

              {/* Action button for workspace-scoped OAuth integrations */}
              {action && (
                <Button
                  size="sm"
                  variant={isConnected ? 'outline' : 'default'}
                  className="w-full"
                  onClick={() => {
                    onClose();
                    onNavigateTab?.(action.tab);
                  }}
                >
                  {action.label}
                </Button>
              )}
            </div>
          )}

          {/* GitHub PR review settings (shown when GitHub is connected) */}
          {integration.id === 'github' && isConnected && (
            <div className="border-border border-t pt-4">
              <GitHubReviewSettings />
            </div>
          )}

          {/* External link */}
          <Button
            variant="ghost"
            size="sm"
            className="text-foreground-lighter w-full justify-center text-xs"
            onClick={() => window.open(integration.url, '_blank', 'noopener')}
          >
            Visit {integration.name}
            <ExternalLink className="ml-1.5 h-3 w-3" />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
