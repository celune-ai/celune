-- Access codes: owner-generated codes granting unlimited free access
CREATE TABLE IF NOT EXISTS access_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  redeemed_by uuid REFERENCES auth.users(id),
  redeemed_at timestamptz,
  revoked_at timestamptz,
  note text, -- optional label like "for Jake"
  created_at timestamptz NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE access_codes ENABLE ROW LEVEL SECURITY;

-- Owner (creator) can see all their codes
CREATE POLICY "owner_select" ON access_codes FOR SELECT
  USING (auth.uid() = created_by);

-- Redeemer can see codes they redeemed
CREATE POLICY "redeemer_select" ON access_codes FOR SELECT
  USING (auth.uid() = redeemed_by);

-- Owner can insert new codes
CREATE POLICY "owner_insert" ON access_codes FOR INSERT
  WITH CHECK (auth.uid() = created_by);

-- Owner can update (revoke) their codes
CREATE POLICY "owner_update" ON access_codes FOR UPDATE
  USING (auth.uid() = created_by);

-- Index for plan resolution lookups
CREATE INDEX idx_access_codes_redeemed_by ON access_codes (redeemed_by) WHERE redeemed_by IS NOT NULL AND revoked_at IS NULL;
