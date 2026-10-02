'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@repo/ui/components/popover';

interface DatePickerCalendarProps {
  value?: string | null;
  onChange: (date: string | null) => void;
  children: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

const DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfWeek(year: number, month: number) {
  return new Date(year, month, 1).getDay();
}

export function DatePickerCalendar({
  value,
  onChange,
  children,
  open,
  onOpenChange,
}: DatePickerCalendarProps) {
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);

  const initialDate = value ? new Date(value) : today;
  const [viewYear, setViewYear] = useState(initialDate.getFullYear());
  const [viewMonth, setViewMonth] = useState(initialDate.getMonth());

  // Masked input state: MM/DD/YYYY
  const formatForInput = useCallback((iso: string | null | undefined) => {
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    return `${m}/${d}/${y}`;
  }, []);
  const [inputValue, setInputValue] = useState(() => formatForInput(value));

  // Sync input when value prop changes
  useEffect(() => {
    setInputValue(formatForInput(value));
  }, [value, formatForInput]);

  // Sync calendar view when popover opens
  useEffect(() => {
    if (open) {
      const d = value ? new Date(value) : new Date();
      setViewYear(d.getFullYear());
      setViewMonth(d.getMonth());
      setInputValue(formatForInput(value));
    }
  }, [open]);

  const handleInputChange = (raw: string) => {
    // Strip non-digits
    const digits = raw.replace(/\D/g, '');
    // Auto-format as MM/DD/YYYY
    let formatted = '';
    if (digits.length > 0) formatted += digits.slice(0, 2);
    if (digits.length > 2) formatted += '/' + digits.slice(2, 4);
    if (digits.length > 4) formatted += '/' + digits.slice(4, 8);
    setInputValue(formatted);

    // Parse complete date
    if (digits.length === 8) {
      const mm = parseInt(digits.slice(0, 2), 10);
      const dd = parseInt(digits.slice(2, 4), 10);
      const yyyy = parseInt(digits.slice(4, 8), 10);
      if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31 && yyyy >= 1900 && yyyy <= 2100) {
        const iso = `${yyyy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
        setViewYear(yyyy);
        setViewMonth(mm - 1);
        onChange(iso);
      }
    }
  };

  const calendarDays = useMemo(() => {
    const daysInMonth = getDaysInMonth(viewYear, viewMonth);
    const firstDay = getFirstDayOfWeek(viewYear, viewMonth);
    const daysInPrevMonth = getDaysInMonth(viewYear, viewMonth - 1);

    const days: { day: number; month: number; year: number; isCurrentMonth: boolean }[] = [];

    // Previous month trailing days
    for (let i = firstDay - 1; i >= 0; i--) {
      const d = daysInPrevMonth - i;
      const m = viewMonth === 0 ? 11 : viewMonth - 1;
      const y = viewMonth === 0 ? viewYear - 1 : viewYear;
      days.push({ day: d, month: m, year: y, isCurrentMonth: false });
    }

    // Current month
    for (let d = 1; d <= daysInMonth; d++) {
      days.push({ day: d, month: viewMonth, year: viewYear, isCurrentMonth: true });
    }

    // Next month leading days (fill to 42 = 6 rows)
    const remaining = 42 - days.length;
    for (let d = 1; d <= remaining; d++) {
      const m = viewMonth === 11 ? 0 : viewMonth + 1;
      const y = viewMonth === 11 ? viewYear + 1 : viewYear;
      days.push({ day: d, month: m, year: y, isCurrentMonth: false });
    }

    return days;
  }, [viewYear, viewMonth]);

  const prevMonth = () => {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear(viewYear - 1);
    } else {
      setViewMonth(viewMonth - 1);
    }
  };

  const nextMonth = () => {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear(viewYear + 1);
    } else {
      setViewMonth(viewMonth + 1);
    }
  };

  const handleSelect = (day: { day: number; month: number; year: number }) => {
    const dateStr = `${day.year}-${String(day.month + 1).padStart(2, '0')}-${String(day.day).padStart(2, '0')}`;
    setInputValue(formatForInput(dateStr));
    onChange(dateStr);
    onOpenChange?.(false);
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-[280px] p-3" align="start" onClick={(e) => e.stopPropagation()}>
        {/* Header + masked input */}
        <div className="mb-3 flex flex-col gap-2">
          <span className="text-sm font-(weight:--celune-font-weight-strong)">Due date</span>
          <input
            type="text"
            value={inputValue}
            onChange={(e) => handleInputChange(e.target.value)}
            placeholder="MM/DD/YYYY"
            maxLength={10}
            className="w-full rounded-md border border-(--celune-border) bg-(--celune-surface-hover) px-3 py-1.5 text-sm text-(--celune-fg) placeholder:text-(--celune-fg-muted) focus:border-(--celune-fg)/30 focus:ring-1 focus:ring-(--celune-fg)/20 focus:outline-none"
            autoFocus
          />
        </div>

        {/* Month nav */}
        <div className="mb-2 flex items-center justify-between">
          <button
            type="button"
            onClick={prevMonth}
            className="rounded p-0.5 text-(--celune-fg-muted) transition-colors hover:text-(--celune-fg)"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-sm font-(weight:--celune-font-weight-medium)">
            {MONTHS[viewMonth]} {viewYear}
          </span>
          <button
            type="button"
            onClick={nextMonth}
            className="rounded p-0.5 text-(--celune-fg-muted) transition-colors hover:text-(--celune-fg)"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        {/* Day headers */}
        <div className="mb-1 grid grid-cols-7 text-center">
          {DAYS.map((d, i) => (
            <span
              key={i}
              className="py-1 text-(length:--celune-text-2xs) font-(weight:--celune-font-weight-medium) text-(--celune-fg-muted)"
            >
              {d}
            </span>
          ))}
        </div>

        {/* Day grid */}
        <div className="grid grid-cols-7 text-center">
          {calendarDays.map((day, i) => {
            const dateStr = `${day.year}-${String(day.month + 1).padStart(2, '0')}-${String(day.day).padStart(2, '0')}`;
            const isSelected = value === dateStr;
            const isToday = dateStr === todayStr;

            return (
              <button
                key={i}
                type="button"
                onClick={() => handleSelect(day)}
                className={`mx-auto flex h-7 w-7 items-center justify-center rounded-full text-xs transition-colors ${
                  !day.isCurrentMonth
                    ? 'text-(--celune-fg-muted)/40'
                    : isSelected
                      ? 'bg-(--celune-primary) font-(weight:--celune-font-weight-strong) text-(--celune-on-status)'
                      : isToday
                        ? 'border border-(--celune-primary)/40 text-(--celune-fg)'
                        : 'text-(--celune-fg) hover:bg-(--celune-surface-hover)'
                }`}
              >
                {day.day}
              </button>
            );
          })}
        </div>

        {/* Footer */}
        <div className="mt-3 flex items-center justify-end">
          <button
            type="button"
            onClick={() => {
              onChange(null);
              onOpenChange?.(false);
            }}
            className="text-xs text-(--celune-fg-muted) transition-colors hover:text-(--celune-fg)"
          >
            Clear
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
