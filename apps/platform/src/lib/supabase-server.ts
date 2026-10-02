/**
 * Re-exports the server-side Supabase client factory.
 * createClient() reads the session cookie and enforces RLS.
 * Use this in user-facing API routes instead of createServiceClient().
 */
export { createClient as getSupabaseServer } from '@repo/db/server';
