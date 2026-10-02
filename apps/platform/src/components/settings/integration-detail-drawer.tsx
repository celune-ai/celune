'use client';

import { useEffect } from 'react';
import Image from 'next/image';
import { X, ExternalLink, CheckCircle2, XCircle, Circle, Settings } from 'lucide-react';
import { cn } from '@repo/ui/utils';
import { Button } from '@repo/ui/components/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@repo/ui/components/tooltip';
import type { IntegrationMeta, IntegrationStatus, IntegrationStatusResult } from '@repo/types';
import { getIntegrationLogoPath } from '@/lib/integrations-registry';

const STATUS_DISPLAY: Record<
  IntegrationStatus,
  { label: string; color: string; icon: typeof CheckCircle2 }
> = {
  connected: { label: 'Connected', color: 'text-green-400', icon: CheckCircle2 },
  disconnected: { label: 'Not connected', color: 'text-foreground-lighter', icon: Circle },
  error: { label: 'Error', color: 'text-red-400', icon: XCircle },
  not_configured: { label: 'Not configured', color: 'text-foreground-lighter', icon: Settings },
};

// ---------------------------------------------------------------------------
// Per-integration detail content
// ---------------------------------------------------------------------------

interface DetailSection {
  label: string;
  value: string;
}

function getIntegrationDetails(
  integration: IntegrationMeta,
  status: IntegrationStatusResult | undefined,
): {
  sections: DetailSection[];
  actions: { label: string; href: string; variant: 'default' | 'outline' }[];
} {
  const sections: DetailSection[] = [];
  const actions: { label: string; href: string; variant: 'default' | 'outline' }[] = [];
  const currentStatus = status?.status ?? 'disconnected';

  switch (integration.id) {
    case 'github':
      if (currentStatus === 'connected' && status?.details) {
        sections.push({ label: 'Repository', value: status.details });
      }
      sections.push({ label: 'Scope', value: 'Workspace-level' });
      sections.push({ label: 'Setup', value: 'GitHub App installation' });
      if (currentStatus !== 'connected') {
        actions.push({
          label: 'Connect GitHub',
          href: '../workspace-settings',
          variant: 'default',
        });
      } else {
        actions.push({
          label: 'Manage Connection',
          href: '../workspace-settings',
          variant: 'outline',
        });
      }
      break;

    case 'slack':
      sections.push({ label: 'Scope', value: 'Workspace-level' });
      sections.push({ label: 'Setup', value: 'Slack OAuth' });
      if (currentStatus !== 'connected') {
        actions.push({ label: 'Connect Slack', href: '?tab=notifications', variant: 'default' });
      } else {
        actions.push({
          label: 'Manage Connection',
          href: '?tab=notifications',
          variant: 'outline',
        });
      }
      break;

    case 'anthropic':
    case 'openai':
    case 'elevenlabs':
    case 'groq':
      if (status?.details) {
        sections.push({ label: 'Keys', value: status.details });
      }
      sections.push({ label: 'Scope', value: 'Workspace-level (BYOK)' });
      sections.push({ label: 'Setup', value: 'Bring your own API key' });
      actions.push({
        label: currentStatus === 'connected' ? 'Manage Keys' : 'Add API Key',
        href: '?tab=developer',
        variant: currentStatus === 'connected' ? 'outline' : 'default',
      });
      break;

    case 'stripe':
      if (status?.details) {
        sections.push({ label: 'Subscription', value: status.details });
      }
      sections.push({ label: 'Scope', value: 'Platform-level' });
      sections.push({ label: 'Setup', value: 'Managed via billing' });
      actions.push({ label: 'Manage Billing', href: '?tab=billing', variant: 'outline' });
      break;

    case 'sentry':
    case 'railway':
    case 'supabase':
    case 'agentmail':
      if (status?.details) {
        sections.push({ label: 'Details', value: status.details });
      }
      sections.push({ label: 'Scope', value: 'Platform-level' });
      sections.push({
        label: 'Configuration',
        value:
          currentStatus === 'connected'
            ? 'Configured by platform admin'
            : 'Requires environment variable',
      });
      break;
  }

  // Always add external link
  actions.push({ label: 'Visit Website', href: integration.url, variant: 'outline' });

  return { sections, actions };
}

