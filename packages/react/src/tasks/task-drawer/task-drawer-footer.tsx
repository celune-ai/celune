'use client';

import { useState } from 'react';
import { MessageSquarePlus, Terminal, Check } from 'lucide-react';
import { Button } from '@repo/ui/components/button';
import { Textarea } from '@repo/ui/components/textarea';
import { toast } from 'sonner';
import { useCelune } from '../../provider/context';
import type { Task, TaskComment } from './types';

interface TaskDrawerFooterProps {
  taskId: string | null;
  task: Task | null;
  currentUser: string;
  deleting: boolean;
  confirmDelete: boolean;
  onDelete: () => void;
  onCancelDelete: () => void;
  onCommentAdded: (comment: TaskComment) => void;
  canEdit?: boolean;
}

export function TaskDrawerFooter({
  taskId,
  task,
  currentUser,
  deleting,
  confirmDelete,
  onDelete,
  onCancelDelete,
  onCommentAdded,
  canEdit = true,
}: TaskDrawerFooterProps) {
  const { transport } = useCelune();
  const [showComment, setShowComment] = useState(false);
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopyPrompt = () => {
    if (!task) return;
    const lines = [
      `Task: ${task.title}`,
      `ID: ${task.id}`,
      `Priority: ${task.priority}`,
      `Status: ${task.status}`,
      task.assignee ? `Assignee: ${task.assignee}` : null,
      task.project_id ? `Project: ${task.project_id}` : null,
      '',
      task.description ?? '',
    ].filter((l): l is string => l !== null);
    navigator.clipboard.writeText(lines.join('\n'));
    setCopied(true);
    toast.success('Task prompt copied to clipboard');
    setTimeout(() => setCopied(false), 2000);
  };

  const hasContent = content.trim().length > 0;

  const handleSubmit = async () => {
    if (!taskId || !hasContent || submitting) return;
    setSubmitting(true);
    try {
      const comment: TaskComment = await transport.comments.create(taskId, {
        author: currentUser,
        content: content.trim(),
        workspaceId: task?.workspace_id ?? undefined,
      });
      onCommentAdded(comment);
      setContent('');
      setShowComment(false);
    } catch (err) {
      console.error('Failed to post comment:', err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="shrink-0">
      {/* Comment input panel — own container with border-t + background */}
      {taskId && showComment && (
        <div className="space-y-3 border-t border-(--celune-border) bg-(--celune-bg) px-5 py-4">
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Add a comment..."
            className="min-h-[72px] resize-none text-sm"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                handleSubmit();
              }
              if (e.key === 'Escape') {
                setShowComment(false);
              }
            }}
          />
          <div className="flex justify-end">
            <Button
              size="md"
              className="h-9 text-sm font-(weight:--celune-font-weight-strong)"
              onClick={handleSubmit}
              disabled={submitting || !hasContent}
            >
              {submitting ? 'Submitting...' : 'Submit'}
            </Button>
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center border-t border-(--celune-border) px-5 py-5">
        <div className="flex items-center gap-2">
          {canEdit && confirmDelete ? (
            <>
              <span className="text-xs text-(--celune-fg-muted)">Sure?</span>
              <Button
                variant="ghost"
                size="md"
                className="h-9 text-sm font-(weight:--celune-font-weight-strong) text-(--celune-danger) hover:bg-(--celune-danger)/10 hover:text-(--celune-danger)"
                onClick={onDelete}
                disabled={deleting}
              >
                {deleting ? 'Deleting...' : 'Yes, delete'}
              </Button>
              <Button
                variant="ghost"
                size="md"
                className="h-9 text-sm font-(weight:--celune-font-weight-strong)"
                onClick={onCancelDelete}
              >
                Cancel
              </Button>
            </>
          ) : (
            <>
              {taskId && (
                <>
                  <Button
                    variant="outline"
                    size="md"
                    className="h-9 w-9 p-0"
                    onClick={handleCopyPrompt}
                    aria-label={copied ? 'Task prompt copied' : 'Copy task prompt for Claude Code'}
                    title="Copy task prompt for Claude Code"
                  >
                    {copied ? (
                      <Check className="h-4 w-4 text-(--celune-status-done)" />
                    ) : (
                      <Terminal className="h-4 w-4" />
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    size="md"
                    className="h-9 w-9 p-0"
                    onClick={() => setShowComment(!showComment)}
                    aria-label={showComment ? 'Hide comment' : 'Add comment'}
                    aria-expanded={showComment}
                    title={showComment ? 'Hide comment' : 'Add comment'}
                  >
                    <MessageSquarePlus className="h-4 w-4" />
                  </Button>
                </>
              )}
              {canEdit && (
                <Button
                  variant="ghost"
                  size="md"
                  className="h-9 text-sm font-(weight:--celune-font-weight-strong) text-(--celune-danger) hover:bg-(--celune-danger)/10 hover:text-(--celune-danger)"
                  onClick={onDelete}
                >
                  Delete
                </Button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
