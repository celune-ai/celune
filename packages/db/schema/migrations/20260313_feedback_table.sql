-- ─────────────────────────────────────────────────────────────────────────────
-- Feedback table
-- Support Hub — Separation & Permission Gating (task 1614a503)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS feedback (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  workspace_id    UUID,
  name            TEXT,
  email           TEXT        NOT NULL,
  subject         TEXT        NOT NULL,
  message         TEXT        NOT NULL,
  type            TEXT                 DEFAULT 'general'
                  CHECK (type IN ('general', 'feature_request', 'improvement', 'praise', 'complaint')),
  rating          INT                  CHECK (rating IS NULL OR (rating >= 1 AND rating <= 5)),
  status          TEXT        NOT NULL DEFAULT 'new'
                  CHECK (status IN ('new', 'reviewed', 'actioned', 'archived')),
  internal_notes  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Indexes ──────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS feedback_user_id_idx      ON feedback (user_id);
CREATE INDEX IF NOT EXISTS feedback_workspace_id_idx ON feedback (workspace_id);
CREATE INDEX IF NOT EXISTS feedback_status_idx       ON feedback (status);
CREATE INDEX IF NOT EXISTS feedback_type_idx         ON feedback (type);
CREATE INDEX IF NOT EXISTS feedback_created_at_idx   ON feedback (created_at DESC);

-- ─── updated_at trigger ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_feedback_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER feedback_updated_at
  BEFORE UPDATE ON feedback
  FOR EACH ROW EXECUTE FUNCTION update_feedback_updated_at();

-- ─── Row-Level Security ───────────────────────────────────────────────────────

ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;

-- Authenticated users can create their own feedback
CREATE POLICY "Users can create feedback"
  ON feedback
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can view their own feedback
CREATE POLICY "Users can view own feedback"
  ON feedback
  FOR SELECT
  USING (auth.uid() = user_id);

-- Service role has full unrestricted access (for admin/platform owner operations)
CREATE POLICY "Service role full access"
  ON feedback
  FOR ALL
  USING (auth.role() = 'service_role');
