-- ─────────────────────────────────────────────────────────────────────────────
-- Feature flags: ON/OFF screenshot URLs for visual reference
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE feature_flags ADD COLUMN IF NOT EXISTS screenshot_on TEXT;
ALTER TABLE feature_flags ADD COLUMN IF NOT EXISTS screenshot_off TEXT;
