'use client';

import { useState, useEffect, useRef } from 'react';
import { Trash2, Pencil, Check, X, MoreHorizontal } from 'lucide-react';
import { fetchJson } from '@/lib/fetch-json';
import type { AgentMemory, MemoryCategory } from '@repo/types';
import { MEMORY_CATEGORIES } from '@repo/types';

// ---------------------------------------------------------------------------
// Format date
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
// Generate a short summary title from the memory key
// ---------------------------------------------------------------------------

/** Capitalize a single word, handling common abbreviations. */
function capitalize(word: string): string {
  const upper: Record<string, string> = {
    pr: 'PR',
    prd: 'PRD',
    qa: 'QA',
    ci: 'CI',
    mcp: 'MCP',
    tts: 'TTS',
    byok: 'BYOK',
    api: 'API',
    ui: 'UI',
    ux: 'UX',
    rls: 'RLS',
    sql: 'SQL',
    css: 'CSS',
    dx: 'DX',
    seo: 'SEO',
  };
  const low = word.toLowerCase();
  return upper[low] ?? low.charAt(0).toUpperCase() + low.slice(1);
}

/** Turn a structured key like "workflow:task-lifecycle" into "Task Lifecycle". */
export function summarizeTitle(memory: AgentMemory): string {
  const key = memory.key || '';

  if (key) {
    // Skip keys that are just IDs or timestamps (e.g., "mcp_1773721706222", "mem-abc123")
    const isDescriptiveKey = /[a-z]{3,}.*[:\-_].*[a-z]{3,}/i.test(key) && !/\d{8,}/.test(key);

    if (isDescriptiveKey) {
      // Split on namespace separators: "agent:lead:coding-philosophy" → ["agent","lead","coding-philosophy"]
      const segments = key.split(':').filter(Boolean);

      // Drop generic namespace prefixes to get the descriptive part
      const skipPrefixes = new Set(['workflow', 'getting-started', 'agent', 'core']);
      const meaningful = segments.filter((s) => !skipPrefixes.has(s));
      const target = meaningful.length > 0 ? meaningful : segments;

      // Take the last 1-2 meaningful segments and humanize
      const tail = target.slice(-2);
      const title = tail
        .flatMap((seg) => seg.split(/[-_]/))
        .map(capitalize)
        .join(' ');

      if (title.length > 0) return title;
    }
  }

  // Fallback: extract a short topic label from content
  const content = memory.content.trim();

  // Pattern 1: "Label: description..." → use the label as title
  const colonMatch = content.match(/^([A-Za-z][A-Za-z\s]{2,30}):/);
  if (colonMatch) {
    return colonMatch[1].trim().split(/\s+/).map(capitalize).join(' ');
  }

  // Pattern 2: First line is short enough to be a title (<40 chars)
  const firstLine = content.split(/\n/)[0]?.trim() || '';
  if (firstLine.length > 0 && firstLine.length <= 40) {
    return firstLine.replace(/[.!,;:]+$/, '');
  }

  // Pattern 3: Grab first 3-4 words as a topic label
  if (firstLine) {
    const words = firstLine.split(/\s+/).slice(0, 4).join(' ');
    return words.replace(/[.!,;:]+$/, '');
  }

  return 'Untitled Memory';
}

// ---------------------------------------------------------------------------
// MemoryCard
// ---------------------------------------------------------------------------

export interface MemoryCardProps {
  memory: AgentMemory;
  onDelete: (id: string) => void;
  onUpdate: (id: string, patch: { content: string; category: MemoryCategory }) => void;
  onRead: (id: string) => void;
}

