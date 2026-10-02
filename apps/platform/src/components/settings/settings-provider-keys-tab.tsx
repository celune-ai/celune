'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Loader2,
  Plus,
  Trash2,
  KeyRound,
  CheckCircle2,
  XCircle,
  Clock,
  Zap,
  History,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  RotateCw,
  Gauge,
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
  DialogFooter,
} from '@repo/ui/components/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@repo/ui/components/select';
import { apiUrl } from '@repo/db/api';
import { fetchJson } from '@/lib/fetch-json';
import { useWorkspace } from '@/providers/workspace-provider';
import { usePlan } from '@/hooks/use-plan';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ProviderKey {
  id: string;
  provider: SupportedProvider;
  name: string;
  key_suffix: string;
  is_active: boolean;
  last_used_at: string | null;
  last_validated_at: string | null;
  last_validation_status: 'valid' | 'invalid' | 'rate_limited' | null;
  created_at: string;
  updated_at?: string;
}

interface AiBudget {
  edition: 'cloud' | 'community';
  host_fallback_enabled: boolean;
  token_limit_monthly: number | null;
  requests_per_minute: number | null;
  tokens_used_month: number;
  period_start: string;
  trial: { budget: number; used: number } | null;
}

import type { SupportedProvider } from '@repo/types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** AI model providers — users MUST connect their own keys */
const AI_MODEL_PROVIDERS: SupportedProvider[] = [
  'anthropic',
  'openai',
  'groq',
  'google_gemini',
  'mistral',
];

/** Voice/TTS providers — included in plan, usage metered */
const PLAN_MANAGED_PROVIDERS: SupportedProvider[] = ['elevenlabs'];

const ALL_BYOK_PROVIDERS: SupportedProvider[] = [...AI_MODEL_PROVIDERS, ...PLAN_MANAGED_PROVIDERS];

const PROVIDER_META: Record<
  SupportedProvider,
  { label: string; placeholder: string; color: string; description: string }
