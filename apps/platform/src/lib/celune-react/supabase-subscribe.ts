import { createClient } from '@repo/db/client';
import type { RealtimeChange, SubscribeFn } from '@celuneai/react';

type SupabaseClient = ReturnType<typeof createClient>;

/** Supabase Realtime adapter for CeluneProvider: postgres_changes for tables, broadcast for channels. */
export function createSupabaseSubscribe(supabase: SupabaseClient = createClient()): SubscribeFn {
  return (channel, onChange) => {
    if (channel.broadcast) {
      const { event } = channel.broadcast;
      const ch = supabase
        .channel(channel.broadcast.channel)
        .on('broadcast', { event }, (payload) => {
          onChange({
            type: 'BROADCAST',
            new: payload.payload as Record<string, unknown>,
            old: null,
          });
        })
        .subscribe();
      return () => {
        supabase.removeChannel(ch);
      };
    }

    const table = channel.table ?? 'tasks';
    const filter = channel.filter
      ? `${channel.filter.column}=eq.${channel.filter.value}`
      : undefined;
    const ch = supabase
      .channel(`${table}-realtime${channel.filter ? `-${channel.filter.value}` : ''}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table, ...(filter ? { filter } : {}) },
        (payload) => {
          onChange({
            type: payload.eventType,
            new: (payload.new as Record<string, unknown>) ?? null,
            old: (payload.old as Record<string, unknown>) ?? null,
          } as RealtimeChange);
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  };
}
