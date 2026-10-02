'use client';

import { PageActionBar } from '@/components/page-action-bar';

export default function AppsPage() {
  return (
    <div className="flex min-h-full flex-col">
      <PageActionBar>
        <span className="text-foreground text-xl font-medium">Apps</span>
      </PageActionBar>

      <div className="flex flex-1 flex-col items-center justify-center px-6 py-16">
        {/* Hero illustration */}
        <div className="relative mb-10">
          {/* Outer glow */}
          <div className="bg-brand/5 absolute inset-0 scale-150 rounded-full blur-3xl" />

          <svg
            width="320"
            height="280"
            viewBox="0 0 320 280"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="relative"
          >
            {/* Animated background grid dots */}
            <g opacity="0.15">
              {Array.from({ length: 8 }, (_, row) =>
                Array.from({ length: 10 }, (_, col) => (
                  <circle
                    key={`dot-${row}-${col}`}
                    cx={20 + col * 32}
                    cy={20 + row * 34}
                    r="1.5"
                    className="fill-foreground-muted"
                  >
                    <animate
                      attributeName="opacity"
                      values="0.3;1;0.3"
                      dur={`${2 + ((row * 10 + col) % 5) * 0.4}s`}
                      begin={`${((row + col) % 7) * 0.3}s`}
                      repeatCount="indefinite"
                    />
                  </circle>
                )),
              )}
            </g>

            {/* Central app window frame */}
            <g filter="url(#card-shadow)">
              <rect
                x="80"
                y="50"
                width="160"
                height="120"
                rx="12"
                className="fill-surface-200 stroke-border"
                strokeWidth="1"
              />
              {/* Title bar */}
              <rect x="80" y="50" width="160" height="28" rx="12" className="fill-surface-300" />
              <rect x="80" y="66" width="160" height="12" className="fill-surface-300" />
              {/* Traffic lights */}
              <circle cx="96" cy="64" r="4" className="fill-destructive/60" />
              <circle cx="108" cy="64" r="4" className="fill-warning/60" />
              <circle cx="120" cy="64" r="4" className="fill-brand/60" />

              {/* Code lines inside window */}
              <rect x="96" y="90" width="60" height="4" rx="2" className="fill-brand/30" />
              <rect
                x="96"
                y="100"
                width="90"
                height="4"
                rx="2"
                className="fill-foreground-muted/20"
              />
              <rect
                x="96"
                y="110"
                width="45"
                height="4"
                rx="2"
                className="fill-foreground-muted/15"
              />
              <rect x="96" y="120" width="75" height="4" rx="2" className="fill-brand/20" />
              <rect
                x="96"
                y="130"
                width="55"
                height="4"
                rx="2"
                className="fill-foreground-muted/15"
              />
              <rect
                x="96"
                y="140"
                width="100"
                height="4"
                rx="2"
                className="fill-foreground-muted/10"
              />
            </g>

            {/* Orbiting satellite nodes */}
            {/* Top-left: database */}
            <g>
              <rect
                x="28"
                y="30"
                width="44"
                height="36"
                rx="8"
                className="fill-surface-300 stroke-border"
                strokeWidth="0.75"
              >
                <animate attributeName="y" values="30;26;30" dur="4s" repeatCount="indefinite" />
              </rect>
              <circle cx="50" cy="42" r="6" className="fill-brand/40">
                <animate attributeName="r" values="6;7;6" dur="4s" repeatCount="indefinite" />
              </circle>
              <rect
                x="42"
                y="52"
                width="16"
                height="3"
                rx="1.5"
                className="fill-foreground-muted/30"
              >
                <animate attributeName="y" values="52;48;52" dur="4s" repeatCount="indefinite" />
              </rect>
            </g>

            {/* Top-right: API */}
            <g>
              <rect
                x="248"
                y="24"
                width="44"
                height="36"
                rx="8"
                className="fill-surface-300 stroke-border"
                strokeWidth="0.75"
              >
                <animate attributeName="y" values="24;20;24" dur="5s" repeatCount="indefinite" />
              </rect>
              <path d="M262 36 L270 36 L274 40 L270 44 L262 44 Z" className="fill-brand/35">
                <animate
                  attributeName="opacity"
                  values="0.35;0.7;0.35"
                  dur="3s"
                  repeatCount="indefinite"
                />
              </path>
              <rect
                x="262"
                y="48"
                width="16"
                height="3"
                rx="1.5"
                className="fill-foreground-muted/30"
              >
                <animate attributeName="y" values="48;44;48" dur="5s" repeatCount="indefinite" />
              </rect>
            </g>

            {/* Bottom-left: mobile */}
            <g>
              <rect
                x="36"
                y="185"
                width="32"
                height="52"
                rx="6"
                className="fill-surface-300 stroke-border"
                strokeWidth="0.75"
              >
                <animate
                  attributeName="y"
                  values="185;181;185"
                  dur="4.5s"
                  repeatCount="indefinite"
                />
              </rect>
              <rect x="42" y="195" width="20" height="14" rx="2" className="fill-brand/25">
                <animate
                  attributeName="y"
                  values="195;191;195"
                  dur="4.5s"
                  repeatCount="indefinite"
                />
              </rect>
              <rect
                x="46"
                y="213"
                width="12"
                height="3"
                rx="1.5"
                className="fill-foreground-muted/30"
              >
                <animate
                  attributeName="y"
                  values="213;209;213"
                  dur="4.5s"
                  repeatCount="indefinite"
                />
              </rect>
              <rect
                x="42"
                y="220"
                width="20"
                height="8"
                rx="2"
                className="fill-foreground-muted/10"
              >
                <animate
                  attributeName="y"
                  values="220;216;220"
                  dur="4.5s"
                  repeatCount="indefinite"
                />
              </rect>
            </g>

            {/* Bottom-right: globe/web */}
            <g>
              <rect
                x="246"
                y="190"
                width="44"
                height="36"
                rx="8"
                className="fill-surface-300 stroke-border"
                strokeWidth="0.75"
              >
                <animate
                  attributeName="y"
                  values="190;186;190"
                  dur="3.5s"
                  repeatCount="indefinite"
                />
              </rect>
              <circle
                cx="268"
                cy="202"
                r="8"
                className="stroke-brand/30"
                strokeWidth="1"
                fill="none"
              >
                <animate attributeName="r" values="8;9;8" dur="3.5s" repeatCount="indefinite" />
              </circle>
              <line
                x1="260"
                y1="202"
                x2="276"
                y2="202"
                className="stroke-brand/20"
                strokeWidth="0.75"
              />
              <ellipse
                cx="268"
                cy="202"
                rx="4"
                ry="8"
                className="stroke-brand/20"
                strokeWidth="0.75"
                fill="none"
              />
              <rect
                x="260"
                y="214"
                width="16"
                height="3"
                rx="1.5"
                className="fill-foreground-muted/30"
              >
                <animate
                  attributeName="y"
                  values="214;210;214"
                  dur="3.5s"
                  repeatCount="indefinite"
                />
              </rect>
            </g>

            {/* Connection lines — dashed, animated */}
            <line
              x1="72"
              y1="54"
              x2="80"
              y2="60"
              className="stroke-brand/20"
              strokeWidth="1"
              strokeDasharray="4 3"
            >
              <animate
                attributeName="stroke-dashoffset"
                values="0;-7"
                dur="1.5s"
                repeatCount="indefinite"
              />
            </line>
            <line
              x1="248"
              y1="48"
              x2="240"
              y2="58"
              className="stroke-brand/20"
              strokeWidth="1"
              strokeDasharray="4 3"
            >
              <animate
                attributeName="stroke-dashoffset"
                values="0;-7"
                dur="1.8s"
                repeatCount="indefinite"
              />
            </line>
            <line
              x1="68"
              y1="200"
              x2="80"
              y2="165"
              className="stroke-brand/20"
              strokeWidth="1"
              strokeDasharray="4 3"
            >
              <animate
                attributeName="stroke-dashoffset"
                values="0;-7"
                dur="2s"
                repeatCount="indefinite"
              />
            </line>
            <line
              x1="246"
              y1="202"
              x2="240"
              y2="168"
              className="stroke-brand/20"
              strokeWidth="1"
              strokeDasharray="4 3"
            >
              <animate
                attributeName="stroke-dashoffset"
                values="0;-7"
                dur="1.6s"
                repeatCount="indefinite"
              />
            </line>

            {/* Floating deploy arrow */}
            <g className="text-brand">
              <path
                d="M160 185 L152 198 L156 198 L156 210 L164 210 L164 198 L168 198 Z"
                fill="currentColor"
                opacity="0.5"
              >
                <animate
                  attributeName="opacity"
                  values="0.25;0.6;0.25"
                  dur="2.5s"
                  repeatCount="indefinite"
                />
                <animateTransform
                  attributeName="transform"
                  type="translate"
                  values="0,0;0,-4;0,0"
                  dur="2.5s"
                  repeatCount="indefinite"
                />
              </path>
            </g>

            {/* Particle sparkles */}
            {[
              { cx: 145, cy: 42, delay: '0s' },
              { cx: 185, cy: 38, delay: '1.2s' },
              { cx: 130, cy: 175, delay: '0.6s' },
              { cx: 195, cy: 178, delay: '1.8s' },
              { cx: 110, cy: 105, delay: '0.3s' },
              { cx: 210, cy: 115, delay: '0.9s' },
            ].map(({ cx, cy, delay }, i) => (
              <circle key={`spark-${i}`} cx={cx} cy={cy} r="1.5" className="fill-brand">
                <animate
                  attributeName="opacity"
                  values="0;0.8;0"
                  dur="2.5s"
                  begin={delay}
                  repeatCount="indefinite"
                />
                <animate
                  attributeName="r"
                  values="0.5;2;0.5"
                  dur="2.5s"
                  begin={delay}
                  repeatCount="indefinite"
                />
              </circle>
            ))}

            {/* Glow filter */}
            <defs>
              <filter id="card-shadow" x="-10%" y="-10%" width="120%" height="130%">
                <feDropShadow
                  dx="0"
                  dy="4"
                  stdDeviation="8"
                  floodColor="hsl(153deg 60% 53%)"
                  floodOpacity="0.08"
                />
              </filter>
            </defs>
          </svg>
        </div>

        {/* Text content */}
        <div className="flex flex-col items-center gap-3">
          <h2 className="text-foreground text-2xl font-semibold tracking-tight">Coming Soon</h2>
          <p className="text-foreground-light max-w-sm text-center text-sm leading-relaxed">
            A place to connect to, manage, and deploy apps produced by your second brain.
          </p>
          <div className="bg-brand/10 text-brand mt-2 rounded-full px-4 py-1.5 text-xs font-medium">
            In Development
          </div>
        </div>
      </div>
    </div>
  );
}
