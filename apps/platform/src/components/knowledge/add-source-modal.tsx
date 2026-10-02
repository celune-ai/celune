'use client';

import { useState, useMemo, useCallback, useRef } from 'react';
import Nango from '@nangohq/frontend';
import { Search, Upload, Globe, Link2 } from 'lucide-react';
import { cn } from '@repo/ui/utils';
import { Button } from '@repo/ui/components/button';
import { Input } from '@repo/ui/components/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@repo/ui/components/dialog';
import { GitHubLogo } from '@/components/icons/integration-logos';
import {
  NotionLogo,
  GoogleDriveLogo,
  GmailLogo,
  LinearLogo,
  AsanaLogo,
  ConfluenceLogo,
  DropboxLogo,
  FigmaLogo,
  JiraLogo,
  FileUploadLogo,
  UrlCrawlLogo,
} from './knowledge-source-logos';

// ---------------------------------------------------------------------------
// Connector definitions
// ---------------------------------------------------------------------------

type AuthType = 'OAuth' | 'Upload' | 'URL';

interface ConnectorDef {
  id: string;
  name: string;
  description: string;
  authType: AuthType;
  icon: React.FC<{ className?: string }>;
  popular?: boolean;
}

const CONNECTORS: ConnectorDef[] = [
  {
    id: 'notion',
    name: 'Notion',
    description: 'Sync pages, databases, and wikis',
    authType: 'OAuth',
    icon: NotionLogo,
    popular: true,
  },
  {
    id: 'google-drive',
    name: 'Google Drive',
    description: 'Docs, Sheets, Slides, and files',
    authType: 'OAuth',
    icon: GoogleDriveLogo,
    popular: true,
  },
  {
    id: 'github',
    name: 'GitHub',
    description: 'Repos, issues, PRs, and wikis',
    authType: 'OAuth',
    icon: GitHubLogo,
    popular: true,
  },
  {
    id: 'linear',
    name: 'Linear',
    description: 'Issues, projects, and roadmaps',
    authType: 'OAuth',
    icon: LinearLogo,
    popular: true,
  },
  {
    id: 'gmail',
    name: 'Gmail',
    description: 'Email threads and attachments',
    authType: 'OAuth',
    icon: GmailLogo,
  },
  {
    id: 'asana',
    name: 'Asana',
    description: 'Tasks, projects, and portfolios',
    authType: 'OAuth',
    icon: AsanaLogo,
  },
  {
    id: 'confluence',
    name: 'Confluence',
    description: 'Spaces, pages, and blog posts',
    authType: 'OAuth',
    icon: ConfluenceLogo,
  },
  {
    id: 'dropbox',
    name: 'Dropbox',
    description: 'Files and shared folders',
    authType: 'OAuth',
    icon: DropboxLogo,
  },
  {
    id: 'figma',
    name: 'Figma',
    description: 'Design files and components',
    authType: 'OAuth',
    icon: FigmaLogo,
  },
  {
    id: 'jira',
    name: 'Jira',
    description: 'Issues, sprints, and project boards',
    authType: 'OAuth',
    icon: JiraLogo,
  },
  {
    id: 'file-upload',
    name: 'File Upload',
    description: 'Upload PDFs, docs, and text files',
    authType: 'Upload',
    icon: FileUploadLogo,
  },
  {
    id: 'url-crawl',
    name: 'URL Crawl',
    description: 'Crawl and index any public URL',
    authType: 'URL',
    icon: UrlCrawlLogo,
  },
];

// ---------------------------------------------------------------------------
// Auth type badge
// ---------------------------------------------------------------------------

const AUTH_BADGE_STYLES: Record<AuthType, string> = {
  OAuth: 'bg-brand/10 text-brand',
  Upload: 'bg-amber-500/10 text-amber-400',
  URL: 'bg-blue-500/10 text-blue-400',
};

// ---------------------------------------------------------------------------
// Inline file upload UI
// ---------------------------------------------------------------------------

function FileUploadInline({ onClose }: { onClose: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={onClose}
        className="text-foreground-lighter hover:text-foreground text-sm underline"
      >
        Back to sources
      </button>
      <div
        className={cn(
          'border-border flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 transition-colors',
          dragging ? 'border-brand bg-brand/5' : 'hover:border-foreground-muted',
        )}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          // TODO: handle file upload
        }}
      >
        <Upload className="text-foreground-muted mb-2 h-8 w-8" />
        <p className="text-foreground text-sm font-medium">
          Drag files here or{' '}
          <button
            type="button"
            className="text-brand underline"
            onClick={() => fileRef.current?.click()}
          >
            browse
          </button>
        </p>
        <p className="text-foreground-muted mt-1 text-xs">PDF, DOCX, TXT, MD (max 50MB each)</p>
        <input ref={fileRef} type="file" className="hidden" multiple accept=".pdf,.docx,.txt,.md" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline URL crawl UI
// ---------------------------------------------------------------------------

