import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-[4px] border font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
  {
    variants: {
      variant: {
        default: 'border-brand bg-brand text-[#161616]',
        secondary: 'border-white bg-white text-[#161616]',
        outline: 'border-border bg-transparent text-foreground',
        destructive: 'border-destructive-600 bg-destructive-600 text-[#161616]',
        warning: 'border-warning-600 bg-warning-600 text-[#161616]',
        brand: 'border-brand-600 bg-brand-600 text-[#161616]',
        success: 'border-brand bg-brand text-[#161616]',
        ghost: 'border-white/80 bg-white/80 text-[#161616]',
        muted: 'border-[#3a3a3a] bg-[#2a2b2c] text-white',
        'destructive-outline': 'border-destructive-600 bg-transparent text-destructive-600',
        /* ── Palette colors — light (default fill) ── */
        emerald: 'border-[#51BD7C] bg-[#51BD7C] text-[#161616]',
        pink: 'border-[#E090B7] bg-[#E090B7] text-[#161616]',
        violet: 'border-[#D48EEB] bg-[#D48EEB] text-[#161616]',
        coral: 'border-[#F37E7A] bg-[#F37E7A] text-[#161616]',
        gold: 'border-[#EBD160] bg-[#EBD160] text-[#161616]',
        blue: 'border-[#7B9FFB] bg-[#7B9FFB] text-[#161616]',
        bronze: 'border-[#F5AB34] bg-[#F5AB34] text-[#161616]',
        /* ── Palette colors — dark (outlined/dark) ── */
        'emerald-dark': 'border-[#36A061] bg-transparent text-[#51BD7C]',
        'pink-dark': 'border-[#D575A3] bg-transparent text-[#E090B7]',
        'violet-dark': 'border-[#C567E4] bg-transparent text-[#D48EEB]',
        'coral-dark': 'border-[#EE4A44] bg-transparent text-[#F37E7A]',
        'gold-dark': 'border-[#B69816] bg-transparent text-[#EBD160]',
        'blue-dark': 'border-[#396FF9] bg-transparent text-[#7B9FFB]',
        'bronze-dark': 'border-[#C37C09] bg-transparent text-[#F5AB34]',
      },
      size: {
        sm: 'px-1 py-px text-xs',
        default: 'px-1 py-px text-sm',
        lg: 'px-1.5 py-0.5 text-sm',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, size, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant, size }), className)} {...props} />;
}

export { Badge, badgeVariants };
