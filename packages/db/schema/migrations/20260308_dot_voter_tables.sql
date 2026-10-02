-- Dot Voter: real-time collaborative dot voting / prioritization
-- Project: P3 - Platform: Dot Voter
-- Author: RICK (2026-03-08)
--
-- Three tables:
--   dot_voter_rooms  — voting sessions created by facilitators
--   dot_voter_items  — items being voted on within a room
--   dot_voter_votes  — individual votes (dots) cast by participants
--
-- Auth model:
--   Facilitators = authenticated Celune users (workspace members)
--   Voters       = authenticated users OR guests (no Celune account required)
--   Access gate  = share_token for public room access
--
-- RLS design:
--   All writes go through API routes using service client.
--   Direct client reads allowed with share_token via DB function.
--   Votes table is fully service-role-only (dot_limit enforced in API).

-- ============================================================
-- ENUMS
-- ============================================================

DO $$ BEGIN
  CREATE TYPE dot_voter_room_status AS ENUM ('open', 'closed', 'archived');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- TABLE: dot_voter_rooms
-- ============================================================

CREATE TABLE IF NOT EXISTS public.dot_voter_rooms (
  id                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        uuid          REFERENCES public.workspaces(id) ON DELETE CASCADE,
  created_by          uuid          REFERENCES auth.users(id) ON DELETE SET NULL,
  title               text          NOT NULL,
  description         text,
  status              dot_voter_room_status NOT NULL DEFAULT 'open',
  dot_limit           integer       NOT NULL DEFAULT 3 CHECK (dot_limit BETWEEN 1 AND 20),
  anonymous_voting    boolean       NOT NULL DEFAULT false,
  allow_guest_votes   boolean       NOT NULL DEFAULT true,
  -- share_token: 16 URL-safe base64 chars from 12 random bytes = 96 bits entropy
  share_token         text          UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(12), 'base64') ,
  metadata            jsonb,
  created_at          timestamptz   NOT NULL DEFAULT now(),
  updated_at          timestamptz   NOT NULL DEFAULT now(),
  closed_at           timestamptz
);

-- Indexes
CREATE INDEX IF NOT EXISTS dot_voter_rooms_workspace_id_idx
  ON public.dot_voter_rooms (workspace_id);

CREATE INDEX IF NOT EXISTS dot_voter_rooms_created_by_idx
  ON public.dot_voter_rooms (created_by);

CREATE INDEX IF NOT EXISTS dot_voter_rooms_status_idx
  ON public.dot_voter_rooms (status);

CREATE INDEX IF NOT EXISTS dot_voter_rooms_share_token_idx
  ON public.dot_voter_rooms (share_token);

-- auto-update updated_at
CREATE OR REPLACE FUNCTION public.update_dot_voter_rooms_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS dot_voter_rooms_updated_at ON public.dot_voter_rooms;
CREATE TRIGGER dot_voter_rooms_updated_at
  BEFORE UPDATE ON public.dot_voter_rooms
  FOR EACH ROW
  EXECUTE FUNCTION public.update_dot_voter_rooms_updated_at();

-- ============================================================
-- TABLE: dot_voter_items
-- ============================================================

