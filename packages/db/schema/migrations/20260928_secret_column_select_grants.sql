-- 20260308_provider_api_keys.sql, 20260311_encrypt_slack_webhook_urls.sql, and
-- 20260319_slack_bot_tokens_and_conversations.sql revoked SELECT on secret columns from
-- authenticated. A column revoke has no effect while the role holds SELECT on the whole table,
-- and Supabase grants ALL on every public table to anon and authenticated, so RLS-visible rows
-- still returned the ciphertext and IVs.
--
-- This takes table-level SELECT away from both roles and grants authenticated SELECT on every
-- column except the secret ones, so RLS keeps deciding which rows a user sees and the secret
-- columns stay unreadable. anon loses every privilege on both tables; no anon path reads them.
-- The platform reads both tables through the service client, which keeps full access.
-- Columns added later are not readable by authenticated until granted here.

DO $$
DECLARE
  target record;
  readable text;
BEGIN
  FOR target IN
    SELECT *
    FROM (VALUES
      ('provider_api_keys', ARRAY['encrypted_key', 'key_iv']),
      ('slack_connections', ARRAY['incoming_webhook_url', 'encrypted_webhook_url', 'webhook_iv',
                                  'bot_token_encrypted', 'bot_token_iv'])
    ) AS t(tbl, secret_columns)
  LOOP
    -- Skip tables an older database never created.
    IF to_regclass(format('public.%I', target.tbl)) IS NULL THEN
      CONTINUE;
    END IF;

    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', target.tbl);
    -- Also drops the column-level SELECT grants, so the grant below is the whole list.
    EXECUTE format('REVOKE SELECT ON TABLE public.%I FROM authenticated', target.tbl);

    SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum)
    INTO readable
    FROM pg_attribute a
    WHERE a.attrelid = format('public.%I', target.tbl)::regclass
      AND a.attnum > 0
      AND NOT a.attisdropped
      AND a.attname <> ALL (target.secret_columns);

    EXECUTE format('GRANT SELECT (%s) ON TABLE public.%I TO authenticated', readable, target.tbl);
  END LOOP;
END;
$$;
