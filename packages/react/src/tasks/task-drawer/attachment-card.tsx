'use client';

import { useState } from 'react';
import {
  File,
  FileImage,
  FileText,
  FileCode,
  FileSpreadsheet,
  Download,
  Trash2,
  Loader2,
} from 'lucide-react';
import { Button } from '@repo/ui/components/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@repo/ui/components/tooltip';
import type { TaskAttachment } from '@repo/types';

function getFileIcon(mimeType: string) {
  if (mimeType.startsWith('image/')) return FileImage;
  if (['application/pdf', 'text/markdown', 'text/plain'].includes(mimeType)) return FileText;
  if (['application/json', 'text/csv', 'text/tab-separated-values'].includes(mimeType))
    return FileSpreadsheet;
  if (
    [
      'text/typescript',
      'text/javascript',
      'text/x-python',
      'application/sql',
      'text/yaml',
      'application/x-yaml',
      'application/toml',
    ].includes(mimeType)
  )
    return FileCode;
  return File;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface AttachmentCardProps {
  attachment: TaskAttachment;
  onDelete: (id: string) => void;
}

export function AttachmentCard({ attachment, onDelete }: AttachmentCardProps) {
  const [deleting, setDeleting] = useState(false);
  const Icon = getFileIcon(attachment.mime_type);

  const handleDelete = () => {
    if (!confirm(`Delete "${attachment.file_name}"?`)) return;
    setDeleting(true);
    onDelete(attachment.id);
  };

  return (
    <div className="flex items-center gap-3 rounded-md border border-(--celune-border) bg-(--celune-surface) px-3 py-2">
      <Icon className="h-4 w-4 shrink-0 text-(--celune-fg-muted)" />
      <div className="min-w-0 flex-1">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <p className="truncate text-sm text-(--celune-fg)">{attachment.file_name}</p>
            </TooltipTrigger>
            <TooltipContent side="top">{attachment.file_name}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <p className="text-xs text-(--celune-fg-muted)">{formatFileSize(attachment.file_size)}</p>
      </div>
      <Button variant="ghost" size="icon-sm" asChild className="shrink-0">
        <a
          href={attachment.download_url ?? '#'}
          target="_blank"
          rel="noopener noreferrer"
          download={attachment.file_name}
        >
          <Download className="h-3.5 w-3.5" />
        </a>
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        className="shrink-0 hover:text-(--celune-danger)"
        onClick={handleDelete}
        disabled={deleting}
      >
        {deleting ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Trash2 className="h-3.5 w-3.5" />
        )}
      </Button>
    </div>
  );
}
