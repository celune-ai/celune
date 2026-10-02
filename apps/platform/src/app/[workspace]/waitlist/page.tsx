'use client';

import { useCallback, useEffect, useState } from 'react';
import { Download, Mail, Search, Users } from 'lucide-react';
import { toast } from 'sonner';
import { PageActionBar } from '@/components/page-action-bar';
import { Button } from '@repo/ui/components/button';
import { Badge } from '@repo/ui/components/badge';
import { apiUrl } from '@repo/db/api';
import { fetchJson } from '@/lib/fetch-json';

interface WaitlistEntry {
  id: string;
  email: string;
  source: string | null;
  status: string;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  notes: string | null;
  created_at: string;
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  confirmed: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  invited: 'bg-green-500/10 text-green-400 border-green-500/20',
  converted: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
};

const PAGE_SIZE = 50;

export default function WaitlistPage() {
  const [entries, setEntries] = useState<WaitlistEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [offset, setOffset] = useState(0);

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
      if (statusFilter) params.set('status', statusFilter);
      if (search) params.set('search', search);
      const res = await fetchJson<{ data: WaitlistEntry[]; total: number }>(
        apiUrl(`/api/waitlist?${params}`),
      );
      setEntries(res.data);
      setTotal(res.total);
    } catch {
      toast.error('Failed to load waitlist');
    } finally {
      setLoading(false);
    }
  }, [offset, statusFilter, search]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  async function updateStatus(id: string, status: string) {
    try {
      await fetchJson(apiUrl('/api/waitlist'), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status }),
      });
      toast.success(`Status updated to ${status}`);
      fetchEntries();
    } catch {
      toast.error('Failed to update status');
    }
  }

  function exportCsv() {
    const header = 'email,status,source,utm_source,utm_medium,utm_campaign,created_at\n';
    const rows = entries
      .map(
        (e) =>
          `${e.email},${e.status},${e.source ?? ''},${e.utm_source ?? ''},${e.utm_medium ?? ''},${e.utm_campaign ?? ''},${e.created_at}`,
      )
      .join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `waitlist-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <div className="flex flex-1 flex-col">
      <PageActionBar>
        <div className="flex items-center gap-2">
          <Mail size={16} className="text-foreground-muted" />
          <h1 className="text-foreground text-sm font-semibold">Waitlist</h1>
          <Badge variant="secondary" className="ml-1 text-xs">
            {total}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={exportCsv}>
            <Download size={14} className="mr-1.5" />
            Export CSV
          </Button>
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
            placeholder="Search by email..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setOffset(0);
            }}
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
          <option value="pending">Pending</option>
          <option value="confirmed">Confirmed</option>
          <option value="invited">Invited</option>
          <option value="converted">Converted</option>
        </select>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="text-foreground-muted flex items-center justify-center py-20 text-sm">
            Loading...
          </div>
        ) : entries.length === 0 ? (
          <div className="text-foreground-muted flex flex-col items-center justify-center py-20">
            <Users size={32} className="mb-3 opacity-40" />
            <p className="text-sm">No waitlist entries yet</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-border text-foreground-muted border-b text-left text-xs">
                <th className="px-6 py-2.5 font-medium">Email</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">Source</th>
                <th className="px-4 py-2.5 font-medium">UTM</th>
                <th className="px-4 py-2.5 font-medium">Signed Up</th>
                <th className="px-4 py-2.5 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr
                  key={entry.id}
                  className="border-border hover:bg-surface-100 border-b transition-colors"
                >
                  <td className="text-foreground px-6 py-3 font-medium">{entry.email}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[entry.status] ?? ''}`}
                    >
                      {entry.status}
                    </span>
                  </td>
                  <td className="text-foreground-muted px-4 py-3">{entry.source ?? '—'}</td>
                  <td className="text-foreground-muted px-4 py-3 text-xs">
                    {entry.utm_source || entry.utm_medium || entry.utm_campaign
                      ? [entry.utm_source, entry.utm_medium, entry.utm_campaign]
                          .filter(Boolean)
                          .join(' / ')
                      : '—'}
                  </td>
                  <td className="text-foreground-muted px-4 py-3">
                    {new Date(entry.created_at).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={entry.status}
                      onChange={(e) => updateStatus(entry.id, e.target.value)}
                      className="bg-surface-100 border-border text-foreground rounded border px-2 py-1 text-xs focus:outline-none"
                    >
                      <option value="pending">Pending</option>
                      <option value="confirmed">Confirmed</option>
                      <option value="invited">Invited</option>
                      <option value="converted">Converted</option>
                    </select>
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
