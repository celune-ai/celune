'use client';

import { lazy, Suspense } from 'react';
import { Textarea } from '@repo/ui/components/textarea';
import remarkGfm from 'remark-gfm';
import { MarkdownLink } from '@celuneai/react/utils';

const ReactMarkdown = lazy(() => import('react-markdown'));

interface PrdDrawerBodyProps {
  content: string;
  onContentChange: (v: string) => void;
  editing: boolean;
  onEditingChange: (v: boolean) => void;
  /** Short label like "PRD" or "Brief" for placeholder text */
  docShort?: string;
}

export function PrdDrawerBody({
  content,
  onContentChange,
  editing,
  onEditingChange,
  docShort = 'PRD',
}: PrdDrawerBodyProps) {
  return (
    <div className="flex flex-1 flex-col px-5" style={editing ? { minHeight: 0 } : undefined}>
      {editing ? (
        <Textarea
          value={content}
          onChange={(e) => onContentChange(e.target.value)}
          placeholder={`Write your ${docShort} in markdown...`}
          className="flex-1 resize-none font-mono text-sm"
          style={{ minHeight: 400 }}
          autoFocus
        />
      ) : (
        <div
          role="button"
          tabIndex={0}
          aria-label={`Edit ${docShort} content`}
          onClick={() => onEditingChange(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onEditingChange(true);
            }
          }}
          className="min-h-[200px] cursor-text rounded-md px-1 py-0.5"
        >
          {content ? (
            <div className="prose prose-invert prose-sm max-w-none">
              <Suspense
                fallback={
                  <div className="text-muted-foreground animate-pulse text-sm">Loading...</div>
                }
              >
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: MarkdownLink }}>
                  {content}
                </ReactMarkdown>
              </Suspense>
            </div>
          ) : (
            <span className="text-muted-foreground text-sm">
              Click to add {docShort} content...
            </span>
          )}
        </div>
      )}
    </div>
  );
}
