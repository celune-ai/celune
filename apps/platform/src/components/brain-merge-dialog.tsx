'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Check,
  AlertTriangle,
  Plus,
  FileText,
  Loader2,
} from 'lucide-react';
import { Badge } from '@repo/ui/components/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@repo/ui/components/dialog';
import { fetchJson } from '@/lib/fetch-json';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ConflictSection {
  key: string;
  heading: string;
  local_preview: string;
  new_preview: string;
}

interface AddedSection {
  key: string;
  heading: string;
  preview: string;
}

interface MergePreviewResponse {
  status: 'merge_available' | 'no_merge_needed';
  path: string;
  current_version: string;
  new_version: string;
  sections: {
    unchanged: Array<{ key: string; heading: string }>;
    conflicts: ConflictSection[];
    added: AddedSection[];
    local_only: Array<{ key: string; heading: string }>;
  };
}

type ResolutionChoice = 'keep-local' | 'accept-new' | 'custom';

interface Resolution {
  section_key: string;
  choice: ResolutionChoice;
  custom_content?: string;
}

interface BrainMergeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  path: string;
  updateSummary?: string | null;
  onMergeComplete: () => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PREVIEW_LINE_LIMIT = 10;

// ---------------------------------------------------------------------------
// Preview Block — truncated with "Show more"
// ---------------------------------------------------------------------------

