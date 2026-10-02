'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRightLeft,
  CheckCircle2,
  MessageSquare,
  ChevronRight,
  Loader2,
  Users,
} from 'lucide-react';
import { Badge } from '@repo/ui/components/badge';
import type { MessageThread, MessageThreadResponse, AgentMessage, MessageType } from '@repo/types';
import { fetchJson } from '@/lib/fetch-json';
import { formatRelativeTime } from '@/lib/date-utils';
import { useWorkspace } from '@/providers/workspace-provider';
import { useWorkspaceHref } from '@/hooks/use-workspace-href';
import { AgentAvatar } from './agent-avatar';

// ── Message type styling ─────────────────────────────────────────────────────

const MESSAGE_TYPE_CONFIG: Record<
  MessageType,
  { icon: typeof MessageSquare; label: string; className: string }
> = {
  delegation: {
    icon: ArrowRightLeft,
    label: 'Delegation',
    className: 'bg-violet-500/10 text-violet-500 border-violet-500/20',
  },
  review: {
    icon: CheckCircle2,
    label: 'Review',
    className: 'bg-amber-500/10 text-amber-500 border-amber-500/20',
  },
  discussion: {
    icon: MessageSquare,
    label: 'Discussion',
    className: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
  },
};

// ── Single message ───────────────────────────────────────────────────────────

function MessageItem({ message }: { message: AgentMessage }) {
  const config = MESSAGE_TYPE_CONFIG[message.message_type];
  const Icon = config.icon;

  return (
    <div className="flex gap-2.5 py-2">
      <AgentAvatar agentId={message.from_agent} name={message.from_agent_name} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-foreground text-xs font-medium">{message.from_agent_name}</span>
          {message.to_agent_name && (
            <>
              <ArrowRightLeft className="text-foreground-lighter h-2.5 w-2.5" />
              <span className="text-foreground-lighter text-xs">{message.to_agent_name}</span>
            </>
          )}
          <Badge variant="outline" className={`text-[9px] leading-none ${config.className}`}>
            <Icon className="mr-0.5 h-2 w-2" />
            {config.label}
          </Badge>
          <span className="text-foreground-lighter text-[10px]">
            {formatRelativeTime(message.created_at)}
          </span>
        </div>
        <p className="text-foreground-light mt-0.5 text-xs leading-relaxed">{message.content}</p>
      </div>
    </div>
  );
}

// ── Thread card ──────────────────────────────────────────────────────────────

function ThreadCard({ thread }: { thread: MessageThread }) {
  const [expanded, setExpanded] = useState(false);
  const { workspaceHref } = useWorkspaceHref();
  const lastMessage = thread.messages[thread.messages.length - 1];

  return (
    <div className="border-border rounded-lg border">
      {/* Thread header */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="hover:bg-surface-100/50 flex w-full items-center gap-3 px-4 py-3 text-left transition-colors"
      >
        {/* Participant avatars (stacked) */}
        <div className="flex -space-x-1.5">
          {thread.participants.slice(0, 3).map((agentId) => (
            <AgentAvatar key={agentId} agentId={agentId} name={agentId} />
          ))}
          {thread.participants.length > 3 && (
            <div className="bg-surface-200 border-border flex h-6 w-6 items-center justify-center rounded-full border text-[10px]">
              +{thread.participants.length - 3}
            </div>
          )}
        </div>

        {/* Thread info */}
        <div className="min-w-0 flex-1">
          <p className="text-foreground truncate text-sm font-medium">{thread.title}</p>
          <div className="text-foreground-lighter flex items-center gap-2 text-xs">
            <Users className="h-3 w-3" />
            <span>{thread.participants.length} agents</span>
            <span>·</span>
            <span>{thread.messages.length} messages</span>
            <span>·</span>
            <span>{formatRelativeTime(lastMessage.created_at)}</span>
          </div>
        </div>

        <ChevronRight
          className={`text-foreground-lighter h-4 w-4 shrink-0 transition-transform duration-200 ${
            expanded ? 'rotate-90' : ''
          }`}
        />
      </button>

      {/* Expandable messages */}
      <div
        className="grid"
        style={{
          gridTemplateRows: expanded ? '1fr' : '0fr',
          transition: 'grid-template-rows 200ms ease',
        }}
      >
        <div className="overflow-hidden">
          <div className="border-border border-t px-4 pb-3">
            {thread.messages.map((msg) => (
              <MessageItem key={msg.id} message={msg} />
            ))}
            {thread.task_id && (
              <Link
                href={workspaceHref(`/tasks?id=${thread.task_id}`)}
                className="text-brand hover:text-brand/80 mt-1 inline-block text-xs"
              >
                View task →
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export function AgentMessages() {
  const { activeWorkspace } = useWorkspace();
  const [threads, setThreads] = useState<MessageThread[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchThreads = useCallback(async () => {
    if (!activeWorkspace?.id) return;
    try {
      const result = await fetchJson<MessageThreadResponse>(
        `/api/agents/messages?workspace_id=${activeWorkspace.id}&limit=20`,
      );
      setThreads(result.threads);
    } catch {
      // Non-critical
    } finally {
      setLoading(false);
    }
  }, [activeWorkspace?.id]);

  useEffect(() => {
    fetchThreads();
  }, [fetchThreads]);

  // No auto-refresh — data refreshes on tab switch

  if (loading) {
    return (
      <div className="flex min-h-[320px] items-center justify-center">
        <Loader2 className="text-foreground-lighter h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (threads.length === 0) {
    return (
      <div className="flex min-h-[320px] flex-col items-center justify-center text-center">
        <div className="bg-surface-200 mb-4 flex h-12 w-12 items-center justify-center rounded-full">
          <MessageSquare className="text-foreground-muted h-6 w-6" />
        </div>
        <h3 className="text-foreground text-sm font-medium">No messages yet</h3>
        <p className="text-foreground-lighter mt-1 max-w-xs text-xs">
          Inter-agent messages will appear here during delegations, reviews, and discussions.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-foreground-lighter text-sm">
        Conversations between agents during delegations, code reviews, and collaborative work.
      </p>
      {threads.map((thread) => (
        <ThreadCard key={thread.id} thread={thread} />
      ))}
    </div>
  );
}
