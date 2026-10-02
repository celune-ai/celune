-- Add referral tracking columns to waitlist
-- Enables: referral invites, attribution, admin filtering

-- Add referral columns
ALTER TABLE public.waitlist
  ADD COLUMN IF NOT EXISTS referral_code text,
  ADD COLUMN IF NOT EXISTS referred_by uuid REFERENCES public.waitlist(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS referral_count integer DEFAULT 0 NOT NULL,
  ADD COLUMN IF NOT EXISTS priority boolean DEFAULT false NOT NULL;

-- Update status constraint to include provisioned, rejected, referred
ALTER TABLE public.waitlist DROP CONSTRAINT IF EXISTS waitlist_status_check;
ALTER TABLE public.waitlist
  ADD CONSTRAINT waitlist_status_check
  CHECK (status IN ('pending', 'confirmed', 'invited', 'converted', 'provisioned', 'rejected', 'referred'));

-- Generate referral codes for existing entries that don't have one
UPDATE public.waitlist
SET referral_code = upper(encode(gen_random_bytes(6), 'hex'))
WHERE referral_code IS NULL;

-- Unique index on referral_code
CREATE UNIQUE INDEX IF NOT EXISTS waitlist_referral_code_unique ON public.waitlist (referral_code);

-- Index for finding referred entries
CREATE INDEX IF NOT EXISTS waitlist_referred_by_idx ON public.waitlist (referred_by);

-- Service role can delete (for admin cleanup)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'waitlist' AND policyname = 'Service role can delete waitlist'
  ) THEN
    CREATE POLICY "Service role can delete waitlist"
      ON public.waitlist FOR DELETE
      TO service_role
      USING (true);
  END IF;
END $$;

-- Rollback:
-- ALTER TABLE public.waitlist DROP CONSTRAINT IF EXISTS waitlist_status_check;
-- ALTER TABLE public.waitlist ADD CONSTRAINT waitlist_status_check CHECK (status IN ('pending', 'confirmed', 'invited', 'converted'));
-- DROP INDEX IF EXISTS waitlist_referred_by_idx;
-- DROP INDEX IF EXISTS waitlist_referral_code_unique;
-- ALTER TABLE public.waitlist DROP COLUMN IF EXISTS priority;
-- ALTER TABLE public.waitlist DROP COLUMN IF EXISTS referral_count;
-- ALTER TABLE public.waitlist DROP COLUMN IF EXISTS referred_by;
-- ALTER TABLE public.waitlist DROP COLUMN IF EXISTS referral_code;
