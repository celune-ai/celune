'use client';

import { useRef, useState } from 'react';
import { cn } from '@repo/ui/utils';
import type { TaskStatus } from '@repo/types';
import { Plus } from 'lucide-react';
import { useCelune } from '../provider/context';
import { type TableColumn, DEFAULT_COLUMNS, buildGridTemplate } from '../hooks/use-table-columns';
import { useElementClass } from '../provider/appearance';

interface AddTaskRowProps {
  status: TaskStatus;
  projectId?: string;
  columns?: TableColumn[];
  gridTemplate?: string;
}

export function AddTaskRow({
  status,
  projectId,
  columns = DEFAULT_COLUMNS,
  gridTemplate,
}: AddTaskRowProps) {
  const partClass = useElementClass('addTaskRow');
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { transport } = useCelune();
  const resolvedGrid = gridTemplate ?? buildGridTemplate(columns);

  const handleSubmit = async () => {
    const trimmed = title.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    try {
      await transport.tasks.create({
        title: trimmed,
        status,
        ...(projectId ? { project_id: projectId } : {}),
      });
      setTitle('');
      inputRef.current?.focus();
    } catch {
      // Row stays open with the typed title so the user can retry
    } finally {
      setSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    } else if (e.key === 'Escape') {
      setEditing(false);
      setTitle('');
    }
  };

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setEditing(true);
          setTimeout(() => inputRef.current?.focus(), 0);
        }}
        className="grid w-full cursor-pointer items-center text-sm font-(weight:--celune-font-weight-medium) transition-colors hover:bg-(--celune-surface)"
        style={{ gridTemplateColumns: resolvedGrid }}
      >
        <div className="py-4 pl-3" />
        <div className="flex items-center gap-2 py-4 pl-2.5 text-(--celune-fg-muted) opacity-60">
          <Plus className="h-3.5 w-3.5" />
          <span>Add task...</span>
        </div>
        {columns.slice(1).map((col) => (
          <div key={col.id} className="self-stretch py-4" />
        ))}
      </button>
    );
  }

  return (
    <div
      className={cn('grid items-center', 'bg-(--celune-surface)', partClass)}
      style={{ gridTemplateColumns: resolvedGrid }}
    >
      <div className="py-1.5 pl-3" />
      <div className="flex items-center gap-2 py-1.5 pl-2.5">
        <input
          ref={inputRef}
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => {
            if (!title.trim()) {
              setEditing(false);
              setTitle('');
            }
          }}
          placeholder="Task name..."
          disabled={submitting}
          className="w-full bg-transparent text-sm text-(--celune-fg) placeholder:text-(--celune-fg-muted) focus:outline-none"
          autoFocus
        />
      </div>
      {columns.slice(1).map((col) => (
        <div key={col.id} className="self-stretch py-1.5" />
      ))}
    </div>
  );
}
