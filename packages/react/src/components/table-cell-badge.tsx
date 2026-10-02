'use client';

import { Badge } from './badge';
import type { BadgeProps } from './badge';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@repo/ui/components/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from '@repo/ui/components/tooltip';
import { cn } from '@repo/ui/utils';
import { ChevronDown } from 'lucide-react';
import { TONE_FILL, toneStyle } from '../lib/tones';

export interface CellBadgeOption {
  value: string;
  label: string;
  variant?: BadgeProps['variant'];
  style?: React.CSSProperties;
  /** CSS color (usually a --celune-* reference). Overrides the variant's colors. */
  tone?: string;
}

interface TableCellBadgeProps {
  value: string;
  label: string;
  fullLabel?: string;
  options: CellBadgeOption[];
  onChange?: (value: string) => void;
  variant?: BadgeProps['variant'];
  style?: React.CSSProperties;
  /** CSS color (usually a --celune-* reference). Overrides the variant's colors. */
  tone?: string;
  dotColor?: string;
  disabled?: boolean;
  /** When true, show an em-dash placeholder instead of a badge */
  empty?: boolean;
}

/** Em-dash shown for empty / unset cells */
const EmDash = () => <span className="text-sm text-(--celune-fg-muted)">–</span>;

export function TableCellBadge({
  value,
  label,
  fullLabel,
  options,
  onChange,
  variant = 'default',
  style,
  tone,
  dotColor,
  disabled,
  empty,
}: TableCellBadgeProps) {
  const tooltipText = fullLabel && fullLabel !== label ? fullLabel : undefined;

  const badgeContent = empty ? (
    <EmDash />
  ) : (
    <Badge
      variant={variant}
      size="lg"
      className={cn(
        'max-w-full gap-0',
        tone && TONE_FILL,
        disabled && 'pointer-events-none opacity-50',
      )}
      style={toneStyle(tone, style)}
    >
      {dotColor && (
        <span
          className="mr-1.5 h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: dotColor }}
        />
      )}
      <span className="truncate">{label}</span>
    </Badge>
  );

  /* The whole cell is the click target — badge left, chevron 8px from right edge */
  const cellInner = (
    <div
      className="group/cell flex min-w-0 flex-1 cursor-pointer items-center self-stretch py-3 pr-2"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="min-w-0 flex-1">{badgeContent}</div>
      <div className="flex w-4 shrink-0 items-center justify-center">
        {!disabled && onChange && (
          <ChevronDown className="h-3.5 w-3.5 text-(--celune-border-strong) opacity-0 transition-all group-hover/cell:text-(--celune-fg) group-hover/cell:opacity-100" />
        )}
      </div>
    </div>
  );

  if (disabled || !onChange) {
    if (tooltipText && !empty) {
      return (
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>{cellInner}</TooltipTrigger>
            <TooltipContent side="top">{tooltipText}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    }
    return cellInner;
  }

  const triggerEl = (
    <DropdownMenuTrigger asChild>
      {tooltipText && !empty ? (
        <div className="flex min-w-0 flex-1 self-stretch">
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>{cellInner}</TooltipTrigger>
              <TooltipContent side="top">{tooltipText}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      ) : (
        cellInner
      )}
    </DropdownMenuTrigger>
  );

  return (
    <DropdownMenu>
      {triggerEl}
      <DropdownMenuContent
        align="start"
        className="min-w-[120px]"
        onClick={(e) => e.stopPropagation()}
      >
        {options.map((opt) => (
          <DropdownMenuItem
            key={opt.value}
            onClick={(e) => {
              e.stopPropagation();
              if (opt.value !== value) onChange(opt.value);
            }}
            className={cn(
              'cursor-pointer gap-2',
              opt.value === value && 'bg-(--celune-surface-hover)',
            )}
          >
            <Badge
              variant={opt.variant ?? variant}
              size="sm"
              className={cn(opt.tone && TONE_FILL)}
              style={toneStyle(opt.tone, opt.style)}
            >
              {opt.label}
            </Badge>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
