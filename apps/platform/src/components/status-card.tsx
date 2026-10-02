type SystemStatus =
  'ok' | 'online' | 'connected' | 'warning' | 'offline' | 'error' | 'not_found' | string;

interface StatusCardProps {
  title: string;
  status: SystemStatus;
  children: React.ReactNode;
}

const statusColors: Record<string, { dot: string; bg: string }> = {
  ok: { dot: 'bg-emerald-500', bg: 'bg-emerald-500/10' },
  online: { dot: 'bg-emerald-500', bg: 'bg-emerald-500/10' },
  connected: { dot: 'bg-emerald-500', bg: 'bg-emerald-500/10' },
  warning: { dot: 'bg-amber-500', bg: 'bg-amber-500/10' },
  offline: { dot: 'bg-red-500', bg: 'bg-red-500/10' },
  error: { dot: 'bg-red-500', bg: 'bg-red-500/10' },
  not_found: { dot: 'bg-zinc-400', bg: 'bg-zinc-400/10' },
};

export function StatusCard({ title, status, children }: StatusCardProps) {
  const colors = statusColors[status] || statusColors.warning;

  return (
    <div className="border-border bg-surface-100 rounded-xl border p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-foreground-lighter text-sm font-medium">{title}</h3>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${colors.bg}`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${colors.dot}`} />
          {status.charAt(0).toUpperCase() + status.slice(1)}
        </span>
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}