function PreviewBlock({ content, className }: { content: string; className?: string }) {
  const [expanded, setExpanded] = useState(false);
  const lines = content.split('\n');
  const truncated = lines.length > PREVIEW_LINE_LIMIT;
  const displayContent = expanded ? content : lines.slice(0, PREVIEW_LINE_LIMIT).join('\n');

  return (
    <div className={className}>
      <pre className="text-foreground-lighter overflow-x-auto font-mono text-xs leading-relaxed whitespace-pre-wrap">
        {displayContent}
        {truncated && !expanded && '\n...'}
      </pre>
      {truncated && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="text-brand mt-1 text-xs font-medium hover:underline"
        >
          {expanded ? 'Show less' : `Show all ${lines.length} lines`}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Collapsible Section
// ---------------------------------------------------------------------------

function CollapsibleSection({
  title,
  badge,
  count,
  defaultOpen = false,
  children,
}: {
  title: string;
  badge: React.ReactNode;
  count: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  if (count === 0) return null;

  return (
    <div className="border-border rounded-lg border">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="hover:bg-surface-100 flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left transition-colors"
      >
        {open ? (
          <ChevronDown className="text-foreground-lighter h-3.5 w-3.5 shrink-0" />
        ) : (
          <ChevronRight className="text-foreground-lighter h-3.5 w-3.5 shrink-0" />
        )}
        <span className="text-foreground text-sm font-medium">{title}</span>
        {badge}
        <span className="text-foreground-muted ml-auto text-xs tabular-nums">{count}</span>
      </button>
      {open && <div className="border-border space-y-2 border-t px-3 py-3">{children}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Conflict Resolution Card
// ---------------------------------------------------------------------------

function ConflictCard({
  conflict,
  resolution,
  onResolve,
  isFocused,
}: {
  conflict: ConflictSection;
  resolution: Resolution | undefined;
  onResolve: (resolution: Resolution) => void;
  isFocused?: boolean;
}) {
  const [customContent, setCustomContent] = useState(conflict.local_preview);
  const choice = resolution?.choice;

  function handleChoice(c: ResolutionChoice) {
    if (c === 'custom') {
      onResolve({ section_key: conflict.key, choice: 'custom', custom_content: customContent });
    } else {
      onResolve({ section_key: conflict.key, choice: c });
    }
  }

  return (
    <div
      className={`border-border bg-surface-75 space-y-3 rounded-lg border p-3 ${isFocused ? 'ring-brand/50 ring-2' : ''}`}
    >
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-[#F37E7A]" />
        <span className="text-foreground text-xs font-medium">
          {conflict.heading || conflict.key}
        </span>
        {conflict.heading && (
          <span className="text-foreground-muted font-mono text-xs">{conflict.key}</span>
        )}
      </div>

      {/* Side-by-side on desktop, stacked on mobile */}
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        <div>
          <p className="text-foreground-muted mb-1 text-xs font-medium tracking-wider uppercase">
            Your Version
          </p>
          <div
            className={`border-border bg-surface-200 rounded-md border p-2 ${choice === 'keep-local' ? 'ring-brand ring-2' : ''}`}
          >
            <PreviewBlock content={conflict.local_preview} />
          </div>
        </div>
        <div>
          <p className="text-foreground-muted mb-1 text-xs font-medium tracking-wider uppercase">
            New Version
          </p>
          <div
            className={`border-border bg-surface-200 rounded-md border p-2 ${choice === 'accept-new' ? 'ring-brand ring-2' : ''}`}
          >
            <PreviewBlock content={conflict.new_preview} />
          </div>
        </div>
      </div>

      {/* Choice buttons */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => handleChoice('keep-local')}
          className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
            choice === 'keep-local'
              ? 'border-brand bg-brand/10 text-brand'
              : 'border-border text-foreground-lighter hover:border-border-strong hover:text-foreground'
          }`}
        >
          {choice === 'keep-local' && <Check className="h-3 w-3" />}
          Keep Mine
        </button>
        <button
          type="button"
          onClick={() => handleChoice('accept-new')}
          className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
            choice === 'accept-new'
              ? 'border-brand bg-brand/10 text-brand'
              : 'border-border text-foreground-lighter hover:border-border-strong hover:text-foreground'
          }`}
        >
          {choice === 'accept-new' && <Check className="h-3 w-3" />}
          Accept Update
        </button>
        <button
          type="button"
          onClick={() => handleChoice('custom')}
          className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
            choice === 'custom'
              ? 'border-brand bg-brand/10 text-brand'
              : 'border-border text-foreground-lighter hover:border-border-strong hover:text-foreground'
          }`}
        >
          {choice === 'custom' && <Check className="h-3 w-3" />}
          Edit Custom
        </button>
      </div>

      {/* Custom editor */}
      {choice === 'custom' && (
        <div>
          <textarea
            value={customContent}
            onChange={(e) => {
              setCustomContent(e.target.value);
              onResolve({
                section_key: conflict.key,
                choice: 'custom',
                custom_content: e.target.value,
              });
            }}
            rows={8}
            className="border-border bg-surface-200 text-foreground placeholder:text-foreground-muted focus:border-brand w-full rounded-md border p-2 font-mono text-xs leading-relaxed outline-none"
          />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Dialog
// ---------------------------------------------------------------------------

export function BrainMergeDialog({
  open,
  onOpenChange,
  workspaceId,
  path,
  updateSummary,
  onMergeComplete,
}: BrainMergeDialogProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<MergePreviewResponse | null>(null);
  const [resolutions, setResolutions] = useState<Map<string, Resolution>>(new Map());
  const [applying, setApplying] = useState(false);
  const [focusedConflict, setFocusedConflict] = useState(0);

  const fetchPreview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchJson<MergePreviewResponse>('/api/brain/merge-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace_id: workspaceId, path }),
      });
      setPreview(result);
      setResolutions(new Map());
    } catch {
      setError('Failed to load merge preview. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [workspaceId, path]);

  useEffect(() => {
    if (open) {
      void fetchPreview();
      setFocusedConflict(0);
    }
  }, [open, fetchPreview]);

  const conflictCount = preview?.sections.conflicts.length ?? 0;

  function handleResolve(resolution: Resolution) {
    setResolutions((prev) => {
      const next = new Map(prev);
      next.set(resolution.section_key, resolution);
      return next;
    });
  }

  // Keyboard shortcuts: J/K navigate conflicts, 1/2/3 resolve
  useEffect(() => {
    if (!open || !preview || conflictCount === 0) return;
    function onKeyDown(e: KeyboardEvent) {
      // Skip when typing in a textarea
      if ((e.target as HTMLElement)?.tagName === 'TEXTAREA') return;
      const conflicts = preview!.sections.conflicts;
      switch (e.key) {
        case 'j':
          e.preventDefault();
          setFocusedConflict((i) => Math.min(i + 1, conflicts.length - 1));
          break;
        case 'k':
          e.preventDefault();
          setFocusedConflict((i) => Math.max(i - 1, 0));
          break;
        case '1':
          e.preventDefault();
          handleResolve({ section_key: conflicts[focusedConflict].key, choice: 'keep-local' });
          break;
        case '2':
          e.preventDefault();
          handleResolve({ section_key: conflicts[focusedConflict].key, choice: 'accept-new' });
          break;
        case '3':
          e.preventDefault();
          handleResolve({ section_key: conflicts[focusedConflict].key, choice: 'custom' });
          break;
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, preview, conflictCount, focusedConflict]);
  const allConflictsResolved = conflictCount > 0 && resolutions.size >= conflictCount;
  const canApply =
    preview?.status === 'merge_available' && (conflictCount === 0 || allConflictsResolved);

  async function handleApply() {
    if (!preview) return;
    setApplying(true);
    setError(null);
    try {
      await fetchJson('/api/brain/merge-resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: workspaceId,
          path,
          resolutions: Array.from(resolutions.values()),
        }),
      });
      onMergeComplete();
      onOpenChange(false);
    } catch {
      setError('Failed to apply merge. Please try again.');
    } finally {
      setApplying(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-foreground">Resolve Updates</DialogTitle>
          <DialogDescription>Merge upstream changes into your forked file.</DialogDescription>
        </DialogHeader>

        {/* File path + versions */}
        {preview && (
          <div className="border-border bg-surface-100 flex flex-wrap items-center gap-2 rounded-md border px-3 py-2">
            <FileText className="text-foreground-lighter h-3.5 w-3.5 shrink-0" />
            <span className="text-foreground truncate font-mono text-xs">{preview.path}</span>
            <span className="text-foreground-muted text-xs">
              v{preview.current_version} &rarr; v{preview.new_version}
            </span>
          </div>
        )}

        {/* Update summary helper */}
        {updateSummary && (
          <div className="border-border bg-surface-100 rounded-md border p-3">
            <p className="text-foreground-muted mb-1 text-xs font-medium">What changed</p>
            <p className="text-foreground-lighter text-xs leading-relaxed">{updateSummary}</p>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="text-foreground-lighter h-6 w-6 animate-spin" />
          </div>
        )}

        {/* Error */}
        {error && (
          <div
            className="border-destructive/30 bg-destructive/5 rounded-lg border px-4 py-3"
            role="alert"
          >
            <p className="text-destructive text-sm">{error}</p>
          </div>
        )}

        {/* No merge needed */}
        {!loading && preview?.status === 'no_merge_needed' && (
          <div className="py-8 text-center">
            <Check className="text-brand mx-auto h-8 w-8" />
            <p className="text-foreground mt-2 text-sm font-medium">Already up to date</p>
            <p className="text-foreground-lighter mt-1 text-xs">No merge needed for this file.</p>
          </div>
        )}

        {/* Merge sections */}
        {!loading && preview?.status === 'merge_available' && (
          <div className="space-y-3">
            {/* Conflicts — open by default, most important */}
            <CollapsibleSection
              title="Conflicts"
              badge={
                <Badge variant="coral" size="sm">
                  Needs Resolution
                </Badge>
              }
              count={preview.sections.conflicts.length}
              defaultOpen
            >
              {preview.sections.conflicts.map((conflict, idx) => (
                <ConflictCard
                  key={conflict.key}
                  conflict={conflict}
                  resolution={resolutions.get(conflict.key)}
                  onResolve={handleResolve}
                  isFocused={idx === focusedConflict}
                />
              ))}
            </CollapsibleSection>

            {/* Added sections */}
            <CollapsibleSection
              title="Added"
              badge={
                <Badge variant="blue" size="sm">
                  New
                </Badge>
              }
              count={preview.sections.added.length}
              defaultOpen
            >
              {preview.sections.added.map((added) => (
                <div key={added.key} className="border-border bg-surface-75 rounded-lg border p-3">
                  <div className="flex items-center gap-2">
                    <Plus className="h-3.5 w-3.5 shrink-0 text-[#7B9FFB]" />
                    <span className="text-foreground text-xs font-medium">
                      {added.heading || added.key}
                    </span>
                    {added.heading && (
                      <span className="text-foreground-muted font-mono text-xs">{added.key}</span>
                    )}
                  </div>
                  <div className="border-border bg-surface-200 mt-2 rounded-md border p-2">
                    <PreviewBlock content={added.preview} />
                  </div>
                </div>
              ))}
            </CollapsibleSection>

            {/* Auto-merged / local only */}
            <CollapsibleSection
              title="Local Only"
              badge={
                <Badge variant="outline" size="sm">
                  Preserved
                </Badge>
              }
              count={preview.sections.local_only.length}
            >
              {preview.sections.local_only.map((section) => (
                <div
                  key={section.key}
                  className="text-foreground-lighter flex items-center gap-2 px-1 py-0.5 text-xs"
                >
                  <FileText className="h-3 w-3 shrink-0" />
                  <span>{section.heading || section.key}</span>
                  {section.heading && (
                    <span className="text-foreground-muted font-mono">{section.key}</span>
                  )}
                </div>
              ))}
            </CollapsibleSection>

            {/* Unchanged — collapsed, count only */}
            <CollapsibleSection
              title="Unchanged"
              badge={
                <Badge variant="emerald-dark" size="sm">
                  OK
                </Badge>
              }
              count={preview.sections.unchanged.length}
            >
              {preview.sections.unchanged.map((section) => (
                <div
                  key={section.key}
                  className="text-foreground-lighter flex items-center gap-2 px-1 py-0.5 text-xs"
                >
                  <Check className="h-3 w-3 shrink-0 text-[#51BD7C]" />
                  <span>{section.heading || section.key}</span>
                  {section.heading && (
                    <span className="text-foreground-muted font-mono">{section.key}</span>
                  )}
                </div>
              ))}
            </CollapsibleSection>
          </div>
        )}

        {/* Keyboard hint */}
        {!loading && conflictCount > 0 && (
          <p className="text-foreground-muted text-xs">
            <kbd className="border-border bg-surface-200 rounded border px-1 py-0.5 font-mono text-[10px]">
              J
            </kbd>
            /
            <kbd className="border-border bg-surface-200 rounded border px-1 py-0.5 font-mono text-[10px]">
              K
            </kbd>{' '}
            navigate &middot;{' '}
            <kbd className="border-border bg-surface-200 rounded border px-1 py-0.5 font-mono text-[10px]">
              1
            </kbd>
            /
            <kbd className="border-border bg-surface-200 rounded border px-1 py-0.5 font-mono text-[10px]">
              2
            </kbd>
            /
            <kbd className="border-border bg-surface-200 rounded border px-1 py-0.5 font-mono text-[10px]">
              3
            </kbd>{' '}
            resolve
          </p>
        )}

        {/* Footer with Apply button */}
        {!loading && preview?.status === 'merge_available' && (
          <DialogFooter>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="border-border text-foreground-lighter hover:text-foreground hover:border-border-strong rounded-lg border px-4 py-2 text-sm font-medium transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleApply}
              disabled={!canApply || applying}
              className="bg-brand hover:bg-brand/80 flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-bold text-[#161616] transition-colors disabled:opacity-50"
            >
              {applying ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Applying...
                </>
              ) : conflictCount > 0 && !allConflictsResolved ? (
                `Resolve ${conflictCount - resolutions.size} Conflict${conflictCount - resolutions.size !== 1 ? 's' : ''} to Continue`
              ) : (
                'Apply Merge'
              )}
            </button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
