'use client';

import {
  Settings,
  ExternalLink,
  CheckCircle2,
  XCircle,
  Circle,
  KeyRound,
  Zap,
  Brain,
} from 'lucide-react';
import { Badge } from '@repo/ui/components/badge';
import type { IntegrationStatus, IntegrationMeta, IntegrationStatusResult } from '@repo/types';
import Image from 'next/image';
import { getIntegrationLogoPath } from '@/lib/integrations-registry';

// ---------------------------------------------------------------------------
// Status display config
// ---------------------------------------------------------------------------

const STATUS_CONFIG: Record<
  IntegrationStatus,
  { label: string; dot: string; text: string; icon: typeof CheckCircle2 }
> = {
  connected: {
    label: 'Connected',
    dot: 'bg-green-500',
    text: 'text-green-400',
    icon: CheckCircle2,
  },
  disconnected: {
    label: 'Not connected',
    dot: 'bg-foreground-muted',
    text: 'text-foreground-lighter',
    icon: Circle,
  },
  error: {
    label: 'Error',
    dot: 'bg-red-500',
    text: 'text-red-400',
    icon: XCircle,
  },
  not_configured: {
    label: 'Not configured',
    dot: 'bg-foreground-muted',
    text: 'text-foreground-lighter',
    icon: Settings,
  },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface IntegrationCardProps {
  integration: IntegrationMeta;
  status: IntegrationStatusResult | undefined;
  /** Number of workflow memories gated by this integration */
  memoryCount?: number;
  onClick: () => void;
}

export function IntegrationCard({
  integration,
  status,
  memoryCount,
  onClick,
}: IntegrationCardProps) {
  const logoPath = getIntegrationLogoPath(integration.id);
  const currentStatus = status?.status ?? 'disconnected';
  const config = STATUS_CONFIG[currentStatus];
  const StatusIcon = config.icon;

  return (
    <button
      type="button"
      onClick={onClick}
      className="bg-surface-75 border-border hover:border-foreground-muted flex w-full cursor-pointer items-start gap-4 rounded-lg border p-4 text-left transition-colors"
    >
      {/* Icon */}
      <div className="bg-surface-200 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg">
        {logoPath ? (
          <Image
            src={logoPath}
            alt={integration.name}
            className="h-5 w-5 object-contain"
            width={20}
            height={20}
          />
        ) : (
          <Settings className="text-foreground h-5 w-5" />
        )}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-foreground text-sm font-medium">{integration.name}</span>
          {integration.integration_type === 'coming_soon' && (
            <Badge variant="muted" className="px-1.5 py-0 text-[10px]">
              Coming Soon
            </Badge>
          )}
          {integration.integration_type === 'mcp' && (
            <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
              MCP
            </Badge>
          )}
        </div>
        <p className="text-foreground-lighter mt-0.5 text-xs leading-relaxed">
          {integration.description}
        </p>

        {/* Status row */}
        <div className="mt-2 flex items-center gap-1.5">
          <StatusIcon className={`h-3.5 w-3.5 ${config.text}`} />
          <span className={`text-xs font-medium ${config.text}`}>{config.label}</span>
          {status?.details && !status?.key_source && (
            <>
              <span className="text-foreground-muted text-xs">·</span>
              <span className="text-foreground-lighter text-xs">{status.details}</span>
            </>
          )}
        </div>
      </div>

      {/* Action hint — right-aligned */}
      <div className="flex shrink-0 flex-col items-end gap-1.5 pt-0.5">
        {currentStatus === 'connected' ? (
          <Settings className="text-foreground-lighter h-4 w-4" />
        ) : currentStatus === 'disconnected' ? (
          <ExternalLink className="text-foreground-lighter h-4 w-4" />
        ) : (
          <Settings className="text-foreground-lighter h-4 w-4" />
        )}
        {/* BYOK/Plan/Enables badges hidden for now
        {status?.key_source === 'byok' && (
          <Badge variant="muted" className="gap-0.5 px-1.5 py-0 text-[10px]">
            <KeyRound size={9} />
            BYOK
          </Badge>
        )}
        {status?.key_source === 'plan' && (
          <Badge variant="muted" className="gap-0.5 px-1.5 py-0 text-[10px]">
            <Zap size={9} />
            Plan
          </Badge>
        )}
        {memoryCount != null && memoryCount > 0 && (
          <Badge variant="muted" className="gap-0.5 px-1.5 py-0 text-[10px]">
            <Brain size={9} />
            {currentStatus === 'connected' ? `${memoryCount} active` : `Enables ${memoryCount}`}
          </Badge>
        )}
        */}
      </div>
    </button>
  );
}
