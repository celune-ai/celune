-- Enable FULL replica identity on tasks table so Supabase Realtime
-- can properly filter UPDATE/DELETE events by workspace_id.
-- Without this, workspace-scoped realtime subscriptions miss updates.
--
-- PERF NOTE: REPLICA IDENTITY FULL writes the entire old row into WAL
-- on every UPDATE/DELETE, increasing WAL size proportionally to row width.
-- For the tasks table (~30 columns), this adds ~2-4 KB per mutation to WAL.
-- Acceptable tradeoff for correct realtime filtering. Monitor WAL size in
-- Supabase Dashboard > Database > Replication if write volume spikes.
ALTER TABLE public.tasks REPLICA IDENTITY FULL;
