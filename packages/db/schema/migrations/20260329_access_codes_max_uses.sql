-- ─────────────────────────────────────────────────────────────────────────────
-- Access codes: max_uses and uses columns
-- Enables multi-use codes (e.g., 50-use codes for events)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE access_codes ADD COLUMN IF NOT EXISTS max_uses INT NOT NULL DEFAULT 1;
ALTER TABLE access_codes ADD COLUMN IF NOT EXISTS uses INT NOT NULL DEFAULT 0;

-- Backfill: set uses=1 for already-redeemed codes
UPDATE access_codes SET uses = 1 WHERE redeemed_by IS NOT NULL AND uses = 0;
