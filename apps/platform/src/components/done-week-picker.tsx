'use client';

import { useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent } from '@repo/ui/components/popover';
import { ScrollArea } from '@repo/ui/components/scroll-area';
import { getWeekRange, formatMonthLabel, groupTasksByWeek, type WeekRange } from '@/lib/date-utils';
import type { Task, TaskAssignee, TaskPriority } from '@repo/types';

export interface DoneFilters {
  assignee: TaskAssignee | 'all';
  priority: TaskPriority | 'all';
  search: string;
}

interface DoneWeekPickerProps {
  allDoneTasks: Task[];
  selectedWeek: WeekRange;
  onSelectWeek: (week: WeekRange) => void;
  filteredCount: number;
  filters: DoneFilters;
  onFiltersChange: (filters: DoneFilters) => void;
}

export function DoneWeekPicker({
  allDoneTasks,
  selectedWeek,
  onSelectWeek,
  filteredCount,
}: DoneWeekPickerProps) {
  const [open, setOpen] = useState(false);

  const weekGroups = useMemo(() => groupTasksByWeek(allDoneTasks), [allDoneTasks]);

  // Group weeks by month for the dropdown, newest first
  const monthGroups = useMemo(() => {
    const map = new Map<string, { label: string; weeks: { week: WeekRange; count: number }[] }>();

    // Ensure current week is always present
    const currentWeek = getWeekRange(new Date());
    const allWeeks = [...weekGroups];
    if (!allWeeks.some((g) => g.week.start.getTime() === currentWeek.start.getTime())) {
      allWeeks.unshift({ week: currentWeek, tasks: [] });
    }

    for (const { week, tasks } of allWeeks) {
      const monthKey = `${week.start.getFullYear()}-${String(week.start.getMonth()).padStart(2, '0')}`;
      const monthLabel = formatMonthLabel(week.start);
      let entry = map.get(monthKey);
      if (!entry) {
        entry = { label: monthLabel, weeks: [] };
        map.set(monthKey, entry);
      }
      // Avoid duplicate weeks within the same month
      if (!entry.weeks.some((w) => w.week.start.getTime() === week.start.getTime())) {
        entry.weeks.push({ week, count: tasks.length });
      }
    }

    return Array.from(map.entries())
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([, m]) => ({
        ...m,
        weeks: m.weeks.sort((a, b) => b.week.start.getTime() - a.week.start.getTime()),
      }));
  }, [weekGroups]);

  return (
    <div className="flex w-full items-center gap-2.5">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="text-foreground hover:text-foreground/80 flex items-center gap-[6px] font-semibold transition-colors"
            style={{ fontSize: '16px' }}
          >
            Done ({selectedWeek.label})
            <ChevronDown className="h-3 w-3" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-56 p-2">
          <ScrollArea className="max-h-64">
            {monthGroups.map((month) => (
              <div key={month.label} className="mb-2 last:mb-0">
                <p className="text-muted-foreground px-2 py-1 text-[10px] font-medium tracking-wider uppercase">
                  {month.label}
                </p>
                {month.weeks.map(({ week, count }) => {
                  const isSelected = week.start.getTime() === selectedWeek.start.getTime();
                  return (
                    <button
                      key={week.start.toISOString()}
                      type="button"
                      onClick={() => {
                        onSelectWeek(week);
                        setOpen(false);
                      }}
                      className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-xs transition-colors ${
                        isSelected
                          ? 'bg-primary/10 text-primary'
                          : 'text-foreground hover:bg-surface-200'
                      }`}
                    >
                      <span>{week.label}</span>
                      <span
                        className={`tabular-nums ${count > 0 ? 'text-green-500' : 'text-muted-foreground'}`}
                      >
                        {count}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
          </ScrollArea>
        </PopoverContent>
      </Popover>

      <span
        className={`text-xs leading-none tabular-nums ${
          filteredCount > 0
            ? 'rounded-[4px] bg-green-500/10 px-1.5 py-0.5 text-green-500'
            : 'rounded-[4px] bg-[#2a2b2c] px-1.5 py-0.5 text-[#6b6d6f]'
        }`}
      >
        {filteredCount}
      </span>
    </div>
  );
}
