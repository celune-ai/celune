-- Make incoming_webhook_url nullable
-- ─────────────────────────────────────────────────────────────────────────────
-- Bot token installs don't have an incoming webhook URL. Previously we stored
-- a magic string placeholder ('bot-token-install') to satisfy NOT NULL. Now
-- the column is properly nullable — bot installs store NULL.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.slack_connections
  ALTER COLUMN incoming_webhook_url DROP NOT NULL;

-- Clean up existing placeholder values
UPDATE public.slack_connections
  SET incoming_webhook_url = NULL
  WHERE incoming_webhook_url = 'bot-token-install';

COMMENT ON COLUMN public.slack_connections.incoming_webhook_url IS
  'Slack Incoming Webhook URL. NULL for bot-token installs. Treat as secret — being replaced by encrypted_webhook_url.';
