'use client';

import { useCallback, useEffect, useState } from 'react';
import Image from 'next/image';
import {
  Github,
  Terminal,
  Check,
  CheckCircle2,
  ArrowRight,
  ChevronDown,
  Copy,
  Download,
  Eye,
  EyeOff,
  Loader2,
  Key,
} from 'lucide-react';
import { Button } from '@repo/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@repo/ui/components/dropdown-menu';
import { apiUrl } from '@repo/db/api';
import { fetchJson } from '@/lib/fetch-json';
import { toast } from 'sonner';
import type { OrgGitHubInstallation, ApiKey, ApiKeyCreated } from '@repo/types';
import { URL_APP } from '@/lib/branding';
import { detectProvider, isKnownProvider } from '@/lib/provider-detection';

interface ConnectionsStepProps {
  workspaceId: string;
  onContinue: () => void;
}

/* ── IDE setup tab types ── */

type IdeTab = 'claude-code' | 'cursor' | 'windsurf' | 'vscode';

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

function IdePickerGrid({
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

function OnboardingCodeBlock({
  children,
  onCopy,
  multiline = false,
}: {
  children: string;
  onCopy: (text: string) => void;
  hint?: string;
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
        {/* Gradient fade + copy button */}
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

function ProviderLogo({ provider }: { provider: string }) {
  const size = 'h-5 w-5';
  switch (provider) {
    case 'Anthropic':
      return (
        <svg className={size} viewBox="0 0 24 24" fill="none">
          <path
            d="M17.304 3.541h-3.48l6.15 16.918h3.48L17.303 3.541zM6.696 3.541.546 20.459h3.48l1.25-3.471h6.448l1.25 3.471h3.48L10.304 3.541H6.696zm.928 10.49 2.376-6.6 2.376 6.6H7.624z"
            fill="currentColor"
          />
        </svg>
      );
    case 'OpenAI':
      return (
        <svg className={size} viewBox="0 0 24 24" fill="none">
          <path
            d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.998 5.998 0 0 0-3.998 2.9 6.042 6.042 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z"
            fill="currentColor"
          />
        </svg>
      );
    case 'Google Gemini':
      return (
        <svg className={size} viewBox="0 0 24 24" fill="none">
          <path
            d="M12 24A14.304 14.304 0 0 0 0 12 14.304 14.304 0 0 0 12 0a14.305 14.305 0 0 0 12 12 14.305 14.305 0 0 0-12 12z"
            fill="currentColor"
          />
        </svg>
      );
    default:
      return (
        <div className="flex h-5 w-5 items-center justify-center rounded bg-white/10 text-[10px] font-bold text-white/60">
          {provider.charAt(0)}
        </div>
      );
  }
}

/**
 * Unified connections step for onboarding.
 * Shows IDE Connection + GitHub cards side by side.
 * Users can complete either or both, then continue.
 */
export function ConnectionsStep({ workspaceId, onContinue }: ConnectionsStepProps) {
  // GitHub state
  const [gitHubInstallations, setGitHubInstallations] = useState<OrgGitHubInstallation[]>([]);
  const [gitHubLoading, setGitHubLoading] = useState(true);

  // IDE Connection state
  const [ideConnected, setIdeConnected] = useState(false);
  const [ideHasKey, setIdeHasKey] = useState(false); // active key exists (may not be used yet)
  const [ideExpanded, setIdeExpanded] = useState(false);
  const [ideLoading, setIdeLoading] = useState(true);
  const [ideMode, setIdeMode] = useState<'cli' | 'mcp'>('cli');
  const [ideTab, setIdeTab] = useState<IdeTab>('claude-code');
  const [generatingKey, setGeneratingKey] = useState(false);
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [ideChecking, setIdeChecking] = useState(false);

  // Provider key (BYOK) state
  const [providerKeyExpanded, setProviderKeyExpanded] = useState(false);
  const [providerKeyConnected, setProviderKeyConnected] = useState(false);
  const [providerKeySaving, setProviderKeySaving] = useState(false);
  const [providerKeyInput, setProviderKeyInput] = useState('');
  const [providerKeyError, setProviderKeyError] = useState<string | null>(null);
  const [detectedProviderName, setDetectedProviderName] = useState<string | null>(null);

  const [showApiKey, setShowApiKey] = useState(false);
  const [showProviderKey, setShowProviderKey] = useState(false);
  const [savedProviderKey, setSavedProviderKey] = useState<string | null>(null);

  // Error states
  const [gitHubFetchError, setGitHubFetchError] = useState(false);
  const [gitHubDisconnectError, setGitHubDisconnectError] = useState(false);
  const [ideCheckError, setIdeCheckError] = useState(false);

  // Device authorization flow — user enters the code shown in their terminal
  const [deviceCode, setDeviceCode] = useState('');
  const [deviceCodeVerifying, setDeviceCodeVerifying] = useState(false);
  const [deviceCodeError, setDeviceCodeError] = useState<string | null>(null);

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
      // Trigger re-checks — the CLI polls and creates the API key within ~5s
      setTimeout(() => void fetchIdeStatus(), 3_000);
      setTimeout(() => void fetchIdeStatus(), 8_000);
    } catch {
      setDeviceCodeError('Could not reach server. Try again.');
    } finally {
      setDeviceCodeVerifying(false);
    }
  }

  const fetchGitHub = useCallback(async () => {
    let found = false;
    let hadError = false;

    // Try org-level installations first
    try {
      const resp = await fetchJson<{ installations: OrgGitHubInstallation[] }>(
        apiUrl('/api/github/installations'),
      );
      if (resp.installations.length > 0) {
        setGitHubInstallations(resp.installations);
        found = true;
      }
    } catch {
      hadError = true;
    }

    // If no installations found, detect via GitHub App API or DB lookup
    if (!found) {
      try {
        const detectResp = await fetchJson<{
          found: boolean;
          installation_id?: number;
          account_login?: string;
          account_avatar_url?: string | null;
          reason?: string;
        }>(apiUrl(`/api/github/detect-installation?workspace_id=${workspaceId}`));
        if (detectResp.found && detectResp.installation_id) {
          setGitHubInstallations([
            {
              id: detectResp.installation_id,
              installation_id: detectResp.installation_id,
              github_account_login: detectResp.account_login ?? 'Connected',
              github_account_avatar_url: detectResp.account_avatar_url ?? null,
            } as unknown as OrgGitHubInstallation,
          ]);
          found = true;
          hadError = false;
        }
      } catch {
        hadError = true;
      }
    }

    if (!found) {
      setGitHubInstallations([]);
    }

    setGitHubFetchError(hadError && !found);
    setGitHubLoading(false);
  }, [workspaceId]);

  // Check for existing provider keys
  const fetchProviderKeyStatus = useCallback(async () => {
    try {
      const keys = await fetchJson<{ id: string; provider: string }[]>(
        apiUrl(`/api/provider-keys?workspace_id=${workspaceId}`),
      );
      if (keys.length > 0) {
        setProviderKeyConnected(true);
        setProviderKeyExpanded(false);
      }
    } catch {
      // Non-fatal
    }
  }, [workspaceId]);

  useEffect(() => {
    fetchGitHub();
    fetchProviderKeyStatus();
  }, [fetchGitHub, fetchProviderKeyStatus]);

  // Check for existing API keys (IDE connection detection) + poll every 5s
  // Connected = active key that has been used at least once (not just generated)
  const fetchIdeStatus = useCallback(async () => {
    try {
      const keys = await fetchJson<ApiKey[]>(apiUrl(`/api/api-keys?workspace_id=${workspaceId}`));
      const activeKeys = keys.filter((k) => !k.revoked_at);
      const hasKey = activeKeys.length > 0;
      // Connected = has an active API key that has actually been used by an IDE.
      // Intentional: a generated-but-unused key means the IDE hasn't connected yet.
      // We show "key created" state (ideHasKey) but not "connected" (ideConnected)
      // until the IDE makes its first request.
      const connected = activeKeys.some((k) => k.last_used_at != null);
      setIdeHasKey(hasKey);
      setIdeConnected(connected);
      if (connected) setIdeExpanded(false);
      setIdeCheckError(false);
    } catch {
      setIdeCheckError(true);
    } finally {
      setIdeLoading(false);
      setIdeChecking(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    setIdeLoading(true);
    fetchIdeStatus();
  }, [fetchIdeStatus]);

  // Re-fetch on visibility change AND poll every 10s while mounted.
  // Also listen for postMessage from the GitHub callback tab.
  useEffect(() => {
    function handleVisibility() {
      if (document.visibilityState === 'visible') {
        fetchGitHub();
        fetchIdeStatus();
      }
    }
    function handleMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === 'github-connected') {
        const login = event.data.accountLogin;

        fetchGitHub();
      } else if (event.data?.type === 'github-recheck') {
        fetchGitHub();
      }
    }
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('message', handleMessage);
    const ghInterval = setInterval(fetchGitHub, 10_000);
    const ideInterval = setInterval(fetchIdeStatus, 5_000);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('message', handleMessage);
      clearInterval(ghInterval);
      clearInterval(ideInterval);
    };
  }, [fetchGitHub, fetchIdeStatus]);

  async function handleSaveProviderKey() {
    if (!providerKeyInput.trim()) return;
    setProviderKeySaving(true);
    setProviderKeyError(null);
    try {
      const detected = detectProvider(providerKeyInput.trim());
      await fetchJson(apiUrl(`/api/provider-keys?workspace_id=${workspaceId}`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: detected.provider,
          name: `${detected.displayName} (onboarding)`,
          key: providerKeyInput.trim(),
        }),
      });
      setSavedProviderKey(providerKeyInput.trim());
      setProviderKeyConnected(true);
      setProviderKeyExpanded(false);
      setProviderKeyInput('');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save key';
      setProviderKeyError(
        msg.includes('validation failed')
          ? msg
          : 'Failed to save key. Check that the key is valid.',
      );
    } finally {
      setProviderKeySaving(false);
    }
  }

  const gitHubConnected = gitHubInstallations.length > 0;

  function handleGitHubConnect() {
    window.open(apiUrl(`/api/github/install?workspace_id=${workspaceId}`), '_blank');
  }

  async function handleGitHubDisconnect() {
    setGitHubDisconnectError(false);
    try {
      await fetchJson(apiUrl('/api/github/installations'), {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace_id: workspaceId }),
      });
      setGitHubInstallations([]);
    } catch {
      setGitHubDisconnectError(true);
      toast.error('Failed to disconnect GitHub');
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

  async function handleIdeDisconnect() {
    try {
      const keys = await fetchJson<ApiKey[]>(apiUrl(`/api/api-keys?workspace_id=${workspaceId}`));
      const activeKeys = keys.filter((k) => !k.revoked_at);
      for (const key of activeKeys) {
        await fetchJson(apiUrl(`/api/api-keys/${key.id}?workspace_id=${workspaceId}`), {
          method: 'DELETE',
        });
      }
      setIdeConnected(false);
      setGeneratedKey(null);
    } catch {
      toast.error('Failed to disconnect IDE');
    }
  }

  const [keyCopied, setKeyCopied] = useState(false);

  function copyToClipboard(text: string, showToast = true) {
    navigator.clipboard.writeText(text);
    setKeyCopied(true);
    if (showToast) toast.success('Copied to clipboard');
    setTimeout(() => setKeyCopied(false), 2000);
  }

  const origin = typeof window !== 'undefined' ? window.location.origin : URL_APP;
  const mcpUrl = `${origin}/api/mcp`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-4xl font-light tracking-tight text-white lg:text-5xl">
          Connect your tools
        </h1>
        <p className="mt-6 text-base leading-relaxed font-light text-white/90">
          The basic required tools for successful agent collaboration. About 4-5 minutes of setup.
        </p>
      </div>

      <div className="space-y-3">
        {/* IDE Connection Card */}
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/[0.06]">
              <Terminal className="h-5 w-5 text-white/[0.66]" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-semibold text-white">IDE Connection</h3>
              <p className="text-xs text-white/[0.66]">
                {ideConnected ? 'Use your preferred IDE' : 'Collaborate with your agents'}
              </p>
              {ideCheckError && <p className="text-xs text-red-400">Could not check connection</p>}
            </div>
            {ideLoading ? (
              <div className="h-4 w-20 animate-pulse rounded bg-white/[0.06]" />
            ) : ideConnected && !ideExpanded ? (
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
                    onClick={() => setIdeExpanded(true)}
                    className="cursor-pointer text-sm text-white/70 focus:bg-black/30 focus:text-white/70"
                  >
                    Manage
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={handleIdeDisconnect}
                    className="cursor-pointer text-sm text-red-400 focus:bg-black/30 focus:text-red-400"
                  >
                    Disconnect
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="border-white/10 text-white/70 hover:bg-white/5 hover:text-white"
                onClick={() => setIdeExpanded(!ideExpanded)}
              >
                {ideExpanded ? 'Cancel' : 'Connect'}
              </Button>
            )}
          </div>

          {/* Expandable IDE setup */}
          <div
            className="grid transition-[grid-template-rows] duration-300 ease-in-out"
            style={{ gridTemplateRows: ideExpanded ? '1fr' : '0fr' }}
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

                    {/* Step 1: Run the CLI with --tool flag for selected IDE */}
                    <div>
                      <p className="mb-3 text-xs text-white/[0.66]">
                        Run this command in your terminal:
                      </p>
                      <OnboardingCodeBlock onCopy={(text) => copyToClipboard(text, false)}>
                        {`npx @celuneai/cli setup --tool ${ideTab === 'vscode' ? 'cline' : ideTab}`}
                      </OnboardingCodeBlock>
                    </div>

                    {/* Step 2: Enter the device code */}
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
                            <OnboardingCodeBlock
                              onCopy={(text) => copyToClipboard(text, false)}
                              multiline
                            >
                              {`claude mcp add celune --transport http ${mcpUrl} --header "Authorization: Bearer ${generatedKey}" --scope user`}
                            </OnboardingCodeBlock>
                          </>
                        )}

                        {ideTab === 'cursor' && (
                          <>
                            <p className="mb-2 text-xs text-white/[0.66]">
                              Add to ~/.cursor/mcp.json
                            </p>
                            <OnboardingCodeBlock
                              onCopy={(text) => copyToClipboard(text, false)}
                              multiline
                            >
                              {mcpJsonConfig(mcpUrl, generatedKey)}
                            </OnboardingCodeBlock>
                          </>
                        )}

                        {ideTab === 'windsurf' && (
                          <>
                            <p className="mb-2 text-xs text-white/[0.66]">
                              Add to ~/.codeium/windsurf/mcp_config.json
                            </p>
                            <OnboardingCodeBlock
                              onCopy={(text) => copyToClipboard(text, false)}
                              multiline
                            >
                              {mcpJsonConfig(mcpUrl, generatedKey)}
                            </OnboardingCodeBlock>
                          </>
                        )}

                        {ideTab === 'vscode' && (
                          <>
                            <p className="mb-2 text-xs text-white/[0.66]">
                              Add to .vscode/mcp.json in your project
                            </p>
                            <OnboardingCodeBlock
                              onCopy={(text) => copyToClipboard(text, false)}
                              multiline
                            >
                              {mcpJsonConfig(mcpUrl, generatedKey)}
                            </OnboardingCodeBlock>
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

        {/* AI Provider Key (BYOK) Card */}
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/[0.06]">
              <Key className="h-5 w-5 text-white/[0.66]" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-semibold text-white">AI Provider Key</h3>
              <p className="text-xs text-white/[0.66]">
                {providerKeyConnected
                  ? 'Your own API key is active'
                  : 'Give your agents unlimited access'}
              </p>
            </div>
            {providerKeyConnected ? (
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
                    onClick={() => {
                      setProviderKeyInput(savedProviderKey ?? '');
                      setShowProviderKey(false);
                      setProviderKeyConnected(false);
                      setProviderKeyExpanded(true);
                    }}
                    className="cursor-pointer text-sm text-white/70 focus:bg-black/30 focus:text-white/70"
                  >
                    Edit
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={async () => {
                      try {
                        const keys = await fetchJson<{ id: string }[]>(
                          apiUrl(`/api/provider-keys?workspace_id=${workspaceId}`),
                        );
                        for (const key of keys) {
                          const res = await fetch(
                            apiUrl(`/api/provider-keys/${key.id}?workspace_id=${workspaceId}`),
                            { method: 'DELETE' },
                          );
                          if (!res.ok) throw new Error('Delete failed');
                        }
                        setProviderKeyConnected(false);
                        setSavedProviderKey(null);
                      } catch {
                        toast.error('Failed to remove API key');
                      }
                    }}
                    className="cursor-pointer text-sm text-red-400 focus:bg-black/30 focus:text-red-400"
                  >
                    Disconnect
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="border-white/10 text-white/70 hover:bg-white/5 hover:text-white"
                onClick={() => setProviderKeyExpanded(!providerKeyExpanded)}
              >
                {providerKeyExpanded ? 'Cancel' : 'Connect'}
              </Button>
            )}
          </div>

          <div
            className="grid transition-[grid-template-rows] duration-300 ease-in-out"
            style={{ gridTemplateRows: providerKeyExpanded ? '1fr' : '0fr' }}
          >
            <div className="overflow-hidden">
              <div className="mt-5 space-y-4 border-t border-white/[0.06] pt-5">
                <p className="text-xs leading-relaxed text-white/50">
                  This requires an API key, not a Claude Pro/Max subscription.{' '}
                  <a
                    href="https://console.anthropic.com/settings/keys"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-white/70 underline underline-offset-2 hover:text-white"
                  >
                    Get your key from console.anthropic.com
                  </a>
                </p>
                {/* Auto-detect provider indicator */}
                {detectedProviderName && detectedProviderName !== 'Unknown Provider' && (
                  <div className="flex items-center gap-2.5 px-1 py-1">
                    <ProviderLogo provider={detectedProviderName} />
                    <span className="text-sm font-medium text-white/70">
                      {detectedProviderName}
                    </span>
                  </div>
                )}
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5">
                    <input
                      type={showProviderKey ? 'text' : 'password'}
                      autoComplete="new-password"
                      placeholder="Paste any AI provider API key..."
                      value={providerKeyInput}
                      onChange={(e) => {
                        const val = e.target.value;
                        setProviderKeyInput(val);
                        setProviderKeyError(null);
                        if (val.trim().length >= 3) {
                          const detected = detectProvider(val.trim());
                          setDetectedProviderName(detected.displayName);
                        } else {
                          setDetectedProviderName(null);
                        }
                      }}
                      className="min-w-0 flex-1 rounded-lg border border-white/[0.08] bg-[#171717] px-4 py-2.5 font-mono text-sm text-white/90 placeholder:text-white/30 focus:border-white/20 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setShowProviderKey(!showProviderKey)}
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-white/[0.08] text-white/30 transition-colors hover:bg-white/10 hover:text-white/70"
                    >
                      {showProviderKey ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                  {providerKeyError && <p className="text-xs text-red-400">{providerKeyError}</p>}
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  className="w-full border-white/10 text-white/70 hover:bg-white/5 hover:text-white"
                  disabled={providerKeySaving || !providerKeyInput.trim()}
                  onClick={handleSaveProviderKey}
                >
                  {providerKeySaving ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : null}
                  {providerKeySaving ? 'Validating...' : 'Save & verify key'}
                </Button>
              </div>
            </div>
          </div>
        </div>

        {/* GitHub Connection Card */}
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/[0.06]">
              <Github className="h-5 w-5 text-white/[0.66]" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
                GitHub
                <span className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[10px] font-medium text-white/[0.66]">
                  Recommended
                </span>
              </h3>
              <p className="text-xs text-white/[0.66]">Automated git processes</p>
              {gitHubFetchError && (
                <p className="text-xs text-red-400">Could not check connection</p>
              )}
              {gitHubDisconnectError && (
                <p className="text-xs text-red-400">Failed to disconnect</p>
              )}
            </div>
            {gitHubLoading ? (
              <div className="h-4 w-20 animate-pulse rounded bg-white/[0.06]" />
            ) : gitHubConnected ? (
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
                    onClick={handleGitHubConnect}
                    className="cursor-pointer text-sm text-white/70 focus:bg-black/30 focus:text-white/70"
                  >
                    Manage
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={handleGitHubDisconnect}
                    className="cursor-pointer text-sm text-red-400 focus:bg-black/30 focus:text-red-400"
                  >
                    Disconnect
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="border-white/10 text-white/70 hover:bg-white/5 hover:text-white"
                onClick={handleGitHubConnect}
              >
                Connect
              </Button>
            )}
          </div>
        </div>
      </div>

      <Button
        onClick={onContinue}
        disabled={!ideConnected && !ideHasKey && !providerKeyConnected}
        className="mt-4 w-full gap-2 text-black"
      >
        Continue
        <ArrowRight className="ml-2 h-4 w-4" />
      </Button>
    </div>
  );
}
