interface MetricProps {
  label: string;
  value: string | number | null | undefined;
}

export function Metric({ label, value }: MetricProps) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-foreground-lighter">{label}</span>
      <span className="text-foreground font-mono">{value ?? 'N/A'}</span>
    </div>
  );
}
