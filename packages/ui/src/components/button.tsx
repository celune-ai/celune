'use client';

import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../utils';

const buttonVariants = cva(
  'inline-flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default:
          'bg-brand text-black hover:bg-brand/80 border border-brand-600 hover:border-brand-600/80',
        primary:
          'bg-brand text-black hover:bg-brand/80 border border-brand-600 hover:border-brand-600/80',
        secondary: 'bg-surface-300 text-foreground hover:bg-surface-400 border border-border',
        outline: 'border border-border bg-background hover:bg-surface-200 hover:text-foreground',
        ghost: 'hover:bg-surface-200 hover:text-foreground',
        destructive:
          'bg-destructive text-foreground-contrast hover:bg-destructive-600 border border-destructive',
        warning: 'bg-warning text-foreground-contrast hover:bg-warning-600 border border-warning',
        link: 'text-brand underline-offset-4 hover:underline',
      },
      size: {
        sm: 'h-7 rounded-md px-2.5 text-xs',
        md: 'h-8 rounded-md px-3 text-xs',
        lg: 'h-10 rounded-md px-6',
        icon: 'h-8 w-8',
        'icon-sm': 'h-7 w-7 rounded-md',
        'icon-md': 'h-8 w-8 rounded-md',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'md',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
