'use client';

import { useCallback, useEffect, useState } from 'react';
import { MessageSquarePlus, Search, ArrowLeft, Star, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { PageActionBar } from '@/components/page-action-bar';
import { Button } from '@repo/ui/components/button';
import { Badge } from '@repo/ui/components/badge';
import { useWorkspace } from '@/providers/workspace-provider';
import { usePlan } from '@/hooks/use-plan';
import { fetchJson } from '@/lib/fetch-json';

interface FeedbackEntry {
  id: string;
  email: string;
  name: string | null;
  subject: string;
  message: string;
  type: string;
  rating: number | null;
  status: string;
  internal_notes: string | null;
  created_at: string;
  updated_at: string;
}

const STATUS_COLORS: Record<string, string> = {
  new: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  reviewed: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  actioned: 'bg-green-500/10 text-green-400 border-green-500/20',
  archived: 'bg-surface-300 text-foreground-lighter border-border',
};

const TYPE_LABELS: Record<string, string> = {
  general: 'General',
  feature_request: 'Feature Request',
  improvement: 'Improvement',
  praise: 'Praise',
  complaint: 'Complaint',
};

const PAGE_SIZE = 50;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function RatingStars({ rating }: { rating: number | null }) {
  if (!rating) return <span className="text-foreground-muted text-xs">&mdash;</span>;
  return (
    <span className="inline-flex gap-0.5" aria-label={`${rating} out of 5 stars`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          className={`h-3 w-3 ${i < rating ? 'fill-yellow-400 text-yellow-400' : 'text-surface-300'}`}
        />
      ))}
    </span>
  );
}

