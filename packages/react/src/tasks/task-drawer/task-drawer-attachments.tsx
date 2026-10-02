'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import * as AccordionPrimitive from '@radix-ui/react-accordion';
import { ChevronDown, CloudUpload, Loader2 } from 'lucide-react';
import { Badge } from '../../components/badge';
import { cn } from '@repo/ui/utils';
import { useCelune } from '../../provider/context';
import { reportUploadError } from './upload-errors';
import { toast } from 'sonner';
import { toastWithUndo } from '../../lib/toast-undo';
import type { TaskAttachment } from '@repo/types';
import { AttachmentCard } from './attachment-card';

const LABEL_COLOR = 'var(--celune-fg-muted)';

const ALLOWED_EXTENSIONS =
  '.png,.jpg,.jpeg,.gif,.webp,.svg,.pdf,.md,.txt,.json,.csv,.tsv,.ts,.tsx,.js,.jsx,.py,.sql,.yaml,.yml,.toml';

interface TaskDrawerAttachmentsProps {
  taskId: string;
  /** Attachments passed from parent (uploaded via drag-and-drop) */
  attachments: TaskAttachment[];
  onAttachmentsChange: (attachments: TaskAttachment[]) => void;
  defaultOpen?: boolean;
  uploadedBy?: string;
}

export function TaskDrawerAttachments({
  taskId,
  attachments,
  onAttachmentsChange,
  defaultOpen = false,
  uploadedBy = 'user',
}: TaskDrawerAttachmentsProps) {
  const { transport } = useCelune();
  const itemValue = 'attachments';
  const [openItems, setOpenItems] = useState<string[]>(defaultOpen ? [itemValue] : []);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-open when attachments arrive
  useEffect(() => {
    if (attachments.length > 0 && !openItems.includes(itemValue)) {
      setOpenItems([itemValue]);
    }
  }, [attachments.length]);

  const uploadFiles = useCallback(
    (files: FileList | File[]) => {
      const api = transport.attachments;
      if (!files.length || !api) return;
      setUploading(true);
      setUploadProgress(0);

      api
        .upload(taskId, Array.from(files), {
          uploadedBy,
          onProgress: (fraction) => setUploadProgress(Math.round(fraction * 100)),
        })
        .then((data) => {
          if (data.attachments.length) {
            onAttachmentsChange([...data.attachments, ...attachments]);
            toast.success(
              `Uploaded ${data.attachments.length} file${data.attachments.length > 1 ? 's' : ''}`,
            );
          }
          for (const e of data.errors) toast.error(`${e.file}: ${e.error}`);
        })
        .catch(reportUploadError)
        .finally(() => {
          setUploading(false);
          setUploadProgress(0);
          if (fileInputRef.current) fileInputRef.current.value = '';
        });
    },
    [taskId, attachments, onAttachmentsChange, transport, uploadedBy],
  );

  const handleDelete = useCallback(
    async (attachmentId: string) => {
      // Optimistic remove
      const prev = attachments;
      onAttachmentsChange(attachments.filter((a) => a.id !== attachmentId));

      toastWithUndo('Attachment deleted', {
        action: async () => {
          await transport.attachments?.remove(taskId, attachmentId);
        },
        onUndo: () => {
          onAttachmentsChange(prev);
        },
        undoMessage: 'Attachment restored',
        errorMessage: 'Failed to delete attachment',
      });
    },
    [taskId, attachments, onAttachmentsChange, transport],
  );

  return (
    <div className="flex flex-col px-5">
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
                style={{ color: LABEL_COLOR }}
              >
                Attachments
              </p>
              {attachments.length > 0 && (
                <Badge variant="secondary" className="ml-1 text-xs">
                  {attachments.length}
                </Badge>
              )}
            </AccordionPrimitive.Trigger>
          </AccordionPrimitive.Header>
          <AccordionPrimitive.Content className="data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down overflow-hidden text-sm">
            <div className="space-y-3 pt-3 pb-1">
              {/* Upload zone */}
              <button
                type="button"
                className={cn(
                  'flex w-full cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed border-(--celune-border) px-4 py-5 transition-colors hover:border-(--celune-fg-muted)/50 hover:bg-(--celune-surface)',
                  uploading && 'pointer-events-none opacity-60',
                )}
                onClick={() => fileInputRef.current?.click()}
              >
                {uploading ? (
                  <>
                    <Loader2 className="h-6 w-6 animate-spin text-(--celune-fg-muted)" />
                    <div className="w-full max-w-[200px]">
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-(--celune-surface-hover)">
                        <div
                          className="h-full rounded-full bg-(--celune-status-done) transition-all duration-200"
                          style={{ width: `${uploadProgress}%` }}
                        />
                      </div>
                      <p className="mt-1.5 text-xs text-(--celune-fg-muted)">
                        Uploading… {uploadProgress}%
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <CloudUpload className="h-6 w-6 text-(--celune-fg-muted)" />
                    <div className="text-center">
                      <p className="text-sm text-(--celune-fg-muted)">
                        Drag files here or click to upload
                      </p>
                      <p className="mt-0.5 text-xs text-(--celune-fg-muted)/60">
                        Images, PDFs, Markdown, code files &mdash; up to 10MB
                      </p>
                    </div>
                  </>
                )}
              </button>

              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept={ALLOWED_EXTENSIONS}
                className="hidden"
                onChange={(e) => {
                  if (e.target.files) uploadFiles(e.target.files);
                }}
              />

              {/* Attachment cards or empty state */}
              {attachments.length > 0 ? (
                <div className="space-y-2">
                  {attachments.map((att) => (
                    <AttachmentCard key={att.id} attachment={att} onDelete={handleDelete} />
                  ))}
                </div>
              ) : (
                <p className="py-2 text-center text-xs text-(--celune-fg-muted)/60">
                  No attachments yet. Upload files to get started.
                </p>
              )}
            </div>
          </AccordionPrimitive.Content>
        </AccordionPrimitive.Item>
      </AccordionPrimitive.Root>
    </div>
  );
}