> = {
  anthropic: {
    label: 'Anthropic',
    placeholder: 'sk-ant-...',
    color: 'text-warning-foreground',
    description: 'Claude models — required for AI agents, chat, and task generation.',
  },
  openai: {
    label: 'OpenAI',
    placeholder: 'sk-...',
    color: 'text-success-foreground',
    description: 'GPT models — optional, enables OpenAI-powered agents.',
  },
  elevenlabs: {
    label: 'ElevenLabs',
    placeholder: 'xi-...',
    color: 'text-brand',
    description: 'Voice synthesis — included in your plan. Connect your own key for higher limits.',
  },
  groq: {
    label: 'Groq',
    placeholder: 'gsk_...',
    color: 'text-foreground-light',
    description: 'Fast inference — optional, enables Groq-powered agents.',
  },
  google_gemini: {
    label: 'Google Gemini',
    placeholder: 'AIza...',
    color: 'text-info-foreground',
    description: 'Gemini models — optional, enables Google AI-powered agents.',
  },
  mistral: {
    label: 'Mistral',
    placeholder: 'sk-...',
    color: 'text-warning-foreground',
    description: 'Mistral models — optional, enables Mistral-powered agents.',
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTokens(n: number): string {
  return new Intl.NumberFormat('en-US').format(n);
}

/** Empty string means no cap; anything else must be a whole number. */
function parseCap(value: string): number | null | undefined {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  if (!/^\d+$/.test(trimmed)) return undefined;
  return Number(trimmed);
}

function formatDate(iso: string | null): string {
  if (!iso) return 'Never';
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

function ProviderIcon({ provider }: { provider: SupportedProvider }) {
  const meta = PROVIDER_META[provider];
  return (
    <div className="bg-surface-200 flex h-8 w-8 shrink-0 items-center justify-center rounded-md">
      <KeyRound size={14} className={meta.color} aria-hidden="true" />
    </div>
  );
}

function ValidationBadge({ status }: { status: ProviderKey['last_validation_status'] }) {
  if (!status) return null;

  switch (status) {
    case 'valid':
      return (
        <Badge variant="secondary" className="text-success-foreground gap-1 text-xs">
          <CheckCircle2 size={11} aria-hidden="true" />
          Valid
        </Badge>
      );
    case 'invalid':
      return (
        <Badge variant="destructive" className="gap-1 text-xs">
          <XCircle size={11} aria-hidden="true" />
          Invalid
        </Badge>
      );
    case 'rate_limited':
      return (
        <Badge variant="outline" className="text-warning-foreground gap-1 text-xs">
          <Clock size={11} aria-hidden="true" />
          Rate limited
        </Badge>
      );
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Upgrade prompt (shown when byok feature not in plan)
// ---------------------------------------------------------------------------

function UpgradePrompt() {
  return (
    <div className="border-border flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
      <div className="bg-surface-200 mb-4 flex h-12 w-12 items-center justify-center rounded-full">
        <KeyRound size={20} className="text-foreground-light" aria-hidden="true" />
      </div>
      <h3 className="text-foreground mb-1 text-sm font-semibold">Bring Your Own API Keys</h3>
      <p className="text-foreground-lighter mb-4 max-w-sm text-sm">
        Connect your own Anthropic, OpenAI, and Groq API keys to power your AI agents. Available on
        Pro and above.
      </p>
      <Button
        size="sm"
        onClick={() => (window.location.href = window.location.pathname + '?tab=billing')}
      >
        Upgrade to Pro
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function SettingsProviderKeysTab() {
  const { activeWorkspace } = useWorkspace();

  // Feature gate: BYOK is in every plan, so this reads the org's plan
  const { hasFeature, isLoading: planLoading } = usePlan();

  // Keys list
  const [keys, setKeys] = useState<ProviderKey[]>([]);
  const [keysLoading, setKeysLoading] = useState(false);

  // Add key dialog
  const [addOpen, setAddOpen] = useState(false);
  const [addProvider, setAddProvider] = useState<SupportedProvider>('anthropic');
  const [addName, setAddName] = useState('');
  const [addKey, setAddKey] = useState('');
  const [addSaving, setAddSaving] = useState(false);
  const [addValidationResult, setAddValidationResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  // Delete confirmation dialog
  const [deleteTarget, setDeleteTarget] = useState<ProviderKey | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Rotation history
  const [historyKeys, setHistoryKeys] = useState<ProviderKey[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Re-validate
  const [validatingId, setValidatingId] = useState<string | null>(null);

  // Rotate dialog
  const [rotateTarget, setRotateTarget] = useState<ProviderKey | null>(null);
  const [rotateKey, setRotateKey] = useState('');
  const [rotateSaving, setRotateSaving] = useState(false);
  const [rotateResult, setRotateResult] = useState<{ success: boolean; message: string } | null>(
    null,
  );

  // AI budget
  const [budget, setBudget] = useState<AiBudget | null>(null);
  const [budgetLoading, setBudgetLoading] = useState(true);
  const [budgetSaving, setBudgetSaving] = useState(false);
  const [tokenLimitInput, setTokenLimitInput] = useState('');
  const [rpmInput, setRpmInput] = useState('');

  // ---------------------------------------------------------------------------
  // Edition + AI budget
  // ---------------------------------------------------------------------------
  const fetchBudget = useCallback(async () => {
    if (!activeWorkspace?.id) {
      setBudget(null);
      setBudgetLoading(false);
      return;
    }
    setBudgetLoading(true);
    try {
      const data = await fetchJson<AiBudget>(
        apiUrl(`/api/provider-keys/budget?workspace_id=${activeWorkspace.id}`),
      );
      setBudget(data);
      setTokenLimitInput(data.token_limit_monthly === null ? '' : String(data.token_limit_monthly));
      setRpmInput(data.requests_per_minute === null ? '' : String(data.requests_per_minute));
    } catch {
      setBudget(null);
    } finally {
      setBudgetLoading(false);
    }
  }, [activeWorkspace?.id]);

  useEffect(() => {
    fetchBudget();
  }, [fetchBudget]);

  // BYOK is the only way to run AI on the community edition, so it is always on there.
  const gateLoading = planLoading || budgetLoading;
  const hasByok = (() => {
    if (gateLoading) return false;
    if (budget?.edition === 'community') return true;
    return hasFeature('byok');
  })();

  // ---------------------------------------------------------------------------
  // Fetch provider keys
  // ---------------------------------------------------------------------------
  const fetchKeys = useCallback(async () => {
    setKeysLoading(true);
    try {
      const params = activeWorkspace?.id ? `?workspace_id=${activeWorkspace.id}` : '';
      const data = await fetchJson<ProviderKey[]>(apiUrl(`/api/provider-keys${params}`));
      setKeys(data ?? []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load provider keys');
    } finally {
      setKeysLoading(false);
    }
  }, [activeWorkspace?.id]);

  useEffect(() => {
    if (hasByok) fetchKeys();
  }, [hasByok, fetchKeys]);

  // ---------------------------------------------------------------------------
  // Add key
  // ---------------------------------------------------------------------------
  function openAddDialog(provider?: SupportedProvider) {
    setAddProvider(provider ?? 'anthropic');
    setAddName('');
    setAddKey('');
    setAddValidationResult(null);
    setAddOpen(true);
  }

  async function handleAddKey() {
    if (!addProvider || !addName.trim() || !addKey.trim()) return;
    setAddSaving(true);
    setAddValidationResult(null);
    try {
      const params = activeWorkspace?.id ? `?workspace_id=${activeWorkspace.id}` : '';
      await fetchJson(apiUrl(`/api/provider-keys${params}`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: addProvider,
          name: addName.trim(),
          key: addKey.trim(),
        }),
      });
      setAddValidationResult({ success: true, message: 'Key validated and saved successfully.' });
      toast.success('Provider key added');
      await fetchKeys();
      setTimeout(() => setAddOpen(false), 1200);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save key';
      setAddValidationResult({ success: false, message });
    } finally {
      setAddSaving(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Delete key
  // ---------------------------------------------------------------------------
  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const params = activeWorkspace?.id ? `?workspace_id=${activeWorkspace.id}` : '';
      await fetchJson(apiUrl(`/api/provider-keys/${deleteTarget.id}${params}`), {
        method: 'DELETE',
      });
      toast.success(`${PROVIDER_META[deleteTarget.provider].label} key removed`);
      setDeleteTarget(null);
      await fetchKeys();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete key');
    } finally {
      setDeleting(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Rotation history
  // ---------------------------------------------------------------------------
  async function fetchHistory() {
    if (historyKeys.length > 0) {
      setHistoryOpen((v) => !v);
      return;
    }
    setHistoryLoading(true);
    setHistoryOpen(true);
    try {
      const params = activeWorkspace?.id
        ? `?workspace_id=${activeWorkspace.id}&include_inactive=true`
        : '?include_inactive=true';
      const data = await fetchJson<ProviderKey[]>(apiUrl(`/api/provider-keys${params}`));
      setHistoryKeys((data ?? []).filter((k) => !k.is_active));
    } catch {
      toast.error('Failed to load rotation history');
    } finally {
      setHistoryLoading(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Re-validate a stored key
  // ---------------------------------------------------------------------------
  async function handleRevalidate(key: ProviderKey) {
    setValidatingId(key.id);
    try {
      const params = activeWorkspace?.id ? `?workspace_id=${activeWorkspace.id}` : '';
      const result = await fetchJson<{ last_validation_status: string }>(
        apiUrl(`/api/provider-keys/${key.id}/validate${params}`),
        { method: 'PATCH' },
      );
      toast.success(`Key re-validated: ${result.last_validation_status}`);
      await fetchKeys();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Re-validation failed');
    } finally {
      setValidatingId(null);
    }
  }

  // ---------------------------------------------------------------------------
  // Rotate a stored key
  // ---------------------------------------------------------------------------
  function openRotateDialog(key: ProviderKey) {
    setRotateTarget(key);
    setRotateKey('');
    setRotateResult(null);
  }

  async function handleRotate() {
    if (!rotateTarget || !rotateKey.trim()) return;
    setRotateSaving(true);
    setRotateResult(null);
    try {
      const params = activeWorkspace?.id ? `?workspace_id=${activeWorkspace.id}` : '';
      await fetchJson(apiUrl(`/api/provider-keys/${rotateTarget.id}${params}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: rotateKey.trim() }),
      });
      setRotateResult({ success: true, message: 'New key validated and saved.' });
      toast.success(`${PROVIDER_META[rotateTarget.provider].label} key rotated`);
      setHistoryKeys([]);
      await fetchKeys();
      setTimeout(() => setRotateTarget(null), 1200);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to rotate key';
      setRotateResult({ success: false, message });
    } finally {
      setRotateSaving(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Save AI budget
  // ---------------------------------------------------------------------------
  const tokenLimitValue = parseCap(tokenLimitInput);
  const rpmValue = parseCap(rpmInput);
  const budgetInputsValid = tokenLimitValue !== undefined && rpmValue !== undefined;
  const budgetDirty =
    !!budget &&
    (tokenLimitValue !== budget.token_limit_monthly || rpmValue !== budget.requests_per_minute);

  async function handleSaveBudget() {
    if (!activeWorkspace?.id || !budgetInputsValid) return;
    setBudgetSaving(true);
    try {
      const data = await fetchJson<AiBudget>(
        apiUrl(`/api/provider-keys/budget?workspace_id=${activeWorkspace.id}`),
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token_limit_monthly: tokenLimitValue,
            requests_per_minute: rpmValue,
          }),
        },
      );
      setBudget(data);
      toast.success('AI budget saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save AI budget');
    } finally {
      setBudgetSaving(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Derived state
  // ---------------------------------------------------------------------------

  /** How many required AI model providers have a connected key */
  const connectedAiProviders = AI_MODEL_PROVIDERS.filter((p) =>
    keys.some((k) => k.provider === p && k.is_active),
  );
  const hasAnyAiKey = connectedAiProviders.length > 0;
  const missingAiProviders = AI_MODEL_PROVIDERS.filter(
    (p) => !keys.some((k) => k.provider === p && k.is_active),
  );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (gateLoading) {
    return (
      <div className="flex items-center gap-2 py-12">
        <Loader2 size={16} className="animate-spin" />
        <span className="text-foreground-light text-sm">Loading...</span>
      </div>
    );
  }

  if (!hasByok) {
    return <UpgradePrompt />;
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-foreground text-sm font-semibold">API Connections</h3>
          <p className="text-foreground-lighter mt-0.5 text-sm">
            Connect your AI provider keys to power agents, chat, and voice. Keys are AES-256
            encrypted at rest.
          </p>
        </div>
        <Button size="sm" onClick={() => openAddDialog()}>
          <Plus size={14} className="mr-1.5" />
          Add Key
        </Button>
      </div>

      {/* Warning banner if no AI model keys connected */}
      {!keysLoading && !hasAnyAiKey && (
        <div className="flex items-start gap-3 rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-4">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-yellow-500" aria-hidden="true" />
          <div>
            <p className="text-foreground text-sm font-medium">No AI model key connected</p>
            <p className="text-foreground-light mt-0.5 text-xs">
              {budget?.host_fallback_enabled
                ? 'Connect at least one AI provider key (Anthropic, OpenAI, or Groq) to enable AI agents, chat, and task generation.'
                : 'This edition has no shared keys. Connect at least one AI provider key (Anthropic, OpenAI, or Groq) before agents, chat, or task generation can run.'}
            </p>
          </div>
        </div>
      )}

      {/* Connection status — always visible */}
      {!keysLoading && (
        <div className="space-y-4">
          {/* AI Model Providers — required */}
          <div>
            <h4 className="text-foreground-lighter mb-2 text-xs font-medium tracking-wide uppercase">
              AI Model Providers
            </h4>
            <div className="space-y-2">
              {AI_MODEL_PROVIDERS.map((provider) => {
                const userKey = keys.find((k) => k.provider === provider && k.is_active);
                return (
                  <div
                    key={provider}
                    className="border-border flex items-center gap-3 rounded-lg border px-4 py-3"
                  >
                    <ProviderIcon provider={provider} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-foreground text-sm font-medium">
                          {PROVIDER_META[provider].label}
                        </span>
                        {userKey ? (
                          <Badge
                            variant="secondary"
                            className="text-success-foreground gap-1 text-xs"
                          >
                            <CheckCircle2 size={11} aria-hidden="true" />
                            Connected
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-foreground-muted gap-1 text-xs">
                            Not connected
                          </Badge>
                        )}
                      </div>
                      {userKey ? (
                        <span className="text-foreground-muted text-xs">
                          ••••••{userKey.key_suffix}
                          {userKey.last_validation_status === 'valid' && ' — verified'}
                          {userKey.last_used_at &&
                            ` — last used ${formatDate(userKey.last_used_at)}`}
                        </span>
                      ) : (
                        <span className="text-foreground-muted text-xs">
                          {PROVIDER_META[provider].description}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      {userKey ? (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0"
                            onClick={() => handleRevalidate(userKey)}
                            disabled={validatingId === userKey.id}
                            aria-label={`Re-validate ${userKey.name}`}
                            title="Re-validate key"
                          >
                            {validatingId === userKey.id ? (
                              <Loader2 size={14} className="animate-spin" />
                            ) : (
                              <RefreshCw size={14} />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0"
                            onClick={() => openRotateDialog(userKey)}
                            aria-label={`Rotate ${userKey.name}`}
                            title="Rotate key"
                          >
                            <RotateCw size={14} />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive h-7 w-7 p-0"
                            onClick={() => setDeleteTarget(userKey)}
                            aria-label={`Remove ${userKey.name}`}
                          >
                            <Trash2 size={14} />
                          </Button>
                        </>
                      ) : (
                        <Button size="sm" variant="outline" onClick={() => openAddDialog(provider)}>
                          Connect
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Voice & TTS — plan-managed, optional BYOK */}
          <div>
            <h4 className="text-foreground-lighter mb-2 text-xs font-medium tracking-wide uppercase">
              Voice & TTS
            </h4>
            <div className="space-y-2">
              {PLAN_MANAGED_PROVIDERS.map((provider) => {
                const userKey = keys.find((k) => k.provider === provider && k.is_active);
                return (
                  <div
                    key={provider}
                    className="border-border flex items-center gap-3 rounded-lg border px-4 py-3"
                  >
                    <ProviderIcon provider={provider} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-foreground text-sm font-medium">
                          {PROVIDER_META[provider].label}
                        </span>
                        {userKey ? (
                          <Badge
                            variant="secondary"
                            className="text-success-foreground gap-1 text-xs"
                          >
                            <CheckCircle2 size={11} aria-hidden="true" />
                            Connected
                          </Badge>
                        ) : (
                          <Badge
                            variant="secondary"
                            className="text-foreground-light gap-1 text-xs"
                          >
                            <Zap size={11} aria-hidden="true" />
                            Included in plan
                          </Badge>
                        )}
                      </div>
                      {userKey ? (
                        <span className="text-foreground-muted text-xs">
                          ••••••{userKey.key_suffix} — using your own key
                          {userKey.last_used_at &&
                            ` — last used ${formatDate(userKey.last_used_at)}`}
                        </span>
                      ) : (
                        <span className="text-foreground-muted text-xs">
                          {PROVIDER_META[provider].description}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      {userKey ? (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0"
                            onClick={() => handleRevalidate(userKey)}
                            disabled={validatingId === userKey.id}
                            aria-label={`Re-validate ${userKey.name}`}
                            title="Re-validate key"
                          >
                            {validatingId === userKey.id ? (
                              <Loader2 size={14} className="animate-spin" />
                            ) : (
                              <RefreshCw size={14} />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0"
                            onClick={() => openRotateDialog(userKey)}
                            aria-label={`Rotate ${userKey.name}`}
                            title="Rotate key"
                          >
                            <RotateCw size={14} />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive h-7 w-7 p-0"
                            onClick={() => setDeleteTarget(userKey)}
                            aria-label={`Remove ${userKey.name}`}
                          >
                            <Trash2 size={14} />
                          </Button>
                        </>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-foreground-light"
                          onClick={() => openAddDialog(provider)}
                        >
                          Override
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Loading state */}
      {keysLoading && (
        <div className="flex items-center gap-2 py-8">
          <Loader2 size={16} className="animate-spin" />
          <span className="text-foreground-light text-sm">Loading connections...</span>
        </div>
      )}

      {/* AI budget */}
      {budget && activeWorkspace?.id && (
        <div className="border-border rounded-lg border p-4">
          <div className="flex items-start gap-3">
            <div className="bg-surface-200 flex h-8 w-8 shrink-0 items-center justify-center rounded-md">
              <Gauge size={14} className="text-foreground-light" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <h4 className="text-foreground text-sm font-medium">AI budget</h4>
              <p className="text-foreground-lighter mt-0.5 text-xs">
                Caps apply to every key this workspace uses. Leave a field empty for no cap.
              </p>

              <div className="mt-3">
                <div className="text-foreground-light flex items-center justify-between text-xs">
                  <span>Tokens this month</span>
                  <span>
                    {formatTokens(budget.tokens_used_month)}
                    {budget.token_limit_monthly !== null &&
                      ` / ${formatTokens(budget.token_limit_monthly)}`}
                  </span>
                </div>
                {budget.token_limit_monthly !== null && budget.token_limit_monthly > 0 && (
                  <div
                    className="bg-surface-200 mt-1.5 h-1.5 w-full overflow-hidden rounded-full"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={budget.token_limit_monthly}
                    aria-valuenow={Math.min(budget.tokens_used_month, budget.token_limit_monthly)}
                    aria-label="Monthly token usage"
                  >
                    <div
                      className={`h-full rounded-full ${
                        budget.tokens_used_month >= budget.token_limit_monthly
                          ? 'bg-destructive'
                          : 'bg-brand'
                      }`}
                      style={{
                        width: `${Math.min(
                          100,
                          (budget.tokens_used_month / budget.token_limit_monthly) * 100,
                        )}%`,
                      }}
                    />
                  </div>
                )}
                {budget.trial && (
                  <p className="text-foreground-muted mt-1.5 text-xs">
                    Shared trial keys: {formatTokens(budget.trial.used)} of{' '}
                    {formatTokens(budget.trial.budget)} tokens used.
                  </p>
                )}
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="ai-token-limit">Monthly token cap</Label>
                  <Input
                    id="ai-token-limit"
                    inputMode="numeric"
                    placeholder="No cap"
                    value={tokenLimitInput}
                    onChange={(e) => setTokenLimitInput(e.target.value)}
                    aria-invalid={tokenLimitValue === undefined}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ai-rpm-limit">Requests per minute</Label>
                  <Input
                    id="ai-rpm-limit"
                    inputMode="numeric"
                    placeholder="No cap"
                    value={rpmInput}
                    onChange={(e) => setRpmInput(e.target.value)}
                    aria-invalid={rpmValue === undefined}
                  />
                </div>
              </div>
              {!budgetInputsValid && (
                <p className="text-destructive mt-1.5 text-xs">Caps must be whole numbers.</p>
              )}

              <div className="mt-3 flex justify-end">
                <Button
                  size="sm"
                  onClick={handleSaveBudget}
                  disabled={budgetSaving || !budgetDirty || !budgetInputsValid}
                >
                  {budgetSaving ? (
                    <>
                      <Loader2 size={14} className="mr-1.5 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    'Save budget'
                  )}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Rotation history (collapsible) */}
      {keys.length > 0 && (
        <div>
          <button
            type="button"
            onClick={fetchHistory}
            className="text-foreground-lighter hover:text-foreground-light flex items-center gap-1.5 text-xs font-medium"
          >
            {historyOpen ? (
              <ChevronDown size={12} aria-hidden="true" />
            ) : (
              <ChevronRight size={12} aria-hidden="true" />
            )}
            <History size={12} aria-hidden="true" />
            Key history
            {historyLoading && <Loader2 size={10} className="animate-spin" />}
          </button>
          {historyOpen && historyKeys.length > 0 && (
            <div className="border-border mt-2 divide-y rounded-lg border">
              {historyKeys.map((k) => (
                <div key={k.id} className="flex items-center gap-3 px-4 py-2 opacity-60">
                  <ProviderIcon provider={k.provider} />
                  <span className="text-foreground-light text-sm">
                    {PROVIDER_META[k.provider].label}
                  </span>
                  <code className="text-foreground-muted bg-surface-200 rounded px-1.5 py-0.5 font-mono text-xs">
                    ••••••{k.key_suffix}
                  </code>
                  <span className="text-foreground-muted ml-auto text-xs">
                    Removed {formatDate(k.updated_at ?? k.created_at)}
                  </span>
                </div>
              ))}
            </div>
          )}
          {historyOpen && !historyLoading && historyKeys.length === 0 && (
            <p className="text-foreground-muted mt-2 text-xs">No previous keys found.</p>
          )}
        </div>
      )}

      {/* Add key dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Connect Provider Key</DialogTitle>
            <DialogDescription>
              Your key will be validated against the provider and encrypted with AES-256 before
              storage. The full key is never stored in plaintext.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="provider-select">Provider</Label>
              <Select
                value={addProvider}
                onValueChange={(v) => setAddProvider(v as SupportedProvider)}
              >
                <SelectTrigger id="provider-select">
                  <SelectValue placeholder="Select provider" />
                </SelectTrigger>
                <SelectContent>
                  {ALL_BYOK_PROVIDERS.map((p) => (
                    <SelectItem key={p} value={p}>
                      {PROVIDER_META[p].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="key-name">Key Name</Label>
              <Input
                id="key-name"
                placeholder="e.g. Production Anthropic Key"
                value={addName}
                onChange={(e) => setAddName(e.target.value)}
                maxLength={255}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="key-value">API Key</Label>
              <Input
                id="key-value"
                type="password"
                placeholder={PROVIDER_META[addProvider]?.placeholder ?? 'Paste your key here'}
                value={addKey}
                onChange={(e) => setAddKey(e.target.value)}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
              />
              <p className="text-foreground-muted text-xs">
                Your key will be validated, then encrypted and stored. It cannot be retrieved after
                saving.
              </p>
            </div>

            {/* Validation feedback */}
            <div aria-live="polite">
              {addValidationResult && (
                <div
                  className={`flex items-start gap-2 rounded-md p-3 text-sm ${
                    addValidationResult.success
                      ? 'bg-success/10 text-success-foreground'
                      : 'bg-destructive/10 text-destructive'
                  }`}
                >
                  {addValidationResult.success ? (
                    <CheckCircle2 size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
                  ) : (
                    <XCircle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
                  )}
                  <span>{addValidationResult.message}</span>
                </div>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)} disabled={addSaving}>
              Cancel
            </Button>
            <Button
              onClick={handleAddKey}
              disabled={addSaving || !addName.trim() || !addKey.trim()}
            >
              {addSaving ? (
                <>
                  <Loader2 size={14} className="mr-1.5 animate-spin" />
                  Validating...
                </>
              ) : (
                'Connect'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rotate key dialog */}
      <Dialog open={!!rotateTarget} onOpenChange={(open) => !open && setRotateTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Rotate Provider Key</DialogTitle>
            <DialogDescription>
              {rotateTarget && (
                <>
                  Replace <strong>{rotateTarget.name}</strong> (
                  {PROVIDER_META[rotateTarget.provider]?.label}). The new key is validated, then
                  encrypted. The current key moves to key history.
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="rotate-key-value">New API Key</Label>
              <Input
                id="rotate-key-value"
                type="password"
                placeholder={
                  rotateTarget ? PROVIDER_META[rotateTarget.provider]?.placeholder : undefined
                }
                value={rotateKey}
                onChange={(e) => setRotateKey(e.target.value)}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
              />
            </div>

            <div aria-live="polite">
              {rotateResult && (
                <div
                  className={`flex items-start gap-2 rounded-md p-3 text-sm ${
                    rotateResult.success
                      ? 'bg-success/10 text-success-foreground'
                      : 'bg-destructive/10 text-destructive'
                  }`}
                >
                  {rotateResult.success ? (
                    <CheckCircle2 size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
                  ) : (
                    <XCircle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
                  )}
                  <span>{rotateResult.message}</span>
                </div>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setRotateTarget(null)} disabled={rotateSaving}>
              Cancel
            </Button>
            <Button onClick={handleRotate} disabled={rotateSaving || !rotateKey.trim()}>
              {rotateSaving ? (
                <>
                  <Loader2 size={14} className="mr-1.5 animate-spin" />
                  Validating...
                </>
              ) : (
                'Rotate'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Disconnect Provider Key</DialogTitle>
            <DialogDescription>
              {deleteTarget && (
                <>
                  Remove <strong>{deleteTarget.name}</strong> (
                  {PROVIDER_META[deleteTarget.provider]?.label})?
                  {PLAN_MANAGED_PROVIDERS.includes(deleteTarget.provider)
                    ? ' Plan-included access will be restored.'
                    : ' This provider will no longer be available until a new key is connected.'}
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? (
                <>
                  <Loader2 size={14} className="mr-1.5 animate-spin" />
                  Removing...
                </>
              ) : (
                'Disconnect'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
