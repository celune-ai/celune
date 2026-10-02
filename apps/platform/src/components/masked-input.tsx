'use client';

import { useState, forwardRef } from 'react';
import { Eye, EyeOff } from 'lucide-react';

interface MaskedInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  /** When true, input starts visible (useful for API keys). Default: false (hidden). */
  defaultVisible?: boolean;
}

/**
 * Input with a show/hide toggle. Use for passwords, API keys, secrets, etc.
 * Drop-in replacement for <input type="password" />.
 */
export const MaskedInput = forwardRef<HTMLInputElement, MaskedInputProps>(
  ({ defaultVisible = false, className, ...props }, ref) => {
    const [visible, setVisible] = useState(defaultVisible);

    return (
      <div className="relative">
        <input ref={ref} type={visible ? 'text' : 'password'} className={className} {...props} />
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setVisible((v) => !v)}
          className="absolute top-1/2 right-2.5 -translate-y-1/2 text-white/40 transition-colors hover:text-white/70"
          aria-label={visible ? 'Hide' : 'Show'}
        >
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    );
  },
);

MaskedInput.displayName = 'MaskedInput';