// ---------------------------------------------------------------------------
// Drawer component
// ---------------------------------------------------------------------------

interface IntegrationDetailDrawerProps {
  open: boolean;
  onClose: () => void;
  integration: IntegrationMeta | null;
  status: IntegrationStatusResult | undefined;
  onStatusChange?: () => void;
  onNavigateTab?: (tab: string) => void;
}

export function IntegrationDetailDrawer({
  open,
  onClose,
  integration,
  status,
  onNavigateTab,
}: IntegrationDetailDrawerProps) {
  // ESC to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!integration) return null;

  const logoPath = getIntegrationLogoPath(integration.id);
  const currentStatus = status?.status ?? 'disconnected';
  const statusConfig = STATUS_DISPLAY[currentStatus];
  const StatusIcon = statusConfig.icon;
  const { sections, actions } = getIntegrationDetails(integration, status);

  return (
    <>
      {/* Backdrop */}
      <div
        className={cn(
          'fixed inset-0 z-[60] bg-black/40 transition-opacity duration-200',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${integration.name} integration details`}
        className={cn(
          'border-border bg-surface-75 fixed top-0 right-0 z-[61] flex h-full w-full max-w-md flex-col border-l shadow-2xl transition-transform duration-200 ease-out',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        {/* Header */}
        <div className="border-border flex items-start justify-between border-b px-5 pt-5 pb-4">
          <div className="flex items-center gap-3">
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
            <div>
              <h2 className="text-foreground text-lg font-semibold">{integration.name}</h2>
              <div className="flex items-center gap-1.5">
                <StatusIcon className={`h-3.5 w-3.5 ${statusConfig.color}`} />
                <span className={`text-xs font-medium ${statusConfig.color}`}>
                  {statusConfig.label}
                </span>
              </div>
            </div>
          </div>
          <TooltipProvider delayDuration={500}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close"
                  className="text-foreground-lighter hover:text-foreground rounded p-1 transition-colors"
                >
                  <X className="h-5 w-5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">
                Close
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-5">
          {/* Description */}
          <p className="text-foreground-lighter text-sm leading-relaxed">
            {integration.description}
          </p>

          {/* Detail sections */}
          <div className="mt-6 space-y-4">
            {sections.map((section) => (
              <div key={section.label}>
                <dt className="text-foreground-lighter text-xs font-medium tracking-wider uppercase">
                  {section.label}
                </dt>
                <dd className="text-foreground mt-1 text-sm">{section.value}</dd>
              </div>
            ))}
          </div>

          {/* Last checked */}
          {status?.last_checked && (
            <p className="text-foreground-muted mt-6 text-xs">
              Last checked: {new Date(status.last_checked).toLocaleString()}
            </p>
          )}
        </div>

        {/* Actions footer */}
        <div className="border-border space-y-2 border-t px-5 py-4">
          {actions.map((action) => {
            const isExternal = action.href.startsWith('http');
            return (
              <Button
                key={action.label}
                variant={action.variant}
                size="sm"
                className="w-full justify-center"
                onClick={() => {
                  if (isExternal) {
                    window.open(action.href, '_blank', 'noopener');
                  } else {
                    const params = new URLSearchParams(action.href.replace('?', ''));
                    const tab = params.get('tab');
                    onClose();
                    if (tab && onNavigateTab) {
                      onNavigateTab(tab);
                    }
                  }
                }}
              >
                {action.label}
                {isExternal && <ExternalLink className="ml-1.5 h-3.5 w-3.5" />}
              </Button>
            );
          })}
        </div>
      </div>
    </>
  );
}
