'use client';

import { useCallback, useEffect, useState } from 'react';
import { Inbox, Search, ArrowLeft, MessageCircle, User, Bot } from 'lucide-react';
import { toast } from 'sonner';
import { PageActionBar } from '@/components/page-action-bar';
import { Button } from '@repo/ui/components/button';
import { Badge } from '@repo/ui/components/badge';
import { useWorkspace } from '@/providers/workspace-provider';
import { fetchJson } from '@/lib/fetch-json';

interface ConversationLog {
  id: string;
  user_id: string | null;
  workspace_id: string | null;
  session_id: string | null;
  source: string;
  agent_id: string | null;
  title: string | null;
  summary: string | null;
  message_count: number;
  status: string;
  metadata: Record<string, unknown>;
  started_at: string;
  ended_at: string | null;
  created_at: string;
}

interface ConversationMessage {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-green-500/10 text-green-400 border-green-500/20',
  resolved: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  escalated: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
  archived: 'bg-surface-300 text-foreground-lighter border-border',
};

const SOURCE_LABELS: Record<string, string> = {
  web_chat: 'Web Chat',
  docs_chat: 'Docs Chat',
  slack: 'Slack',
  api: 'API',
  agent: 'Agent',
};

const PAGE_SIZE = 50;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function MessageBubble({ msg }: { msg: ConversationMessage }) {
  const isUser = msg.role === 'user';
  const isSystem = msg.role === 'system';

  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
      <div
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
          isUser
            ? 'bg-brand/15 text-brand'
            : isSystem
              ? 'bg-surface-300 text-foreground-lighter'
              : 'bg-violet-500/15 text-violet-400'
        }`}
      >
        {isUser ? <User className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
      </div>
      <div
        className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
          isUser
            ? 'bg-brand/10 text-foreground'
            : isSystem
              ? 'bg-surface-200 text-foreground-lighter italic'
              : 'bg-surface-100 text-foreground'
        }`}
      >
        <p className="leading-relaxed break-words whitespace-pre-wrap">{msg.content}</p>
        <p className="text-foreground-muted mt-1 text-[10px]">{formatTime(msg.created_at)}</p>
      </div>
    </div>
  );
}

