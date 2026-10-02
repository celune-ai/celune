'use client';

/**
 * Unified zero state for features that need time to collect data.
 * Used by: Health dashboard, Delegation flow, Analytics, Heartbeat.
 * Shows a consistent spot illustration with customizable title/description.
 */

interface CollectingZeroStateProps {
  title?: string;
  description?: string;
}

function SpotIllustration() {
  return (
    <svg
      width="160"
      height="120"
      viewBox="0 0 160 120"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {/* Central ring — represents the system collecting */}
      <circle
        cx="80"
        cy="56"
        r="28"
        stroke="var(--color-border)"
        strokeWidth="1.5"
        strokeDasharray="4 3"
      />
      <circle cx="80" cy="56" r="16" stroke="var(--color-surface-400)" strokeWidth="1" />

      {/* Inner brand dot — the core */}
      <circle cx="80" cy="56" r="4" fill="var(--color-brand-default)" opacity="0.6" />

      {/* Orbiting dots — data points being collected */}
      <circle cx="80" cy="28" r="3" fill="var(--color-surface-400)" />
      <circle cx="104" cy="42" r="2.5" fill="var(--color-brand-default)" opacity="0.4" />
      <circle cx="108" cy="64" r="2" fill="var(--color-surface-300)" />
      <circle cx="56" cy="42" r="2" fill="var(--color-surface-300)" />
      <circle cx="52" cy="68" r="2.5" fill="var(--color-brand-default)" opacity="0.3" />
      <circle cx="80" cy="84" r="2" fill="var(--color-surface-400)" />

      {/* Connecting lines from dots to center (dashed, faint) */}
      <line
        x1="80"
        y1="31"
        x2="80"
        y2="40"
        stroke="var(--color-border)"
        strokeWidth="1"
        strokeDasharray="2 2"
      />
      <line
        x1="102"
        y1="43"
        x2="96"
        y2="49"
        stroke="var(--color-border)"
        strokeWidth="1"
        strokeDasharray="2 2"
      />
      <line
        x1="58"
        y1="43"
        x2="64"
        y2="49"
        stroke="var(--color-border)"
        strokeWidth="1"
        strokeDasharray="2 2"
      />
      <line
        x1="80"
        y1="72"
        x2="80"
        y2="82"
        stroke="var(--color-border)"
        strokeWidth="1"
        strokeDasharray="2 2"
      />

      {/* Bottom text placeholder bars */}
      <rect
        x="56"
        y="100"
        width="48"
        height="4"
        rx="2"
        fill="var(--color-surface-300)"
        opacity="0.5"
      />
      <rect
        x="64"
        y="110"
        width="32"
        height="3"
        rx="1.5"
        fill="var(--color-surface-300)"
        opacity="0.3"
      />
    </svg>
  );
}

export function CollectingZeroState({
  title = 'Collecting data',
  description = 'This section will populate as your team works on tasks and projects. Check back in a few days.',
}: CollectingZeroStateProps) {
  return (
    <div className="flex flex-col items-center py-16 text-center">
      <div className="mb-6">
        <SpotIllustration />
      </div>
      <h3 className="text-foreground mb-2 text-base font-semibold">{title}</h3>
      <p className="text-foreground-lighter mx-auto max-w-sm text-sm leading-relaxed">
        {description}
      </p>
    </div>
  );
}
