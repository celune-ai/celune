'use client';

import { useCallback, useEffect, useState } from 'react';
import { LifeBuoy, Search, ArrowLeft, Clock, AlertCircle, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { PageActionBar } from '@/components/page-action-bar';
import { Button } from '@repo/ui/components/button';
import { Badge } from '@repo/ui/components/badge';
import { useWorkspace } from '@/providers/workspace-provider';
import { useWorkspaceHref } from '@/hooks/use-workspace-href';
import { usePlan } from '@/hooks/use-plan';
import { fetchJson } from '@/lib/fetch-json';
import Link from 'next/link';

interface Ticket {
  id: string;
  email: string;
  name: string | null;
  subject: string;
  message: string;
  category: string;
  status: string;
  priority: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  open: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  in_progress: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  resolved: 'bg-green-500/10 text-green-400 border-green-500/20',
  closed: 'bg-surface-300 text-foreground-lighter border-border',
};

const PRIORITY_COLORS: Record<string, string> = {
  low: 'text-foreground-lighter',
  normal: 'text-foreground',
  urgent: 'text-destructive',
};

const PAGE_SIZE = 50;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function TicketsPage() {
  const { activeWorkspace } = useWorkspace();
  const { workspaceHref } = useWorkspaceHref();
  const { isPlatformOwner, isLoading: planLoading } = usePlan();
  const workspaceId = activeWorkspace?.id;

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [offset, setOffset] = useState(0);
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);

  const fetchTickets = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        workspace_id: workspaceId,
        limit: String(PAGE_SIZE),
        offset: String(offset),
      });
      if (statusFilter) params.set('status', statusFilter);
      const res = await fetchJson<{ data: Ticket[]; total: number }>(
        `/api/support/tickets?${params}`,
      );
      setTickets(res.data);
      setTotal(res.total);
    } catch {
      toast.error('Failed to load tickets');
    } finally {
      setLoading(false);
    }
  }, [workspaceId, offset, statusFilter]);

  useEffect(() => {
    fetchTickets();
  }, [fetchTickets]);

  async function updateStatus(id: string, status: string) {
    try {
      await fetchJson('/api/support/tickets', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status }),
      });
      toast.success(`Ticket updated to ${status}`);
      fetchTickets();
      if (selectedTicket?.id === id) {
        setSelectedTicket((prev) => (prev ? { ...prev, status } : null));
      }
    } catch {
      toast.error('Failed to update ticket');
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
          Ticket management is only available to platform administrators.
        </p>
        <Button variant="outline" size="sm" className="mt-4" asChild>
          <Link href={workspaceHref('/support')}>File a Ticket</Link>
        </Button>
      </div>
    );
  }

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  // Filtered by search (client-side for simplicity)
  const filtered = search
    ? tickets.filter(
        (t) =>
          t.subject.toLowerCase().includes(search.toLowerCase()) ||
          t.email.toLowerCase().includes(search.toLowerCase()) ||
          (t.name ?? '').toLowerCase().includes(search.toLowerCase()),
      )
    : tickets;

  // Detail view
  if (selectedTicket) {
    return (
      <div className="flex flex-1 flex-col">
        <PageActionBar>
          <div className="flex items-center gap-2">
            <LifeBuoy size={16} className="text-foreground-muted" />
            <h1 className="text-foreground text-sm font-semibold">Ticket Detail</h1>
          </div>
        </PageActionBar>

        <div className="mx-auto w-full max-w-3xl px-6 py-8">
          <button
            type="button"
            onClick={() => setSelectedTicket(null)}
            className="text-foreground-lighter hover:text-foreground mb-6 inline-flex items-center gap-1.5 text-sm transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to tickets
          </button>

          <div className="border-border rounded-lg border p-6">
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h2 className="text-foreground text-xl font-semibold">{selectedTicket.subject}</h2>
                <p className="text-foreground-lighter mt-1 text-sm">
                  {selectedTicket.name ?? selectedTicket.email} &middot;{' '}
                  {formatDate(selectedTicket.created_at)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-medium ${STATUS_COLORS[selectedTicket.status] ?? ''}`}
                >
                  {selectedTicket.status}
                </span>
                {selectedTicket.priority && (
                  <span
                    className={`text-xs font-medium ${PRIORITY_COLORS[selectedTicket.priority] ?? ''}`}
                  >
                    {selectedTicket.priority}
                  </span>
                )}
              </div>
            </div>

            <div className="border-border mb-4 flex flex-wrap gap-3 border-b pb-4 text-xs">
              <span className="text-foreground-muted">
                Category:{' '}
                <span className="text-foreground capitalize">{selectedTicket.category}</span>
              </span>
              <span className="text-foreground-muted">
                Email: <span className="text-foreground">{selectedTicket.email}</span>
              </span>
              <span className="text-foreground-muted">
                ID:{' '}
                <span className="text-foreground font-mono">{selectedTicket.id.slice(0, 8)}</span>
              </span>
            </div>

            <div className="bg-surface-75 rounded-md p-4">
              <p className="text-foreground text-sm leading-relaxed whitespace-pre-wrap">
                {selectedTicket.message}
              </p>
            </div>

            <div className="mt-6 flex items-center gap-2">
              <span className="text-foreground-lighter text-xs">Update status:</span>
              <select
                value={selectedTicket.status}
                onChange={(e) => updateStatus(selectedTicket.id, e.target.value)}
                className="bg-surface-100 border-border text-foreground rounded border px-2 py-1 text-xs focus:outline-none"
              >
                <option value="open">Open</option>
                <option value="in_progress">In Progress</option>
                <option value="resolved">Resolved</option>
                <option value="closed">Closed</option>
              </select>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <PageActionBar>
        <div className="flex items-center gap-2">
          <LifeBuoy size={16} className="text-foreground-muted" />
          <h1 className="text-foreground text-sm font-semibold">Tickets</h1>
          <Badge variant="secondary" className="ml-1 text-xs">
            {total}
          </Badge>
        </div>
        <Button variant="default" size="sm" asChild>
          <Link href={workspaceHref('/support')}>New Ticket</Link>
        </Button>
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
            placeholder="Search by subject or email..."
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
          <option value="open">Open</option>
          <option value="in_progress">In Progress</option>
          <option value="resolved">Resolved</option>
          <option value="closed">Closed</option>
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
            <LifeBuoy size={32} className="mb-3 opacity-40" />
            <p className="text-sm">No tickets yet</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-border text-foreground-muted border-b text-left text-xs">
                <th className="px-6 py-2.5 font-medium">Subject</th>
                <th className="px-4 py-2.5 font-medium">From</th>
                <th className="px-4 py-2.5 font-medium">Category</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">Priority</th>
                <th className="px-4 py-2.5 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((ticket) => (
                <tr
                  key={ticket.id}
                  tabIndex={0}
                  role="button"
                  onClick={() => setSelectedTicket(ticket)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setSelectedTicket(ticket);
                    }
                  }}
                  className="border-border hover:bg-surface-100 focus:bg-surface-100 cursor-pointer border-b transition-colors focus:outline-none"
                >
                  <td className="text-foreground max-w-[300px] truncate px-6 py-3 font-medium">
                    {ticket.subject}
                  </td>
                  <td className="text-foreground-lighter px-4 py-3">
                    {ticket.name ?? ticket.email}
                  </td>
                  <td className="text-foreground-muted px-4 py-3 capitalize">{ticket.category}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[ticket.status] ?? ''}`}
                    >
                      {ticket.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`text-xs font-medium ${PRIORITY_COLORS[ticket.priority ?? 'normal'] ?? ''}`}
                    >
                      {ticket.priority ?? 'normal'}
                    </span>
                  </td>
                  <td className="text-foreground-muted px-4 py-3">
                    {formatDate(ticket.created_at)}
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
            Showing {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}
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
