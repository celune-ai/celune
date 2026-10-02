'use client';

import { useState } from 'react';
import { ChevronRight, Brain } from 'lucide-react';

interface ReasoningBlockProps {
  reasoning: string;
  agentName?: string;
}

export function ReasoningBlock({ reasoning, agentName }: ReasoningBlockProps) {
  const [expanded, setExpanded] = useState(false);

  const wordCount = reasoning.split(/\s+/).length;
  const lengthLabel = wordCount < 30 ? 'brief' : wordCount < 100 ? 'detailed' : 'extensive';

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className="bg-surface-100 border-border hover:bg-surface-200 flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors"
      >
        <Brain className="text-foreground-lighter h-3 w-3" />
        <span className="text-foreground-lighter">
          {expanded ? 'Hide' : 'View'} reasoning
          <span className="text-foreground-lighter/60 ml-1">({lengthLabel})</span>
        </span>
        <ChevronRight
          className={`text-foreground-lighter h-3 w-3 transition-transform duration-200 ${
            expanded ? 'rotate-90' : ''
          }`}
        />
      </button>

      <div
        className="grid"
        style={{
          gridTemplateRows: expanded ? '1fr' : '0fr',
          transition: 'grid-template-rows 200ms ease',
        }}
      >
        <div className="overflow-hidden">
          <div className="border-border/60 bg-surface-75 mt-2 rounded-md border-l-2 py-2 pr-3 pl-3">
            <p className="text-foreground-light text-xs leading-relaxed whitespace-pre-wrap">
              {reasoning}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
