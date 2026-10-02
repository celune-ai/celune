'use client';

import { useState, useEffect, lazy, Suspense } from 'react';
import * as AccordionPrimitive from '@radix-ui/react-accordion';
import { ChevronDown } from 'lucide-react';
import { Button } from '@repo/ui/components/button';
import { Textarea } from '@repo/ui/components/textarea';
import { cn } from '@repo/ui/utils';
import remarkGfm from 'remark-gfm';
import { MarkdownLink } from '../../components/markdown-link';

const ReactMarkdown = lazy(() => import('react-markdown'));

interface TaskDrawerMarkdownSectionProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  editing: boolean;
  onEditingChange: (v: boolean) => void;
  onSave?: () => void;
  placeholder?: string;
  defaultOpen?: boolean;
  canEdit?: boolean;
}

export function TaskDrawerMarkdownSection({
  label,
  value,
  onChange,
  editing,
  onEditingChange,
  onSave,
  placeholder = `Add ${label.toLowerCase()}...`,
  defaultOpen = true,
  canEdit = true,
}: TaskDrawerMarkdownSectionProps) {
  const itemValue = label.toLowerCase().replace(/\s+/g, '-');
  const [openItems, setOpenItems] = useState<string[]>(defaultOpen ? [itemValue] : []);

  // Auto-open when editing starts
  useEffect(() => {
    if (editing && !openItems.includes(itemValue)) {
      setOpenItems((prev) => [...prev, itemValue]);
    }
  }, [editing, itemValue]);

  return (
    <div
      className="flex flex-col px-5"
      style={editing ? { flex: '1 1 0%', minHeight: 0 } : undefined}
    >
      <div className="my-6 border-t border-(--celune-border)" />
      <AccordionPrimitive.Root type="multiple" value={openItems} onValueChange={setOpenItems}>
        <AccordionPrimitive.Item value={itemValue} className="border-none">
          <AccordionPrimitive.Header className="flex items-center">
            <AccordionPrimitive.Trigger
              className={cn(
                'flex flex-1 items-center gap-1.5 py-0 text-left',
                '[&[data-state=open]>svg]:rotate-180',
              )}
            >
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-(--celune-fg-muted) transition-transform duration-200" />
              <p
                className="text-xs font-(weight:--celune-font-weight-strong) tracking-wide uppercase"
                style={{ color: 'var(--celune-fg-muted)' }}
              >
                {label}
              </p>
            </AccordionPrimitive.Trigger>
            {/* Edit button outside trigger — doesn't toggle accordion */}
            {(editing || (canEdit && value)) && (
              <Button
                variant="outline"
                size="md"
                onClick={() => {
                  if (editing) {
                    onSave?.();
                  }
                  onEditingChange(!editing);
                }}
              >
                {editing ? 'Save' : 'Edit'}
              </Button>
            )}
          </AccordionPrimitive.Header>
          <AccordionPrimitive.Content className="data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down overflow-hidden text-sm">
            <div className="pt-3 pb-1">
              {editing ? (
                <Textarea
                  value={value}
                  onChange={(e) => onChange(e.target.value)}
                  placeholder={placeholder}
                  className="flex-1 resize-none text-sm"
                  style={{ minHeight: 200 }}
                  autoFocus
                />
              ) : (
                <div className="min-h-[60px] rounded-md px-1 py-0.5">
                  {value ? (
                    <div className="prose prose-invert prose-sm max-w-none">
                      <Suspense
                        fallback={
                          <div className="animate-pulse text-sm text-(--celune-fg-muted) motion-reduce:animate-none">
                            Loading...
                          </div>
                        }
                      >
                        <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: MarkdownLink }}>
                          {value}
                        </ReactMarkdown>
                      </Suspense>
                    </div>
                  ) : (
                    <span className="text-sm text-(--celune-fg-muted) italic">{placeholder}</span>
                  )}
                </div>
              )}
            </div>
          </AccordionPrimitive.Content>
        </AccordionPrimitive.Item>
      </AccordionPrimitive.Root>
    </div>
  );
}
