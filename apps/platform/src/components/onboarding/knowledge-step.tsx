'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import Nango from '@nangohq/frontend';
import { Upload, Globe, Link2, ChevronDown, ChevronUp, Check } from 'lucide-react';
import { cn } from '@repo/ui/utils';
import { Button } from '@repo/ui/components/button';
import { Input } from '@repo/ui/components/input';
import { GitHubLogo } from '@/components/icons/integration-logos';
import {
  NotionLogo,
  GoogleDriveLogo,
  LinearLogo,
  GmailLogo,
  AsanaLogo,
  ConfluenceLogo,
  FigmaLogo,
  JiraLogo,
  FileUploadLogo,
  UrlCrawlLogo,
} from '@/components/knowledge/knowledge-source-logos';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ConnectorInfo {
  id: string;
  name: string;
  icon: React.FC<{ className?: string }>;
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

const ALL_CONNECTORS: (ConnectorInfo & { comingSoon?: boolean })[] = [
  { id: 'notion', name: 'Notion', icon: NotionLogo },
  { id: 'linear', name: 'Linear', icon: LinearLogo },
  { id: 'confluence', name: 'Confluence', icon: ConfluenceLogo },
  { id: 'figma', name: 'Figma', icon: FigmaLogo },
  { id: 'jira', name: 'Jira', icon: JiraLogo },
  { id: 'asana', name: 'Asana', icon: AsanaLogo, comingSoon: true },
  { id: 'google-drive', name: 'Google Drive', icon: GoogleDriveLogo, comingSoon: true },
  { id: 'gmail', name: 'Gmail', icon: GmailLogo, comingSoon: true },
];

// ---------------------------------------------------------------------------
// Step indicator
// ---------------------------------------------------------------------------

function StepIndicator() {
  const steps = [
    { label: 'Tools', done: true },
    { label: 'Knowledge', active: true },
    { label: 'Agent', done: false },
    { label: 'Go', done: false },
  ];

  return (
    <div className="mb-8 flex items-center justify-center gap-2">
      {steps.map((step, i) => (
        <div key={step.label} className="flex items-center gap-2">
          {i > 0 && <div className="h-px w-6 bg-white/[0.06]" />}
          <div className="flex items-center gap-1.5">
            <div
              className={cn(
                'flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-medium',
                step.done
                  ? 'bg-brand text-white'
                  : step.active
                    ? 'border-brand text-brand border'
                    : 'border border-white/[0.12] text-white/[0.33]',
              )}
            >
              {step.done ? <Check className="h-3 w-3" /> : null}
              {step.active ? <span className="bg-brand h-2 w-2 rounded-full" /> : null}
              {!step.done && !step.active ? null : null}
            </div>
            <span
              className={cn(
                'text-xs',
                step.done
                  ? 'text-white/[0.66]'
                  : step.active
                    ? 'text-white/[0.87]'
                    : 'text-white/[0.33]',
              )}
            >
              {step.label}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface KnowledgeStepProps {
  onComplete: () => void;
  onSkip: () => void;
  workspaceId?: string;
}

export function KnowledgeStep({ onComplete, onSkip, workspaceId }: KnowledgeStepProps) {
  const [expanded, setExpanded] = useState(false);
  const [connected, setConnected] = useState<Set<string>>(new Set());
  const [urlValue, setUrlValue] = useState('');
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [connecting, setConnecting] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<Record<string, { status: string; items: number }>>(
    {},
  );

  // Poll sync status for connected sources
  useEffect(() => {
    if (connected.size === 0 || !workspaceId) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/knowledge/sources?workspace_id=${workspaceId}`);
        if (!res.ok) return;
        const sources = await res.json();
        const statusMap: Record<string, { status: string; items: number }> = {};
        for (const s of sources) {
          statusMap[s.provider] = { status: s.status, items: s.items_count ?? 0 };
        }
        setSyncStatus(statusMap);
      } catch {
        /* ignore */
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [connected.size, workspaceId]);

  const handleConnect = useCallback(
    async (id: string) => {
      if (id === 'file-upload' || id === 'url-crawl') {
        setConnected((prev) => new Set(prev).add(id));
        return;
      }

      // OAuth flow via Nango
      if (!workspaceId) return;
      setConnecting(id);

      try {
        // Get session token from our backend
        const res = await fetch(`/api/knowledge/oauth/connect/${id}?workspace_id=${workspaceId}`);
        if (!res.ok) {
          const err = await res.json();
          console.error('OAuth session error:', err);
          setConnecting(null);
          return;
        }
        const { token } = await res.json();

        // Open Nango Connect UI — scoped to one integration, skips picker
        const nango = new Nango();
        await nango.openConnectUI({
          sessionToken: token,
          onEvent: async (event) => {
            if (event.type === 'connect') {
              // Create knowledge_source record and trigger initial crawl
              try {
                await fetch(`/api/knowledge/sources?workspace_id=${workspaceId}`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    provider: id,
                    display_name: ALL_CONNECTORS.find((c) => c.id === id)?.name ?? id,
                    nango_connection_id:
                      (event as { payload?: { connectionId?: string } }).payload?.connectionId ??
                      `${workspaceId}_${id}`,
                  }),
                });
              } catch (e) {
                console.error('Failed to create knowledge source:', e);
              }
              setConnected((prev) => new Set(prev).add(id));
              setConnecting(null);
            } else if (event.type === 'close') {
              setConnecting(null);
            }
          },
        });
      } catch (err) {
        console.error('OAuth connect error:', err);
        setConnecting(null);
      }
    },
    [workspaceId],
  );

  const hasAnyConnection = connected.size > 0;

  return (
    <div className="mx-auto w-full max-w-lg px-4">
      {/* Heading */}
      <div className="mb-6 text-center">
        <h2 className="text-xl font-semibold text-white">Let your agents study your world</h2>
        <p className="mt-1 text-sm text-white/[0.66]">
          Connect knowledge sources so your agents have full context from day one.
        </p>
      </div>

      {/* All connectors grid */}
      <div className="grid grid-cols-2 gap-2">
        {ALL_CONNECTORS.map((c) => {
          const isConnected = connected.has(c.id);
          const isLoading = connecting === c.id;
          const isDisabled = c.comingSoon || isLoading;
          const Icon = c.icon;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => !c.comingSoon && handleConnect(c.id)}
              disabled={isDisabled}
              className={cn(
                'flex items-center gap-3 rounded-lg border p-3 text-left transition-colors',
                isConnected
                  ? 'border-brand/30 bg-brand/5'
                  : c.comingSoon
                    ? 'cursor-default border-white/[0.04] bg-white/[0.01] opacity-50'
                    : 'border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04]',
                isLoading && 'pointer-events-none opacity-60',
              )}
            >
              <div
                className={cn(
                  'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
                  isConnected ? 'bg-brand/10' : 'bg-white/[0.04]',
                )}
              >
                <Icon className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <span className="text-sm font-medium text-white">{c.name}</span>
                {c.comingSoon && (
                  <div className="mt-0.5 text-xs text-white/[0.33]">Coming soon</div>
                )}
                {isConnected && syncStatus[c.id]?.status === 'syncing' && (
                  <div className="mt-0.5 text-xs text-amber-400">
                    Syncing...{' '}
                    {syncStatus[c.id]?.items > 0 ? `${syncStatus[c.id].items} items` : ''}
                  </div>
                )}
                {isConnected && syncStatus[c.id]?.status === 'active' && (
                  <div className="text-brand mt-0.5 flex items-center gap-1 text-xs">
                    <Check className="h-3 w-3" />
                    {syncStatus[c.id].items} items synced
                  </div>
                )}
                {isConnected && !syncStatus[c.id] && (
                  <div className="text-brand mt-0.5 flex items-center gap-1 text-xs">
                    <Check className="h-3 w-3" />
                    Connected
                  </div>
                )}
                {isLoading && <div className="mt-0.5 text-xs text-white/[0.44]">Connecting...</div>}
              </div>
            </button>
          );
        })}
      </div>

      {/* OR divider */}
      <div className="my-4 flex items-center gap-3">
        <div className="h-px flex-1 bg-white/[0.1]" />
        <span className="text-xs font-medium text-white/[0.33]">OR</span>
        <div className="h-px flex-1 bg-white/[0.1]" />
      </div>

      {/* Upload Manually accordion */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-4 py-2.5 text-sm font-medium text-white/[0.66] transition-colors hover:bg-white/[0.04] hover:text-white"
      >
        <Upload className="h-4 w-4" />
        Upload Manually
        {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </button>

      {expanded && (
        <div className="mt-3 space-y-3">
          {/* File upload drop zone */}
          <div
            className={cn(
              'flex flex-col items-center justify-center rounded-lg border-2 border-dashed px-4 py-5 transition-colors',
              dragging
                ? 'border-brand bg-brand/5'
                : 'border-white/[0.06] hover:border-white/[0.12]',
            )}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
            }}
          >
            <Upload className="mb-1.5 h-5 w-5 text-white/[0.33]" />
            <p className="text-sm text-white/[0.66]">
              Drop files here or{' '}
              <button
                type="button"
                className="text-brand underline"
                onClick={() => fileRef.current?.click()}
              >
                browse
              </button>
            </p>
            <p className="mt-0.5 text-xs text-white/[0.33]">PDF, DOCX, TXT, MD</p>
            <input
              ref={fileRef}
              type="file"
              className="hidden"
              multiple
              accept=".pdf,.docx,.txt,.md"
            />
          </div>

          {/* URL crawl input */}
          <div className="flex items-center gap-2">
            <Globe className="h-4 w-4 shrink-0 text-white/[0.33]" />
            <Input
              placeholder="https://docs.example.com"
              value={urlValue}
              onChange={(e) => setUrlValue(e.target.value)}
              className="border-white/[0.06] bg-white/[0.02] text-white placeholder:text-white/[0.33]"
            />
            <Button
              size="sm"
              variant="outline"
              disabled={!urlValue.startsWith('http')}
              className="shrink-0 border-white/[0.06] text-white/[0.66]"
            >
              <Link2 className="h-3.5 w-3.5" />
            </Button>
          </div>

          {/* Storage meter */}
          <div className="flex items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
              <div className="bg-brand h-full w-0 rounded-full transition-all" />
            </div>
            <span className="text-xs text-white/[0.33]">0 MB / 1 GB</span>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="mt-6 flex flex-col gap-2">
        <Button onClick={onComplete} className="w-full justify-center">
          Continue
        </Button>
        <button
          type="button"
          onClick={onSkip}
          className="py-2 text-center text-xs text-white/[0.44] hover:text-white/[0.66]"
        >
          Skip for now
        </button>
        <p className="text-center text-[11px] text-white/[0.33]">
          Your agent will learn from conversations. Knowledge sources make it faster.
        </p>
      </div>
    </div>
  );
}
