import { toast } from 'sonner';
import { CeluneTransportError } from '../../transport/types';

export function reportUploadError(err: unknown) {
  const body =
    err instanceof CeluneTransportError && err.body && typeof err.body === 'object'
      ? (err.body as { error?: string; details?: { file: string; error: string }[] })
      : null;
  toast.error(body?.error ?? 'Upload failed');
  for (const d of body?.details ?? []) toast.error(`${d.file}: ${d.error}`);
}