CREATE TABLE IF NOT EXISTS public.dot_voter_items (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id     uuid        NOT NULL REFERENCES public.dot_voter_rooms(id) ON DELETE CASCADE,
  title       text        NOT NULL,
  description text,
  sort_order  integer     NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dot_voter_items_room_id_idx
  ON public.dot_voter_items (room_id, sort_order);

-- ============================================================
-- TABLE: dot_voter_votes
-- ============================================================

CREATE TABLE IF NOT EXISTS public.dot_voter_votes (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id               uuid        NOT NULL REFERENCES public.dot_voter_rooms(id) ON DELETE CASCADE,
  item_id               uuid        NOT NULL REFERENCES public.dot_voter_items(id) ON DELETE CASCADE,
  -- voter_id: set for authenticated Celune users
  voter_id              uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  -- voter_name: display name (guest-supplied or from profile)
  voter_name            text,
  -- voter_session_token: UUID generated client-side, stored in localStorage for guest dedup
  voter_session_token   text,
  -- dot_count: number of dots this voter placed on this item (1..dot_limit)
  dot_count             integer     NOT NULL DEFAULT 1 CHECK (dot_count >= 0),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  -- One row per authenticated user per item
  UNIQUE (item_id, voter_id),
  -- One row per guest session per item
  UNIQUE (item_id, voter_session_token)
);

CREATE INDEX IF NOT EXISTS dot_voter_votes_room_id_idx
  ON public.dot_voter_votes (room_id);

CREATE INDEX IF NOT EXISTS dot_voter_votes_item_id_idx
  ON public.dot_voter_votes (item_id);

CREATE INDEX IF NOT EXISTS dot_voter_votes_voter_id_idx
  ON public.dot_voter_votes (voter_id) WHERE voter_id IS NOT NULL;

-- auto-update updated_at
CREATE OR REPLACE FUNCTION public.update_dot_voter_votes_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS dot_voter_votes_updated_at ON public.dot_voter_votes;
CREATE TRIGGER dot_voter_votes_updated_at
  BEFORE UPDATE ON public.dot_voter_votes
  FOR EACH ROW
  EXECUTE FUNCTION public.update_dot_voter_votes_updated_at();

-- ============================================================
-- RLS
-- ============================================================

ALTER TABLE public.dot_voter_rooms  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dot_voter_items  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dot_voter_votes  ENABLE ROW LEVEL SECURITY;

-- ---- dot_voter_rooms policies ----

-- Service role: full access (used by all API routes)
CREATE POLICY "Service role full access on dot_voter_rooms"
  ON public.dot_voter_rooms
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Authenticated users: read rooms in their workspaces
CREATE POLICY "Workspace members can read their rooms"
  ON public.dot_voter_rooms
  FOR SELECT
  TO authenticated
  USING (
    workspace_id IN (
      SELECT id FROM public.workspaces
      WHERE org_id IN (
        SELECT org_id FROM public.org_members
        WHERE user_id = auth.uid()
      )
    )
  );

-- ---- dot_voter_items policies ----

-- Service role: full access
CREATE POLICY "Service role full access on dot_voter_items"
  ON public.dot_voter_items
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Authenticated users: read items for rooms they can access
CREATE POLICY "Authenticated users can read items for their rooms"
  ON public.dot_voter_items
  FOR SELECT
  TO authenticated
  USING (
    room_id IN (
      SELECT id FROM public.dot_voter_rooms
      WHERE workspace_id IN (
        SELECT id FROM public.workspaces
        WHERE org_id IN (
          SELECT org_id FROM public.org_members
          WHERE user_id = auth.uid()
        )
      )
    )
  );

-- ---- dot_voter_votes policies ----

-- Service role: full access (all vote operations go through API)
CREATE POLICY "Service role full access on dot_voter_votes"
  ON public.dot_voter_votes
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Authenticated facilitators: read votes for their rooms
CREATE POLICY "Facilitators can read votes for their rooms"
  ON public.dot_voter_votes
  FOR SELECT
  TO authenticated
  USING (
    room_id IN (
      SELECT id FROM public.dot_voter_rooms
      WHERE created_by = auth.uid()
        OR workspace_id IN (
          SELECT id FROM public.workspaces
          WHERE org_id IN (
            SELECT org_id FROM public.org_members
            WHERE user_id = auth.uid()
          )
        )
    )
  );

-- ============================================================
-- HELPER RPC: get_dot_voter_room_by_token
-- Used by public voting pages to load room+items without Celune auth
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_dot_voter_room_by_token(p_share_token text)
RETURNS TABLE (
  room_id           uuid,
  title             text,
  description       text,
  status            dot_voter_room_status,
  dot_limit         integer,
  anonymous_voting  boolean,
  allow_guest_votes boolean,
  item_id           uuid,
  item_title        text,
  item_description  text,
  item_sort_order   integer
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    r.id               AS room_id,
    r.title,
    r.description,
    r.status,
    r.dot_limit,
    r.anonymous_voting,
    r.allow_guest_votes,
    i.id               AS item_id,
    i.title            AS item_title,
    i.description      AS item_description,
    i.sort_order       AS item_sort_order
  FROM dot_voter_rooms r
  LEFT JOIN dot_voter_items i ON i.room_id = r.id
  WHERE r.share_token = p_share_token
  ORDER BY i.sort_order ASC;
$$;

-- ============================================================
-- ROLLBACK (keep for reference)
-- ============================================================
-- DROP FUNCTION IF EXISTS public.get_dot_voter_room_by_token(text);
-- DROP TRIGGER IF EXISTS dot_voter_votes_updated_at ON public.dot_voter_votes;
-- DROP TRIGGER IF EXISTS dot_voter_rooms_updated_at ON public.dot_voter_rooms;
-- DROP FUNCTION IF EXISTS public.update_dot_voter_votes_updated_at();
-- DROP FUNCTION IF EXISTS public.update_dot_voter_rooms_updated_at();
-- DROP TABLE IF EXISTS public.dot_voter_votes;
-- DROP TABLE IF EXISTS public.dot_voter_items;
-- DROP TABLE IF EXISTS public.dot_voter_rooms;
-- DROP TYPE IF EXISTS dot_voter_room_status;
