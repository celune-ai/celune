// Dot Voter types — real-time collaborative dot voting / prioritization
// Project: P3 - Platform: Dot Voter

// ============================================================
// ENUMS & CONSTANTS
// ============================================================

export const DOT_VOTER_ROOM_STATUSES = ['open', 'closed', 'archived'] as const;
export type DotVoterRoomStatus = (typeof DOT_VOTER_ROOM_STATUSES)[number];

/** Minimum and maximum dot limit per room (enforced in DB CHECK + API) */
export const DOT_VOTER_LIMITS = {
  MIN_DOT_LIMIT: 1,
  MAX_DOT_LIMIT: 20,
  MIN_ITEMS: 1,
  MAX_ITEMS_DEFAULT: 50,
} as const;

// ============================================================
// CORE ENTITIES
// ============================================================

export interface DotVoterRoom {
  id: string;
  workspace_id: string | null;
  created_by: string | null;
  title: string;
  description: string | null;
  status: DotVoterRoomStatus;
  /** Max total dots each voter can place across all items */
  dot_limit: number;
  /** If true, voter_name is never returned in results */
  anonymous_voting: boolean;
  /** If true, users without a Celune account can vote via share link */
  allow_guest_votes: boolean;
  /** URL-safe token for public share link — never expose in list endpoints */
  share_token: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
}

export interface DotVoterItem {
  id: string;
  room_id: string;
  title: string;
  description: string | null;
  sort_order: number;
  created_at: string;
}

export interface DotVoterVote {
  id: string;
  room_id: string;
  item_id: string;
  /** null for guest voters */
  voter_id: string | null;
  /** display name; null if anonymous_voting = true on the room */
  voter_name: string | null;
  /** UUID generated client-side for guest dedup (stored in localStorage) */
  voter_session_token: string | null;
  /** dots placed on this item by this voter */
  dot_count: number;
  created_at: string;
  updated_at: string;
}

// ============================================================
// INSERTS / UPDATES
// ============================================================

export type DotVoterRoomInsert = Pick<
  DotVoterRoom,
  'workspace_id' | 'title' | 'description' | 'dot_limit' | 'anonymous_voting' | 'allow_guest_votes'
>;

export type DotVoterRoomUpdate = Partial<
  Pick<
    DotVoterRoom,
    'title' | 'description' | 'status' | 'dot_limit' | 'anonymous_voting' | 'allow_guest_votes'
  >
>;

export type DotVoterItemInsert = Pick<
  DotVoterItem,
  'room_id' | 'title' | 'description' | 'sort_order'
>;
export type DotVoterItemUpdate = Partial<
  Pick<DotVoterItem, 'title' | 'description' | 'sort_order'>
>;

/** Payload for POST /api/dot-voter/vote */
export interface DotVoterCastVotePayload {
  /** share_token of the room (used as auth for guest voters) */
  share_token: string;
  item_id: string;
  /** number of dots to place on this item (0 = remove vote) */
  dot_count: number;
  /** generated client-side UUID, persisted in localStorage */
  voter_session_token: string;
  /** optional display name (used if room.anonymous_voting = false) */
  voter_name?: string;
}

// ============================================================
// RESULTS / AGGREGATES
// ============================================================

export interface DotVoterItemResult {
  item: DotVoterItem;
  /** sum of dot_count across all voters for this item */
  vote_count: number;
  /** count of distinct voters who placed dots on this item */
  voter_count: number;
}

export interface DotVoterRoomResults {
  room: DotVoterRoom;
  /** items sorted by vote_count descending */
  items: DotVoterItemResult[];
  /** count of distinct voters in this room */
  total_voters: number;
  /** sum of all dots cast */
  total_dots: number;
}

/** Summary for room list views (no share_token exposed) */
export interface DotVoterRoomSummary {
  id: string;
  title: string;
  description: string | null;
  status: DotVoterRoomStatus;
  dot_limit: number;
  anonymous_voting: boolean;
  allow_guest_votes: boolean;
  item_count: number;
  voter_count: number;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
}

// ============================================================
// PUBLIC VOTING PAGE (via RPC: get_dot_voter_room_by_token)
// ============================================================

export interface DotVoterPublicRoom {
  room_id: string;
  title: string;
  description: string | null;
  status: DotVoterRoomStatus;
  dot_limit: number;
  anonymous_voting: boolean;
  allow_guest_votes: boolean;
  items: Array<{
    id: string;
    title: string;
    description: string | null;
    sort_order: number;
  }>;
}

/** Voter's current state in a session (tracked client-side + synced to server) */
export interface DotVoterSession {
  voter_session_token: string;
  voter_name: string | null;
  /** map of item_id → dot_count */
  votes: Record<string, number>;
  /** dots remaining = room.dot_limit - sum(votes values) */
  dots_remaining: number;
  submitted: boolean;
}
