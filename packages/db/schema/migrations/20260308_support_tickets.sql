-- ─────────────────────────────────────────────────────────────────────────────
-- Support Tickets
-- Sprint 1 — Support & Contact System (task 35ce83e1)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS support_tickets (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  org_id       UUID,
  workspace_id UUID,
  email        TEXT        NOT NULL,
  name         TEXT,
  subject      TEXT        NOT NULL,
  message      TEXT        NOT NULL,
  category     TEXT        NOT NULL DEFAULT 'general'
               CHECK (category IN ('bug', 'feature', 'billing', 'general')),
  status       TEXT        NOT NULL DEFAULT 'open'
               CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
  priority     TEXT                 DEFAULT 'normal'
               CHECK (priority IN ('low', 'normal', 'urgent')),
  resolved_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Indexes ──────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS support_tickets_user_id_idx     ON support_tickets (user_id);
CREATE INDEX IF NOT EXISTS support_tickets_org_id_idx      ON support_tickets (org_id);
CREATE INDEX IF NOT EXISTS support_tickets_status_idx      ON support_tickets (status);
CREATE INDEX IF NOT EXISTS support_tickets_created_at_idx  ON support_tickets (created_at DESC);

-- ─── updated_at trigger ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_support_tickets_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER support_tickets_updated_at
  BEFORE UPDATE ON support_tickets
  FOR EACH ROW EXECUTE FUNCTION update_support_tickets_updated_at();

-- ─── Row-Level Security ───────────────────────────────────────────────────────

ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;

-- Authenticated users can view their own tickets
CREATE POLICY "Users can view own tickets"
  ON support_tickets
  FOR SELECT
  USING (auth.uid() = user_id);

-- Users can create tickets (authenticated or anonymous via API)
CREATE POLICY "Users can create tickets"
  ON support_tickets
  FOR INSERT
  WITH CHECK (auth.uid() = user_id OR user_id IS NULL);

-- Service role has full unrestricted access (for admin/agent responses)
CREATE POLICY "Service role full access"
  ON support_tickets
  FOR ALL
  USING (auth.role() = 'service_role');
