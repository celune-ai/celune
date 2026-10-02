-- Celune Cloud pricing: one per-seat plan (`cloud`) plus Enterprise (set by hand).
--
-- 1. subscriptions: created when missing (the hosted project never had it), with
--    `seats` and `billing_interval` for the Stripe webhook to store.
-- 2. Stored plan names builder, pro, unlimited, team, build, and free become `cloud`
--    on subscriptions and access_codes. access_codes.plan accepts cloud or enterprise.
-- 3. check_memory_quota no longer caps memories; no plan has a memory limit.
-- 4. get_memory_ttl_days reads the new plan names: no plan expires memories.
--
-- Idempotent: every step checks what exists or rewrites to the same result.

-- ── 1. subscriptions ─────────────────────────────────────────────────────────

DO $$
BEGIN
  IF to_regclass('public.subscriptions') IS NULL THEN
    CREATE TABLE public.subscriptions (
      id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
      user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      stripe_customer_id text,
      stripe_subscription_id text,
      plan text DEFAULT 'cloud'::text NOT NULL,
      status text DEFAULT 'active'::text NOT NULL,
      current_period_start timestamp with time zone,
      current_period_end timestamp with time zone,
      created_at timestamp with time zone DEFAULT now() NOT NULL,
      updated_at timestamp with time zone DEFAULT now() NOT NULL
    );
    CREATE UNIQUE INDEX subscriptions_user_id_unique ON public.subscriptions USING btree (user_id);

    ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
    CREATE POLICY users_read_own_subscription ON public.subscriptions
      FOR SELECT USING ((auth.uid() = user_id));
    CREATE POLICY service_manage_subscriptions ON public.subscriptions
      USING ((auth.role() = 'service_role'::text))
      WITH CHECK ((auth.role() = 'service_role'::text));

    REVOKE ALL ON TABLE public.subscriptions FROM PUBLIC, anon, authenticated;
    GRANT SELECT ON TABLE public.subscriptions TO authenticated;
    GRANT ALL ON TABLE public.subscriptions TO service_role;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_subscriptions_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS subscriptions_updated_at ON public.subscriptions;
CREATE TRIGGER subscriptions_updated_at BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.update_subscriptions_updated_at();

ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS seats integer;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS billing_interval text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'subscriptions_seats_check' AND conrelid = 'public.subscriptions'::regclass
  ) THEN
    ALTER TABLE public.subscriptions
      ADD CONSTRAINT subscriptions_seats_check CHECK (seats IS NULL OR seats >= 1);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'subscriptions_billing_interval_check'
      AND conrelid = 'public.subscriptions'::regclass
  ) THEN
    ALTER TABLE public.subscriptions
      ADD CONSTRAINT subscriptions_billing_interval_check
      CHECK (billing_interval IS NULL OR billing_interval = ANY (ARRAY['month'::text, 'year'::text]));
  END IF;
END;
$$;

-- ── 2. Plan names ────────────────────────────────────────────────────────────

UPDATE public.subscriptions
SET plan = 'cloud'
WHERE plan = ANY (ARRAY['builder', 'pro', 'unlimited', 'team', 'build', 'free']);

ALTER TABLE public.subscriptions ALTER COLUMN plan SET DEFAULT 'cloud';

DO $$
BEGIN
  IF to_regclass('public.access_codes') IS NOT NULL THEN
    ALTER TABLE public.access_codes DROP CONSTRAINT IF EXISTS access_codes_plan_check;
    UPDATE public.access_codes SET plan = 'cloud' WHERE plan IS DISTINCT FROM 'enterprise';
    ALTER TABLE public.access_codes ALTER COLUMN plan SET DEFAULT 'cloud';
    ALTER TABLE public.access_codes
      ADD CONSTRAINT access_codes_plan_check
      CHECK (plan = ANY (ARRAY['cloud'::text, 'enterprise'::text]));
  END IF;
END;
$$;

-- ── 3. Memory quota ──────────────────────────────────────────────────────────

-- Kept as the agent_memory_quota_check trigger body so a cap can come back
-- without a schema change; today no plan caps memories.
CREATE OR REPLACE FUNCTION public.check_memory_quota() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  RETURN NEW;
END;
$$;

-- ── 4. Memory TTL by plan ────────────────────────────────────────────────────

-- -1 means memories never expire. Every plan (cloud, enterprise, platform_owner,
-- and the legacy names that now mean cloud) keeps memories.
CREATE OR REPLACE FUNCTION public.get_memory_ttl_days(p_workspace_id uuid) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = public, extensions
    AS $$
BEGIN
  RETURN -1;
END;
$$;
