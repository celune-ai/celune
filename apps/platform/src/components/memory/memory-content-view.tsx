'use client';

import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { Check, Lock, Pencil, Trash2, X } from 'lucide-react';
import remarkGfm from 'remark-gfm';
import { MarkdownLink } from '@celuneai/react/utils';

const ReactMarkdown = lazy(() => import('react-markdown'));
import { fetchJson } from '@/lib/fetch-json';
import type { AgentMemory, MemoryCategory } from '@repo/types';
import { MEMORY_CATEGORIES } from '@repo/types';
import { summarizeTitle } from '@/components/memory/memory-card';

// ---------------------------------------------------------------------------
// Format helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface MemoryContentViewProps {
  memory: AgentMemory;
  relatedMemories?: AgentMemory[];
  onBack: () => void;
  onDelete: (id: string) => void;
  onUpdate: (id: string, patch: { content: string; category: MemoryCategory }) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function MemoryContentView({
  memory,
  relatedMemories = [],
  onBack,
  onDelete,
  onUpdate,
}: MemoryContentViewProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(memory.content);
  const [draftCategory, setDraftCategory] = useState<MemoryCategory>(memory.category);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isReadOnly = memory.source === 'system' || memory.is_core;
  const title = summarizeTitle(memory);

  // Reset draft when memory changes
  useEffect(() => {
    setDraft(memory.content);
    setDraftCategory(memory.category);
    setEditing(false);
    setConfirmDelete(false);
  }, [memory.id, memory.content, memory.category]);

  // Focus textarea when entering edit mode
  useEffect(() => {
    if (editing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.selectionStart = textareaRef.current.value.length;
    }
  }, [editing]);

  function handleStartEdit() {
    setDraft(memory.content);
    setDraftCategory(memory.category);
    setEditing(true);
  }

  function handleCancelEdit() {
    setDraft(memory.content);
    setDraftCategory(memory.category);
    setEditing(false);
  }

  async function handleSave() {
    if (!draft.trim()) return;
    setSaving(true);
    try {
      await fetchJson(`/api/memory/entries/${memory.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: draft.trim(), category: draftCategory }),
      });
      onUpdate(memory.id, { content: draft.trim(), category: draftCategory });
      setEditing(false);
    } catch {
      // keep editing open on error
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    try {
      await fetchJson(`/api/memory/entries/${memory.id}`, { method: 'DELETE' });
      onDelete(memory.id);
    } catch {
      setConfirmDelete(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-6">
      {/* Title */}
      <h1 className="text-foreground mb-4 text-2xl font-bold">{title}</h1>

      {/* Content area */}
      {editing ? (
        <div className="mb-6 space-y-3">
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={Math.max(6, draft.split('\n').length + 2)}
            className="border-border bg-surface-200 text-foreground placeholder:text-foreground-lighter focus:border-border-strong focus:ring-brand w-full rounded-md border p-3 text-sm leading-relaxed focus:ring-1 focus:outline-none"
          />

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <label htmlFor="edit-category" className="text-foreground-lighter text-xs">
                Category:
              </label>
              <select
                id="edit-category"
                value={draftCategory}
                onChange={(e) => setDraftCategory(e.target.value as MemoryCategory)}
                className="border-border bg-surface-200 text-foreground rounded border px-2 py-1 text-xs"
              >
                {MEMORY_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={handleCancelEdit}
                className="text-foreground-lighter hover:text-foreground hover:bg-surface-300 inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors"
              >
                <X className="h-3.5 w-3.5" />
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving || !draft.trim()}
                className="bg-brand hover:bg-brand/90 inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-black transition-colors disabled:opacity-40"
              >
                <Check className="h-3.5 w-3.5" />
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="border-border bg-surface-75 mb-6 rounded-lg border p-5">
          <div className="prose prose-invert prose-sm max-w-none">
            <Suspense
              fallback={
                <p className="text-foreground text-sm leading-relaxed whitespace-pre-wrap">
                  {memory.content}
                </p>
              }
            >
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: MarkdownLink }}>
                {memory.content}
              </ReactMarkdown>
            </Suspense>
          </div>
        </div>
      )}

      {/* Action buttons */}
      {!isReadOnly && !editing && (
        <div className="mb-8 flex items-center gap-2">
          <button
            type="button"
            onClick={handleStartEdit}
            className="text-foreground-lighter hover:text-foreground hover:bg-surface-300 inline-flex items-center gap-1.5 rounded-md border border-transparent px-3 py-1.5 text-sm transition-colors"
          >
            <Pencil className="h-3.5 w-3.5" />
            Edit
          </button>
          <button
            type="button"
            onClick={handleDelete}
            onBlur={() => setConfirmDelete(false)}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors ${
              confirmDelete
                ? 'bg-destructive/10 text-destructive hover:bg-destructive/20 border-destructive/20 border'
                : 'text-foreground-lighter hover:text-destructive hover:bg-destructive/10 border border-transparent'
            }`}
          >
            <Trash2 className="h-3.5 w-3.5" />
            {confirmDelete ? 'Confirm delete' : 'Delete'}
          </button>
        </div>
      )}

      {isReadOnly && !editing && (
        <div className="mb-8">
          <p className="text-foreground-muted flex items-center gap-1 text-xs">
            <Lock className="h-3 w-3" />
            This memory is read-only and cannot be edited or deleted.
          </p>
        </div>
      )}

      {/* Related memories */}
      {relatedMemories.length > 0 && (
        <div>
          <h2 className="text-foreground mb-3 text-sm font-semibold">Related Memories</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {relatedMemories.slice(0, 5).map((related) => (
              <div
                key={related.id}
                className="border-border bg-surface-75 hover:bg-surface-100 rounded-lg border p-3 transition-colors"
              >
                <p className="text-foreground mb-1.5 text-sm font-medium">
                  {summarizeTitle(related)}
                </p>
                <p className="text-foreground-lighter line-clamp-2 text-xs leading-relaxed">
                  {related.content}
                </p>
                <span className="text-foreground-muted mt-1.5 block text-xs">
                  {formatDate(related.updated_at)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
