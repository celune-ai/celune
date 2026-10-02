import { toast } from 'sonner';

/**
 * Show a toast with an "Undo" action button that uses the delayed-commit pattern.
 *
 * The destructive action is deferred by the toast duration (5s default).
 * If the user clicks "Undo", the action is cancelled and a confirmation toast shown.
 * If the toast dismisses without undo, the action executes.
 *
 * @param message - Toast message (e.g., "Project deleted")
 * @param opts.action - The destructive async action to execute after delay
 * @param opts.onUndo - Optional callback when undo is clicked (e.g., rollback optimistic update)
 * @param opts.undoMessage - Toast message on undo (default: "Action undone")
 * @param opts.errorMessage - Toast message if action fails (default: "Action failed")
 * @param opts.duration - Toast duration in ms (default: 5000)
 */
export function toastWithUndo(
  message: string,
  opts: {
    action: () => Promise<void>;
    onUndo?: () => void;
    undoMessage?: string;
    errorMessage?: string;
    duration?: number;
  },
) {
  const {
    action,
    onUndo,
    undoMessage = 'Action undone',
    errorMessage = 'Action failed',
    duration = 5000,
  } = opts;

  let cancelled = false;

  const timer = setTimeout(async () => {
    if (cancelled) return;
    try {
      await action();
    } catch {
      toast.error(errorMessage);
      onUndo?.();
    }
  }, duration);

  toast.success(message, {
    duration,
    action: {
      label: 'Undo',
      onClick: () => {
        cancelled = true;
        clearTimeout(timer);
        onUndo?.();
        toast.success(undoMessage);
      },
    },
  });
}
