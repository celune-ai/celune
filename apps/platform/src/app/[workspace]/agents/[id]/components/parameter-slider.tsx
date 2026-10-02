'use client';

export function ParameterSlider({
  id,
  label,
  description,
  value,
  onChange,
}: {
  id: string;
  label: string;
  description: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <label htmlFor={id} className="text-foreground text-sm font-medium">
          {label}
        </label>
        <span className="text-brand w-8 text-right font-mono text-sm font-[600] tabular-nums">
          {value}
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={0}
        max={100}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="agent-slider mt-1.5 w-full"
        style={{ '--fill': `${value}%` } as React.CSSProperties}
      />
      <p className="text-foreground-lighter mt-3 text-xs leading-relaxed">{description}</p>
    </div>
  );
}
