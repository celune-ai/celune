'use client';

import * as React from 'react';
import { cn } from '../utils';

interface NakedInputProps {
  value: string;
  onChange: (value: string) => void;
  onSave: (value: string) => void;
  onCancel: () => void;
  className?: string;
  inputClassName?: string;
}

/**
 * A borderless inline-edit input that auto-sizes to its content.
 * Uses a hidden sizer span to match the width of the text exactly.
 * Saves on blur, Enter, or Tab. Cancels on Escape.
 * Cursor is placed at the end of text on mount.
 */
const NakedInput = React.forwardRef<HTMLInputElement, NakedInputProps>(
  ({ value, onChange, onSave, onCancel, className, inputClassName }, ref) => {
    const innerRef = React.useRef<HTMLInputElement>(null);
    const sizerRef = React.useRef<HTMLSpanElement>(null);
    const [width, setWidth] = React.useState<number>(0);

    // Merge forwarded ref with inner ref
    React.useImperativeHandle(ref, () => innerRef.current as HTMLInputElement);

    // Focus and place cursor at end on mount
    React.useEffect(() => {
      const el = innerRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      }
    }, []);

    // Sync width from sizer
    React.useEffect(() => {
      if (sizerRef.current) {
        setWidth(sizerRef.current.scrollWidth + 2); // +2 for cursor
      }
    }, [value]);

    return (
      <span className={cn('relative inline-flex items-center', className)}>
        {/* Hidden sizer — inherits font styles from parent */}
        <span
          ref={sizerRef}
          aria-hidden
          className={cn('pointer-events-none invisible absolute whitespace-pre', inputClassName)}
        >
          {value || '\u00A0'}
        </span>
        <input
          ref={innerRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => onSave(value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === 'Tab') {
              e.preventDefault();
              onSave(value);
            }
            if (e.key === 'Escape') {
              onCancel();
            }
          }}
          style={{ width: width > 0 ? width : undefined }}
          className={cn('bg-transparent outline-none', inputClassName)}
        />
      </span>
    );
  },
);
NakedInput.displayName = 'NakedInput';

export { NakedInput };
export type { NakedInputProps };
