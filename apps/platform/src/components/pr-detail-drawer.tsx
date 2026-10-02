'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  X,
  ExternalLink,
  GitCommit,
  FileCode2,
  MessageSquare,
  ShieldCheck,
  Check,
  Clock,
  XCircle,
  AlertTriangle,
  Loader2,
  GitMerge,
  GitPullRequest,
  Plus,
  Minus,
} from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@repo/ui/components/tooltip';
import { cn } from '@repo/ui/utils';
import type { ProjectPR } from '@repo/types';
import { apiUrl } from '@repo/db/api';
import { fetchJson } from '@/lib/fetch-json';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TimelineData {
  pr: {
    title: string;
    body: string | null;
    state: string;
    draft: boolean;
    merged: boolean;
    user: string;
    created_at: string;
    updated_at: string;
    merged_at: string | null;
    head: string;
    base: string;
    additions: number;
    deletions: number;
    changed_files: number;
  };
  commits: {
    sha: string;
    message: string;
    author: string;
    date: string;
  }[];
}

interface FileData {
  files: {
    filename: string;
    status: string;
    additions: number;
    deletions: number;
    changes: number;
  }[];
  total: number;
}

interface ReviewData {
  reviews: {
    id: number;
    user: string;
    state: string;
    body: string;
    submitted_at: string;
  }[];
  comments: {
    id: number;
    user: string;
    body: string;
    path: string;
    line: number | null;
    created_at: string;
  }[];
}