function UrlCrawlInline({ onClose }: { onClose: () => void }) {
  const [url, setUrl] = useState('');

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={onClose}
        className="text-foreground-lighter hover:text-foreground text-sm underline"
      >
        Back to sources
      </button>
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Globe className="text-foreground-muted h-5 w-5 shrink-0" />
          <Input
            placeholder="https://docs.example.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="flex-1"
          />
        </div>
        <p className="text-foreground-muted text-xs">
          We will crawl all accessible pages from this URL and index the content.
        </p>
        <Button size="sm" disabled={!url.startsWith('http')} className="w-full justify-center">
          <Link2 className="mr-1.5 h-3.5 w-3.5" />
          Start Crawl
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modal component
// ---------------------------------------------------------------------------

interface AddSourceModalProps {
  open: boolean;
  onClose: () => void;
  onSelectProvider?: (providerId: string) => void;
  workspaceId?: string;
}

export function AddSourceModal({
  open,
  onClose,
  onSelectProvider,
  workspaceId,
}: AddSourceModalProps) {
  const [search, setSearch] = useState('');
  const [inlineView, setInlineView] = useState<'file-upload' | 'url-crawl' | null>(null);

  const filtered = useMemo(() => {
    if (!search.trim()) return CONNECTORS;
    const q = search.toLowerCase();
    return CONNECTORS.filter(
      (c) => c.name.toLowerCase().includes(q) || c.description.toLowerCase().includes(q),
    );
  }, [search]);

  const popular = useMemo(() => filtered.filter((c) => c.popular), [filtered]);
  const others = useMemo(() => filtered.filter((c) => !c.popular), [filtered]);

  const handleSelect = useCallback(
    async (connector: ConnectorDef) => {
      if (connector.id === 'file-upload') {
        setInlineView('file-upload');
        return;
      }
      if (connector.id === 'url-crawl') {
        setInlineView('url-crawl');
        return;
      }
      // OAuth flow via Nango session token
      onSelectProvider?.(connector.id);
      if (!workspaceId) return;

      try {
        const res = await fetch(
          `/api/knowledge/oauth/connect/${connector.id}?workspace_id=${workspaceId}`,
        );
        if (!res.ok) return;
        const { token } = await res.json();

        const nango = new Nango();
        await nango.openConnectUI({
          sessionToken: token,
          onEvent: async (event) => {
            if (event.type === 'connect') {
              // Create knowledge_source record and trigger crawl
              try {
                await fetch(`/api/knowledge/sources?workspace_id=${workspaceId}`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    provider: connector.id,
                    display_name: connector.name,
                    nango_connection_id:
                      (event as { payload?: { connectionId?: string } }).payload?.connectionId ??
                      `${workspaceId}_${connector.id}`,
                  }),
                });
              } catch (e) {
                console.error('Failed to create knowledge source:', e);
              }
              onClose();
            }
          },
        });
      } catch (err) {
        console.error('OAuth connect error:', err);
      }
    },
    [onSelectProvider, workspaceId, onClose],
  );

  const handleClose = useCallback(() => {
    setSearch('');
    setInlineView(null);
    onClose();
  }, [onClose]);

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) handleClose();
      }}
    >
      <DialogContent className="border-border bg-surface-75 max-w-lg overflow-hidden rounded-xl border p-0 shadow-2xl">
        <DialogHeader className="border-border border-b px-5 py-4">
          <DialogTitle className="text-foreground text-lg font-semibold">
            Add Knowledge Source
          </DialogTitle>
        </DialogHeader>

        <div className="max-h-[60vh] overflow-y-auto px-5 py-4 sm:max-h-[70vh]">
          {inlineView === 'file-upload' ? (
            <FileUploadInline onClose={() => setInlineView(null)} />
          ) : inlineView === 'url-crawl' ? (
            <UrlCrawlInline onClose={() => setInlineView(null)} />
          ) : (
            <>
              {/* Search */}
              <div className="relative mb-4">
                <Search className="text-foreground-muted pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
                <Input
                  placeholder="Search connectors..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                  autoFocus
                />
              </div>

              {/* Popular section */}
              {popular.length > 0 && (
                <div className="mb-4">
                  <h3 className="text-foreground-lighter mb-2 text-xs font-medium tracking-wider uppercase">
                    Popular
                  </h3>
                  <div className="grid grid-cols-2 gap-2">
                    {popular.map((c) => (
                      <ConnectorCard key={c.id} connector={c} onClick={() => handleSelect(c)} />
                    ))}
                  </div>
                </div>
              )}

              {/* Other sources */}
              {others.length > 0 && (
                <div>
                  {popular.length > 0 && (
                    <h3 className="text-foreground-lighter mb-2 text-xs font-medium tracking-wider uppercase">
                      All Sources
                    </h3>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    {others.map((c) => (
                      <ConnectorCard key={c.id} connector={c} onClick={() => handleSelect(c)} />
                    ))}
                  </div>
                </div>
              )}

              {filtered.length === 0 && (
                <p className="text-foreground-muted py-8 text-center text-sm">
                  No connectors match your search.
                </p>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Connector card
// ---------------------------------------------------------------------------

function ConnectorCard({ connector, onClick }: { connector: ConnectorDef; onClick: () => void }) {
  const Icon = connector.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      className="border-border bg-surface-100 hover:bg-surface-200 flex items-start gap-3 rounded-lg border p-3 text-left transition-colors"
    >
      <div className="bg-surface-300 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg">
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-foreground text-sm font-medium">{connector.name}</span>
          <span
            className={cn(
              'rounded-full px-1.5 py-0.5 text-[10px] font-medium',
              AUTH_BADGE_STYLES[connector.authType],
            )}
          >
            {connector.authType}
          </span>
        </div>
        <p className="text-foreground-muted mt-0.5 text-xs leading-snug">{connector.description}</p>
      </div>
    </button>
  );
}
