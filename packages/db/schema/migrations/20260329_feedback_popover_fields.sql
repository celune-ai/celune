-- ─────────────────────────────────────────────────────────────────────────────
-- Feedback Popover & Admin Inbox — new workflow columns
-- Project: ed75af80-651c-493f-aee0-26b7c5f0db7c
-- ─────────────────────────────────────────────────────────────────────────────

-- Category replaces type for the popover UI (bug_report, feature_request, general)
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'general'
  CHECK (category IN ('bug_report', 'feature_request', 'general'));

-- Priority for triage
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS priority TEXT DEFAULT 'normal'
  CHECK (priority IN ('low', 'normal', 'urgent'));

-- Claim/resolve workflow
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS claimed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;

-- Screenshot attachment URL (Supabase Storage public URL)
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS screenshot_url TEXT;

-- Session context captured at submission time
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS page_url TEXT;
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS user_agent TEXT;

-- Compound index for admin inbox filtering
CREATE INDEX IF NOT EXISTS idx_feedback_workspace_status_priority
  ON feedback (workspace_id, status, priority);

-- ─── Storage bucket for feedback screenshots ─────────────────────────────────
-- NOTE: Storage bucket must be created via Supabase Dashboard or API:
--   Name: feedback-screenshots
--   Public: true
--   File size limit: 5MB
--   Allowed MIME types: image/*
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('feedback-screenshots', 'feedback-screenshots', true, 5242880, ARRAY['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
ON CONFLICT (id) DO NOTHING;

-- Storage policy: authenticated users can upload to their own folder
CREATE POLICY "Users can upload feedback screenshots"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'feedback-screenshots'
    AND auth.role() = 'authenticated'
  );

-- Storage policy: anyone can read (public bucket)
CREATE POLICY "Public read feedback screenshots"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'feedback-screenshots');