interface CheckData {
  checks: {
    id: number;
    name: string;
    status: string;
    conclusion: string | null;
    started_at: string | null;
    completed_at: string | null;
    html_url: string;
  }[];
  total: number;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface PRDetailDrawerProps {
  open: boolean;
  pr: ProjectPR | null;
  workspaceId: string;
  onClose: () => void;
}

type TabId = 'timeline' | 'files' | 'reviews' | 'checks';

const TABS: { id: TabId; label: string; icon: typeof GitCommit }[] = [
  { id: 'timeline', label: 'Timeline', icon: GitCommit },
  { id: 'files', label: 'Files', icon: FileCode2 },
  { id: 'reviews', label: 'Reviews', icon: MessageSquare },
  { id: 'checks', label: 'Checks', icon: ShieldCheck },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PRDetailDrawer({ open, pr, workspaceId, onClose }: PRDetailDrawerProps) {
  const [activeTab, setActiveTab] = useState<TabId>('timeline');
  const [loading, setLoading] = useState(false);
  const [timelineData, setTimelineData] = useState<TimelineData | null>(null);
  const [fileData, setFileData] = useState<FileData | null>(null);
  const [reviewData, setReviewData] = useState<ReviewData | null>(null);
  const [checkData, setCheckData] = useState<CheckData | null>(null);
  const fetchedTabs = useRef(new Set<TabId>());

  const fetchTab = useCallback(
    async (tab: TabId) => {
      if (!pr || fetchedTabs.current.has(tab)) return;
      fetchedTabs.current.add(tab);
      setLoading(true);
      try {
        const url = apiUrl(
          `/api/github/prs/${pr.pr_number}?workspace_id=${workspaceId}&tab=${tab}`,
        );
        const data = await fetchJson(url);
        switch (tab) {
          case 'timeline':
            setTimelineData(data as TimelineData);
            break;
          case 'files':
            setFileData(data as FileData);
            break;
          case 'reviews':
            setReviewData(data as ReviewData);
            break;
          case 'checks':
            setCheckData(data as CheckData);
            break;
        }
      } catch {
        // Allow retry on failure
        fetchedTabs.current.delete(tab);
      } finally {
        setLoading(false);
      }
    },
    [pr, workspaceId],
  );

  // Reset cache and fetch timeline when drawer opens with a new PR
  useEffect(() => {
    if (open && pr) {
      fetchedTabs.current = new Set<TabId>();
      setTimelineData(null);
      setFileData(null);
      setReviewData(null);
      setCheckData(null);
      setActiveTab('timeline');
      fetchTab('timeline');
    }
  }, [open, pr?.pr_number, fetchTab]);

  // Fetch on tab change (ref-based guard prevents duplicate fetches)
  useEffect(() => {
    if (!open || !pr) return;
    fetchTab(activeTab);
  }, [activeTab, open, pr, fetchTab]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  const prStatus = pr?.status ?? 'open';

  return (
    <>
      {/* Backdrop */}
      <div
        className={cn(
          'fixed inset-0 z-[60] bg-black/40 transition-opacity duration-200',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={pr ? `PR #${pr.pr_number}` : 'PR Detail'}
        className={cn(
          'border-border bg-surface-75 fixed top-0 right-0 z-[61] flex h-full w-2/5 min-w-[420px] flex-col border-l shadow-2xl transition-transform duration-200 ease-out',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        {/* Header */}
        <div className="border-border flex items-start justify-between border-b px-5 pt-5 pb-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              {prStatus === 'merged' ? (
                <GitMerge className="h-4 w-4 shrink-0 text-purple-400" />
              ) : (
                <GitPullRequest
                  className={`h-4 w-4 shrink-0 ${prStatus === 'draft' ? 'text-foreground-lighter' : prStatus === 'closed' ? 'text-red-400' : 'text-green-400'}`}
                />
              )}
              <h2 className="text-foreground truncate text-lg font-semibold">
                {timelineData?.pr.title ?? pr?.title ?? `PR #${pr?.pr_number}`}
              </h2>
            </div>
            <div className="text-foreground-lighter mt-1 flex items-center gap-2 text-xs">
              <span>
                {pr?.branch_name} → {pr?.base_branch ?? 'main'}
              </span>
              {pr?.pr_url && (
                <a
                  href={pr.pr_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-foreground inline-flex items-center gap-0.5 transition-colors"
                >
                  View on GitHub
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          </div>
          <TooltipProvider delayDuration={500}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close"
                  className="text-foreground-lighter hover:text-foreground rounded-md p-1 transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">
                Close
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>

        {/* Tabs */}
        <div className="border-border flex border-b px-5">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'flex cursor-pointer items-center gap-1.5 border-b-2 px-3 py-2.5 text-xs font-medium transition-colors',
                  activeTab === tab.id
                    ? 'border-brand text-foreground'
                    : 'text-foreground-lighter hover:text-foreground border-transparent',
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="text-foreground-lighter h-5 w-5 animate-spin" />
            </div>
          ) : activeTab === 'timeline' ? (
            <TimelineTab data={timelineData} />
          ) : activeTab === 'files' ? (
            <FilesTab data={fileData} prUrl={pr?.pr_url ?? ''} />
          ) : activeTab === 'reviews' ? (
            <ReviewsTab data={reviewData} />
          ) : (
            <ChecksTab data={checkData} />
          )}
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Tab content components
// ---------------------------------------------------------------------------

function TimelineTab({ data }: { data: TimelineData | null }) {
  if (!data) return <EmptyState>No timeline data</EmptyState>;

  return (
    <div className="space-y-4">
      {/* PR summary stats */}
      <div className="border-border flex items-center gap-4 rounded-lg border p-3 text-xs">
        <span className="flex items-center gap-1 text-green-400">
          <Plus className="h-3 w-3" />
          {data.pr.additions}
        </span>
        <span className="flex items-center gap-1 text-red-400">
          <Minus className="h-3 w-3" />
          {data.pr.deletions}
        </span>
        <span className="text-foreground-lighter">
          {data.pr.changed_files} file{data.pr.changed_files !== 1 ? 's' : ''}
        </span>
        <span className="text-foreground-lighter">by {data.pr.user}</span>
      </div>

      {/* Commits */}
      <div className="space-y-1">
        <h3 className="text-foreground-light text-xs font-semibold tracking-wider uppercase">
          Commits ({data.commits.length})
        </h3>
        <div className="space-y-0">
          {data.commits.map((commit) => (
            <div
              key={commit.sha}
              className="hover:bg-surface-100 flex items-start gap-2 rounded-md px-2 py-2 transition-colors"
            >
              <GitCommit className="text-foreground-lighter mt-0.5 h-3.5 w-3.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-foreground truncate text-sm">{commit.message}</p>
                <p className="text-foreground-lighter text-xs">
                  <code className="text-foreground-lighter">{commit.sha}</code>
                  {' · '}
                  {commit.author}
                  {' · '}
                  {formatDate(commit.date)}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function FilesTab({ data, prUrl }: { data: FileData | null; prUrl: string }) {
  if (!data) return <EmptyState>No file data</EmptyState>;

  // Group files by directory
  const grouped = new Map<string, typeof data.files>();
  for (const file of data.files) {
    const parts = file.filename.split('/');
    const dir = parts.length > 1 ? parts.slice(0, -1).join('/') : '.';
    if (!grouped.has(dir)) grouped.set(dir, []);
    grouped.get(dir)!.push(file);
  }

  return (
    <div className="space-y-3">
      <p className="text-foreground-lighter text-xs">
        {data.total} file{data.total !== 1 ? 's' : ''} changed
      </p>
      {[...grouped.entries()].map(([dir, files]) => (
        <div key={dir}>
          <h3 className="text-foreground-light mb-1 text-xs font-medium">{dir}/</h3>
          <div className="space-y-0">
            {files.map((file) => {
              const fileName = file.filename.split('/').pop();
              const fileUrl = prUrl
                ? `${prUrl}/files#diff-${encodeURIComponent(file.filename)}`
                : '';
              return (
                <div
                  key={file.filename}
                  className="hover:bg-surface-100 flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors"
                >
                  <FileStatusIcon status={file.status} />
                  <span className="text-foreground min-w-0 flex-1 truncate text-sm">
                    {fileName}
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5 text-xs">
                    {file.additions > 0 && (
                      <span className="text-green-400">+{file.additions}</span>
                    )}
                    {file.deletions > 0 && <span className="text-red-400">-{file.deletions}</span>}
                  </span>
                  {fileUrl && (
                    <a
                      href={fileUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-foreground-lighter hover:text-foreground shrink-0 transition-colors"
                    >
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function ReviewsTab({ data }: { data: ReviewData | null }) {
  if (!data) return <EmptyState>No review data</EmptyState>;

  if (data.reviews.length === 0 && data.comments.length === 0) {
    return <EmptyState>No reviews yet</EmptyState>;
  }

  return (
    <div className="space-y-4">
      {/* Reviews */}
      {data.reviews.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-foreground-light text-xs font-semibold tracking-wider uppercase">
            Reviews
          </h3>
          {data.reviews.map((review) => (
            <div key={review.id} className="border-border rounded-lg border p-3">
              <div className="flex items-center gap-2">
                <ReviewStateIcon state={review.state} />
                <span className="text-foreground text-sm font-medium">{review.user}</span>
                <span className="text-foreground-lighter text-xs">
                  {formatDate(review.submitted_at)}
                </span>
              </div>
              {review.body && <p className="text-foreground-light mt-2 text-sm">{review.body}</p>}
            </div>
          ))}
        </div>
      )}

      {/* Inline comments */}
      {data.comments.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-foreground-light text-xs font-semibold tracking-wider uppercase">
            Comments ({data.comments.length})
          </h3>
          {data.comments.map((comment) => (
            <div key={comment.id} className="border-border rounded-lg border p-3">
              <div className="flex items-center gap-2 text-xs">
                <span className="text-foreground font-medium">{comment.user}</span>
                <span className="text-foreground-lighter">
                  on <code className="text-foreground-lighter">{comment.path}</code>
                  {comment.line && `:${comment.line}`}
                </span>
                <span className="text-foreground-lighter">{formatDate(comment.created_at)}</span>
              </div>
              <p className="text-foreground-light mt-1.5 text-sm">{comment.body}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ChecksTab({ data }: { data: CheckData | null }) {
  if (!data) return <EmptyState>No check data</EmptyState>;

  if (data.checks.length === 0) {
    return <EmptyState>No CI checks found</EmptyState>;
  }

  return (
    <div className="space-y-1">
      {data.checks.map((check) => (
        <a
          key={check.id}
          href={check.html_url}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:bg-surface-100 flex items-center gap-2 rounded-md px-2 py-2 transition-colors"
        >
          <CheckStatusIcon status={check.status} conclusion={check.conclusion} />
          <span className="text-foreground min-w-0 flex-1 truncate text-sm">{check.name}</span>
          {check.completed_at && check.started_at && (
            <span className="text-foreground-lighter shrink-0 text-xs">
              {formatDuration(check.started_at, check.completed_at)}
            </span>
          )}
          <ExternalLink className="text-foreground-lighter h-3 w-3 shrink-0" />
        </a>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function EmptyState({ children }: { children: React.ReactNode }) {
  return <p className="text-foreground-lighter py-12 text-center text-sm">{children}</p>;
}

function FileStatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'added':
      return <Plus className="h-3.5 w-3.5 shrink-0 text-green-400" />;
    case 'removed':
      return <Minus className="h-3.5 w-3.5 shrink-0 text-red-400" />;
    case 'renamed':
      return <FileCode2 className="h-3.5 w-3.5 shrink-0 text-amber-400" />;
    default:
      return <FileCode2 className="text-foreground-lighter h-3.5 w-3.5 shrink-0" />;
  }
}

function ReviewStateIcon({ state }: { state: string }) {
  switch (state) {
    case 'APPROVED':
      return <Check className="h-4 w-4 shrink-0 text-green-400" />;
    case 'CHANGES_REQUESTED':
      return <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />;
    case 'DISMISSED':
      return <XCircle className="text-foreground-lighter h-4 w-4 shrink-0" />;
    default:
      return <MessageSquare className="text-foreground-lighter h-4 w-4 shrink-0" />;
  }
}

function CheckStatusIcon({ status, conclusion }: { status: string; conclusion: string | null }) {
  if (status === 'completed') {
    if (conclusion === 'success') return <Check className="h-4 w-4 shrink-0 text-green-400" />;
    if (conclusion === 'failure') return <XCircle className="h-4 w-4 shrink-0 text-red-400" />;
    if (conclusion === 'neutral' || conclusion === 'skipped')
      return <Clock className="text-foreground-lighter h-4 w-4 shrink-0" />;
    return <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />;
  }
  return <Loader2 className="h-4 w-4 shrink-0 animate-spin text-yellow-400" />;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffHrs = Math.floor(diffMs / 3600000);

  if (diffHrs < 1) return 'just now';
  if (diffHrs < 24) return `${diffHrs}h ago`;
  if (diffHrs < 48) return 'yesterday';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatDuration(start: string, end: string): string {
  const ms = new Date(end).getTime() - new Date(start).getTime();
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  return `${mins}m ${secs % 60}s`;
}