export default function FeedbackManagePage() {
  const { activeWorkspace } = useWorkspace();
  const { isPlatformOwner, isLoading: planLoading } = usePlan();
  const workspaceId = activeWorkspace?.id;

  const [entries, setEntries] = useState<FeedbackEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [offset, setOffset] = useState(0);
  const [selectedEntry, setSelectedEntry] = useState<FeedbackEntry | null>(null);

  const fetchEntries = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        workspace_id: workspaceId,
        limit: String(PAGE_SIZE),
        offset: String(offset),
      });
      if (statusFilter) params.set('status', statusFilter);
      const res = await fetchJson<{ data: FeedbackEntry[]; total: number }>(
        `/api/support/feedback?${params}`,
      );
      setEntries(res.data);
      setTotal(res.total);
    } catch {
      toast.error('Failed to load feedback');
    } finally {
      setLoading(false);
    }
  }, [workspaceId, offset, statusFilter]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  async function updateFeedback(id: string, status: string) {
    if (!workspaceId) return;
    try {
      await fetchJson(`/api/support/feedback?workspace_id=${workspaceId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status }),
      });
      toast.success(`Feedback updated to ${status}`);
      fetchEntries();
      if (selectedEntry?.id === id) {
        setSelectedEntry((prev) => (prev ? { ...prev, status } : null));
      }
    } catch {
      toast.error('Failed to update feedback');
    }
  }

  // Gate: platform owner only
  if (planLoading) {
    return (
      <div className="text-foreground-muted flex flex-1 items-center justify-center text-sm">
        Loading...
      </div>
    );
  }

  if (!isPlatformOwner) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-6">
        <ShieldAlert className="text-foreground-muted mb-4 h-10 w-10 opacity-40" />
        <h2 className="text-foreground text-lg font-semibold">Access restricted</h2>
        <p className="text-foreground-lighter mt-2 text-sm">
          Feedback management is only available to platform administrators.
        </p>
      </div>
    );
  }

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  const filtered = search
    ? entries.filter(
        (e) =>
          e.subject.toLowerCase().includes(search.toLowerCase()) ||
          e.email.toLowerCase().includes(search.toLowerCase()),
      )
    : entries;

  // Detail view
  if (selectedEntry) {
    return (
      <div className="flex flex-1 flex-col">
        <PageActionBar>
          <div className="flex items-center gap-2">
            <MessageSquarePlus size={16} className="text-foreground-muted" />
            <h1 className="text-foreground text-sm font-semibold">Feedback Detail</h1>
          </div>
        </PageActionBar>

        <div className="mx-auto w-full max-w-3xl px-6 py-8">
          <button
            type="button"
            onClick={() => setSelectedEntry(null)}
            className="text-foreground-lighter hover:text-foreground mb-6 inline-flex items-center gap-1.5 text-sm transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to feedback
          </button>

          <div className="border-border rounded-lg border p-6">
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h2 className="text-foreground text-xl font-semibold">{selectedEntry.subject}</h2>
                <p className="text-foreground-lighter mt-1 text-sm">
                  {selectedEntry.name ?? selectedEntry.email} &middot;{' '}
                  {formatDate(selectedEntry.created_at)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-medium ${STATUS_COLORS[selectedEntry.status] ?? ''}`}
                >
                  {selectedEntry.status}
                </span>
              </div>
            </div>

            <div className="border-border mb-4 flex flex-wrap gap-3 border-b pb-4 text-xs">
              <span className="text-foreground-muted">
                Type:{' '}
                <span className="text-foreground">
                  {TYPE_LABELS[selectedEntry.type] ?? selectedEntry.type}
                </span>
              </span>
              {selectedEntry.rating && (
                <span className="flex items-center gap-1">
                  <span className="text-foreground-muted">Rating:</span>
                  <RatingStars rating={selectedEntry.rating} />
                </span>
              )}
              <span className="text-foreground-muted">
                Email: <span className="text-foreground">{selectedEntry.email}</span>
              </span>
            </div>

            <div className="bg-surface-75 rounded-md p-4">
              <p className="text-foreground text-sm leading-relaxed whitespace-pre-wrap">
                {selectedEntry.message}
              </p>
            </div>

            <div className="mt-6 flex items-center gap-2">
              <span className="text-foreground-lighter text-xs">Update status:</span>
              <select
                value={selectedEntry.status}
                onChange={(e) => updateFeedback(selectedEntry.id, e.target.value)}
                className="bg-surface-100 border-border text-foreground rounded border px-2 py-1 text-xs focus:outline-none"
              >
                <option value="new">New</option>
                <option value="reviewed">Reviewed</option>
                <option value="actioned">Actioned</option>
                <option value="archived">Archived</option>
              </select>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Table view
  return (
    <div className="flex flex-1 flex-col">
      <PageActionBar>
        <div className="flex items-center gap-2">
          <MessageSquarePlus size={16} className="text-foreground-muted" />
          <h1 className="text-foreground text-sm font-semibold">Feedback Inbox</h1>
          <Badge variant="secondary" className="ml-1 text-xs">
            {total}
          </Badge>
        </div>
      </PageActionBar>

      {/* Filters */}
      <div className="border-border flex items-center gap-3 border-b px-6 py-3">
        <div className="relative max-w-xs flex-1">
          <Search
            size={14}
            className="text-foreground-muted absolute top-1/2 left-3 -translate-y-1/2"
          />
          <input
            type="text"
            placeholder="Search feedback..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="bg-surface-100 border-border text-foreground placeholder:text-foreground-muted w-full rounded-md border py-1.5 pr-3 pl-9 text-sm focus:ring-1 focus:ring-blue-500/30 focus:outline-none"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            setOffset(0);
          }}
          className="bg-surface-100 border-border text-foreground rounded-md border px-3 py-1.5 text-sm focus:ring-1 focus:ring-blue-500/30 focus:outline-none"
        >
          <option value="">All statuses</option>
          <option value="new">New</option>
          <option value="reviewed">Reviewed</option>
          <option value="actioned">Actioned</option>
          <option value="archived">Archived</option>
        </select>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="text-foreground-muted flex items-center justify-center py-20 text-sm">
            Loading...
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-foreground-muted flex flex-col items-center justify-center py-20">
            <MessageSquarePlus size={32} className="mb-3 opacity-40" />
            <p className="text-sm">No feedback yet</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-border text-foreground-muted border-b text-left text-xs">
                <th className="px-6 py-2.5 font-medium">Subject</th>
                <th className="px-4 py-2.5 font-medium">From</th>
                <th className="px-4 py-2.5 font-medium">Type</th>
                <th className="px-4 py-2.5 font-medium">Rating</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">Date</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((entry) => (
                <tr
                  key={entry.id}
                  tabIndex={0}
                  role="button"
                  onClick={() => setSelectedEntry(entry)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setSelectedEntry(entry);
                    }
                  }}
                  className="border-border hover:bg-surface-100 focus:bg-surface-100 cursor-pointer border-b transition-colors focus:outline-none"
                >
                  <td className="text-foreground max-w-[300px] truncate px-6 py-3 font-medium">
                    {entry.subject}
                  </td>
                  <td className="text-foreground-lighter px-4 py-3">{entry.name ?? entry.email}</td>
                  <td className="text-foreground-muted px-4 py-3">
                    {TYPE_LABELS[entry.type] ?? entry.type}
                  </td>
                  <td className="px-4 py-3">
                    <RatingStars rating={entry.rating} />
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[entry.status] ?? ''}`}
                    >
                      {entry.status}
                    </span>
                  </td>
                  <td className="text-foreground-muted px-4 py-3">
                    {formatDate(entry.created_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="border-border text-foreground-muted flex items-center justify-between border-t px-6 py-3 text-xs">
          <span>
            Showing {offset + 1}&ndash;{Math.min(offset + PAGE_SIZE, total)} of {total}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage >= totalPages}
              onClick={() => setOffset(offset + PAGE_SIZE)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
