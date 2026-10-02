export function ChartError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="border-border bg-surface-75 flex flex-col items-center justify-center gap-2 rounded-lg border p-8 text-center">
      <p className="text-foreground-lighter text-sm">Failed to load data</p>
      <button
        onClick={onRetry}
        className="border-border text-foreground-light hover:text-foreground rounded-md border px-3 py-1 text-xs transition-colors hover:border-current"
      >
        Retry
      </button>
    </div>
  );
}