export default function TriagePage() {
  const { activeWorkspace } = useWorkspace();
  const workspaceId = activeWorkspace?.id;

  const [logs, setLogs] = useState<ConversationLog[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [offset, setOffset] = useState(0);
  const [selectedLog, setSelectedLog] = useState<ConversationLog | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);

  const fetchLogs = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        workspace_id: workspaceId,
        limit: String(PAGE_SIZE),
        offset: String(offset),
      });
      if (statusFilter) params.set('status', statusFilter);
      if (sourceFilter) params.set('source', sourceFilter);
      const res = await fetchJson<{ data: ConversationLog[]; total: number }>(
        `/api/support/triage?${params}`,
      );
      setLogs(res.data);
      setTotal(res.total);
    } catch {
      toast.error('Failed to load conversation logs');
    } finally {
      setLoading(false);
    }
  }, [workspaceId, offset, statusFilter, sourceFilter]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  async function openConversation(log: ConversationLog) {
    setSelectedLog(log);
    setLoadingMessages(true);
    try {
      const params = new URLSearchParams();
      if (workspaceId) params.set('workspace_id', workspaceId);
      const res = await fetchJson<{ data: ConversationMessage[] }>(
        `/api/support/triage/${log.id}/messages?${params}`,
      );
      setMessages(res.data);
    } catch {
      toast.error('Failed to load messages');
    } finally {
      setLoadingMessages(false);
    }
  }

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  const filtered = search
    ? logs.filter(
        (l) =>
          (l.title ?? '').toLowerCase().includes(search.toLowerCase()) ||
          (l.summary ?? '').toLowerCase().includes(search.toLowerCase()) ||
          (l.agent_id ?? '').toLowerCase().includes(search.toLowerCase()),
      )
    : logs;

  // Detail view — conversation thread
  if (selectedLog) {
    return (
      <div className="flex flex-1 flex-col">
        <PageActionBar>
          <div className="flex items-center gap-2">
            <Inbox size={16} className="text-foreground-muted" />
            <h1 className="text-foreground text-sm font-semibold">Conversation Detail</h1>
          </div>
        </PageActionBar>

        <div className="mx-auto w-full max-w-3xl px-6 py-8">
          <button
            type="button"
            onClick={() => {
              setSelectedLog(null);
              setMessages([]);
            }}
            className="text-foreground-lighter hover:text-foreground mb-6 inline-flex items-center gap-1.5 text-sm transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to triage
          </button>

          <div className="border-border mb-6 rounded-lg border p-6">
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h2 className="text-foreground text-xl font-semibold">
                  {selectedLog.title ?? `Conversation ${selectedLog.id.slice(0, 8)}`}
                </h2>
                <p className="text-foreground-lighter mt-1 text-sm">
                  {SOURCE_LABELS[selectedLog.source] ?? selectedLog.source} &middot;{' '}
                  {formatDate(selectedLog.started_at)} &middot; {selectedLog.message_count} messages
                </p>
              </div>
              <span
                className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-medium ${STATUS_COLORS[selectedLog.status] ?? ''}`}
              >
                {selectedLog.status}
              </span>
            </div>

            {selectedLog.summary && (
              <div className="bg-surface-75 mb-4 rounded-md p-3">
                <p className="text-foreground-lighter text-xs font-medium tracking-wider uppercase">
                  Summary
                </p>
                <p className="text-foreground mt-1 text-sm">{selectedLog.summary}</p>
              </div>
            )}

            <div className="border-border flex flex-wrap gap-3 border-t pt-3 text-xs">
              {selectedLog.agent_id && (
                <span className="text-foreground-muted">
                  Agent: <span className="text-foreground font-mono">{selectedLog.agent_id}</span>
                </span>
              )}
              {selectedLog.session_id && (
                <span className="text-foreground-muted">
                  Session:{' '}
                  <span className="text-foreground font-mono">
                    {selectedLog.session_id.slice(0, 12)}
                  </span>
                </span>
              )}
              {selectedLog.ended_at && (
                <span className="text-foreground-muted">
                  Ended: <span className="text-foreground">{formatDate(selectedLog.ended_at)}</span>
                </span>
              )}
            </div>
          </div>

          {/* Messages thread */}
          <div className="space-y-4">
            <h3 className="text-foreground-lighter flex items-center gap-1.5 text-xs font-medium tracking-wider uppercase">
              <MessageCircle className="h-3.5 w-3.5" />
              Messages
            </h3>

            {loadingMessages ? (
              <div className="text-foreground-muted py-8 text-center text-sm">
                Loading messages...
              </div>
            ) : messages.length === 0 ? (
              <div className="text-foreground-muted py-8 text-center text-sm">
                No messages recorded for this conversation.
              </div>
            ) : (
              <div className="space-y-3">
                {messages.map((msg) => (
                  <MessageBubble key={msg.id} msg={msg} />
                ))}
              </div>
            )}
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
          <Inbox size={16} className="text-foreground-muted" />
          <h1 className="text-foreground text-sm font-semibold">Triage</h1>
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
            placeholder="Search conversations..."
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
          <option value="active">Active</option>
          <option value="resolved">Resolved</option>
          <option value="escalated">Escalated</option>
          <option value="archived">Archived</option>
        </select>
        <select
          value={sourceFilter}
          onChange={(e) => {
            setSourceFilter(e.target.value);
            setOffset(0);
          }}
          className="bg-surface-100 border-border text-foreground rounded-md border px-3 py-1.5 text-sm focus:ring-1 focus:ring-blue-500/30 focus:outline-none"
        >
          <option value="">All sources</option>
          <option value="web_chat">Web Chat</option>
          <option value="docs_chat">Docs Chat</option>
          <option value="slack">Slack</option>
          <option value="api">API</option>
          <option value="agent">Agent</option>
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
            <Inbox size={32} className="mb-3 opacity-40" />
            <p className="text-sm">No conversation logs yet</p>
            <p className="mt-1 text-xs opacity-60">
              Conversations from chat assistants will appear here.
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-border text-foreground-muted border-b text-left text-xs">
                <th className="px-6 py-2.5 font-medium">Conversation</th>
                <th className="px-4 py-2.5 font-medium">Source</th>
                <th className="px-4 py-2.5 font-medium">Agent</th>
                <th className="px-4 py-2.5 font-medium">Messages</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">Started</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((log) => (
                <tr
                  key={log.id}
                  onClick={() => openConversation(log)}
                  className="border-border hover:bg-surface-100 cursor-pointer border-b transition-colors"
                >
                  <td className="text-foreground max-w-[300px] truncate px-6 py-3 font-medium">
                    {log.title ?? `Conversation ${log.id.slice(0, 8)}`}
                  </td>
                  <td className="text-foreground-lighter px-4 py-3">
                    {SOURCE_LABELS[log.source] ?? log.source}
                  </td>
                  <td className="text-foreground-muted px-4 py-3 font-mono text-xs">
                    {log.agent_id ?? '—'}
                  </td>
                  <td className="text-foreground-lighter px-4 py-3 tabular-nums">
                    {log.message_count}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[log.status] ?? ''}`}
                    >
                      {log.status}
                    </span>
                  </td>
                  <td className="text-foreground-muted px-4 py-3">{formatDate(log.started_at)}</td>
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
