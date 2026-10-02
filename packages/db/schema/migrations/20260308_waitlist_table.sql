-- Waitlist table for email signups
-- Used by the marketing site (apps/web) waitlist form

CREATE TABLE IF NOT EXISTS public.waitlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  source text DEFAULT 'landing',
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  referrer text,
  ip_address inet,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'invited', 'converted')),
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Unique constraint on email to prevent duplicates
CREATE UNIQUE INDEX IF NOT EXISTS waitlist_email_unique ON public.waitlist (email);

-- Index for admin queries
CREATE INDEX IF NOT EXISTS waitlist_status_idx ON public.waitlist (status);
CREATE INDEX IF NOT EXISTS waitlist_created_at_idx ON public.waitlist (created_at DESC);

-- Enable RLS
ALTER TABLE public.waitlist ENABLE ROW LEVEL SECURITY;

-- Policy: Only service role can insert (via API route)
CREATE POLICY "Service role can insert waitlist entries"
  ON public.waitlist FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Policy: Only service role can read (admin dashboard)
CREATE POLICY "Service role can read waitlist"
  ON public.waitlist FOR SELECT
  TO service_role
  USING (true);

-- Policy: Only service role can update (status changes)
CREATE POLICY "Service role can update waitlist"
  ON public.waitlist FOR UPDATE
  TO service_role
  USING (true);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.update_waitlist_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER waitlist_updated_at
  BEFORE UPDATE ON public.waitlist
  FOR EACH ROW
  EXECUTE FUNCTION public.update_waitlist_updated_at();

-- Rollback:
-- DROP TRIGGER IF EXISTS waitlist_updated_at ON public.waitlist;
-- DROP FUNCTION IF EXISTS public.update_waitlist_updated_at();
-- DROP TABLE IF EXISTS public.waitlist;
