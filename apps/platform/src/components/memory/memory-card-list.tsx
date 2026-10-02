'use client';

import { Brain } from 'lucide-react';
import type { AgentMemory, MemoryCategory } from '@repo/types';
import { MemoryCard } from './memory-card';

// ---------------------------------------------------------------------------
// MemoryCardList
// ---------------------------------------------------------------------------

export interface MemoryCardListProps {
  memories: AgentMemory[];
  onDelete: (id: string) => void;
  onUpdate: (id: string, patch: { content: string; category: MemoryCategory }) => void;
  onRead: (id: string) => void;
  loadingMore?: boolean;
}

export function MemoryCardList({
  memories,
  onDelete,
  onUpdate,
  onRead,
  loadingMore,
}: MemoryCardListProps) {
  if (memories.length === 0) {
    return (
      <div className="border-border rounded-lg border border-dashed p-12 text-center">
        <Brain className="text-foreground-muted mx-auto h-10 w-10" />
        <h2 className="text-foreground mt-4 text-base font-medium">No memories found</h2>
        <p className="text-foreground-lighter mt-1 text-sm">
          Try adjusting your filters or search query.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {memories.map((memory) => (
          <MemoryCard
            key={memory.id}
            memory={memory}
            onDelete={onDelete}
            onUpdate={onUpdate}
            onRead={onRead}
          />
        ))}
      </div>

      {loadingMore && (
        <div className="mt-4 flex justify-center">
          <div className="text-foreground-lighter flex items-center gap-2 text-sm">
            <div className="border-brand h-4 w-4 animate-spin rounded-full border-2 border-t-transparent" />
            Loading more memories...
          </div>
        </div>
      )}
    </div>
  );
}
