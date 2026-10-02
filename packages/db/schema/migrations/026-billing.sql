-- Migration 026: Billing tables (subscriptions + usage_records)
-- Stripe keys are not required; everything works in free-plan mode without them.

CREATE TABLE IF NOT EXISTS subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_customer_id text,
  stripe_subscription_id text,
  plan text NOT NULL DEFAULT 'free',   -- free | pro | team
  status text NOT NULL DEFAULT 'active', -- active | canceled | past_due
  current_period_start timestamptz,
  current_period_end timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_user_id_unique ON subscriptions(user_id);

CREATE TABLE IF NOT EXISTS usage_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  feature text NOT NULL,  -- ai_chat | tts | image_gen
  count integer NOT NULL DEFAULT 1,
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS usage_records_user_feature ON usage_records(user_id, feature);
CREATE INDEX IF NOT EXISTS usage_records_period ON usage_records(period_start, period_end);

-- Auto-update updated_at on subscriptions
CREATE OR REPLACE FUNCTION update_subscriptions_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS subscriptions_updated_at ON subscriptions;
CREATE TRIGGER subscriptions_updated_at
  BEFORE UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION update_subscriptions_updated_at();

-- RLS
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_records ENABLE ROW LEVEL SECURITY;

-- Users can read their own subscription
CREATE POLICY "users_read_own_subscription"
  ON subscriptions FOR SELECT
  USING (auth.uid() = user_id);

-- Service role can do anything (for webhook handler + usage tracking)
CREATE POLICY "service_manage_subscriptions"
  ON subscriptions FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "users_read_own_usage"
  ON usage_records FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "service_manage_usage"
  ON usage_records FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
