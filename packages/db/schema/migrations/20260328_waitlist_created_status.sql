-- Add 'created' status for waitlist entries where the user has created an account
-- Triggered when a provisioned user redeems their access code

ALTER TABLE public.waitlist DROP CONSTRAINT IF EXISTS waitlist_status_check;
ALTER TABLE public.waitlist
  ADD CONSTRAINT waitlist_status_check
  CHECK (status IN ('pending', 'confirmed', 'invited', 'converted', 'provisioned', 'rejected', 'referred', 'created'));

-- Rollback:
-- ALTER TABLE public.waitlist DROP CONSTRAINT IF EXISTS waitlist_status_check;
-- ALTER TABLE public.waitlist ADD CONSTRAINT waitlist_status_check CHECK (status IN ('pending', 'confirmed', 'invited', 'converted', 'provisioned', 'rejected', 'referred'));