export function MemoryCard({ memory, onDelete, onUpdate, onRead }: MemoryCardProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(memory.content);
  const [draftCategory, setDraftCategory] = useState<MemoryCategory>(memory.category);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const isReadOnly = memory.source === 'system' || memory.is_core;

  const title = summarizeTitle(memory);

  useEffect(() => {
    if (editing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.selectionStart = textareaRef.current.value.length;
    }
  }, [editing]);

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
        setConfirmDelete(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [menuOpen]);

  async function handleSave() {
    if (!draft.trim()) return;
    setSaving(true);
    try {
      await fetchJson(`/api/memory/entries/${memory.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: draft.trim(),
          category: draftCategory,
        }),
      });
      onUpdate(memory.id, { content: draft.trim(), category: draftCategory });
      setEditing(false);
    } catch {
      // keep editing open on error
    } finally {
      setSaving(false);
    }
  }

  function handleCancelEdit() {
    setDraft(memory.content);
    setDraftCategory(memory.category);
    setEditing(false);
  }

  async function handleDelete() {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setDeleting(true);
    try {
      await fetchJson(`/api/memory/entries/${memory.id}`, { method: 'DELETE' });
      onDelete(memory.id);
    } catch {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => !editing && onRead(memory.id)}
      onKeyDown={(e) => {
        if (!editing && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onRead(memory.id);
        }
      }}
      className="border-border bg-surface-75 hover:bg-surface-100 hover:border-border-strong cursor-pointer rounded-xl border p-5 transition-all duration-150"
    >
      {/* Eyebrow: core/new tag + date */}
      <div className="mb-1.5 flex items-center gap-2">
        {memory.is_core || memory.source === 'brain-seed' ? (
          <span className="bg-surface-300 text-foreground-lighter inline-flex items-center rounded-full px-1.5 py-px text-[10px] font-medium">
            Core
          </span>
        ) : (
          <span className="inline-flex items-center rounded-full bg-emerald-500/15 px-1.5 py-px text-[10px] font-medium text-emerald-400">
            New
          </span>
        )}
        <span className="text-foreground-muted text-[10px]">{formatDate(memory.updated_at)}</span>
      </div>

      {/* Header: title + actions */}
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-foreground min-w-0 truncate text-base leading-snug font-semibold">
          {title}
        </h3>

        {/* Actions menu */}
        <div
          className="relative flex shrink-0 items-center gap-1"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          {editing ? (
            <>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving || !draft.trim()}
                className="text-foreground-lighter hover:text-brand hover:bg-brand/10 inline-flex h-7 w-7 items-center justify-center rounded transition-colors disabled:opacity-40"
                title="Save"
                aria-label="Save changes"
              >
                <Check className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={handleCancelEdit}
                className="text-foreground-lighter hover:text-foreground hover:bg-surface-300 inline-flex h-7 w-7 items-center justify-center rounded transition-colors"
                title="Cancel"
                aria-label="Cancel editing"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </>
          ) : (
            !isReadOnly && (
              <div ref={menuRef}>
                <button
                  type="button"
                  onClick={() => setMenuOpen((prev) => !prev)}
                  className="text-foreground-lighter hover:text-foreground hover:bg-surface-300 inline-flex h-7 w-7 items-center justify-center rounded transition-colors"
                  title="More actions"
                  aria-label="More actions"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </button>
                {menuOpen && (
                  <div className="border-border bg-surface-100 absolute top-8 right-0 z-10 min-w-[120px] rounded-lg border py-1 shadow-lg">
                    <button
                      type="button"
                      onClick={() => {
                        setEditing(true);
                        setMenuOpen(false);
                      }}
                      className="text-foreground-lighter hover:bg-surface-200 hover:text-foreground flex w-full items-center gap-2 px-3 py-1.5 text-sm transition-colors"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={handleDelete}
                      disabled={deleting}
                      className={`flex w-full items-center gap-2 px-3 py-1.5 text-sm transition-colors disabled:opacity-40 ${
                        confirmDelete
                          ? 'text-destructive bg-destructive/5'
                          : 'text-foreground-lighter hover:bg-surface-200 hover:text-destructive'
                      }`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      {confirmDelete ? 'Confirm delete' : 'Delete'}
                    </button>
                  </div>
                )}
              </div>
            )
          )}
        </div>
      </div>

      {/* Content area */}
      {editing ? (
        <div className="mt-3 space-y-2" onClick={(e) => e.stopPropagation()}>
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={4}
            className="border-border bg-surface-200 text-foreground placeholder:text-foreground-lighter focus:border-border-strong focus:ring-brand w-full rounded-md border p-2 text-sm focus:ring-1 focus:outline-none"
          />
          <div className="flex items-center gap-2">
            <label className="text-foreground-lighter text-xs">Category:</label>
            <select
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
        </div>
      ) : (
        <p className="text-foreground-lighter mt-2 line-clamp-3 text-sm leading-relaxed">
          {memory.content}
        </p>
      )}
    </div>
  );
}
