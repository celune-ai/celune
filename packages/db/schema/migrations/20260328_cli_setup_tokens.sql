-- One-time setup codes for CLI authentication
-- Short-lived (5 min), single-use, never stores the actual API key
CREATE TABLE IF NOT EXISTS public.cli_setup_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '5 minutes'),
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_cli_setup_tokens_code ON public.cli_setup_tokens(code) WHERE used_at IS NULL;
CREATE INDEX idx_cli_setup_tokens_expires ON public.cli_setup_tokens(expires_at);

ALTER TABLE public.cli_setup_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own setup tokens"
  ON public.cli_setup_tokens
  FOR ALL
  USING (user_id = auth.uid());
