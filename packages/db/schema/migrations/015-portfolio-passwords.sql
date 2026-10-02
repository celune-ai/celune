-- Portfolio Auth Consolidation
-- Creates tables for portfolio password management and rate limiting
-- No RLS needed: admin app uses service role key (bypasses RLS)

-- portfolio_passwords: stores encrypted portfolio access passwords
create table if not exists portfolio_passwords (
  id uuid primary key default gen_random_uuid(),
  project_id text not null,
  project_title text not null,
  password_hash text not null, -- format: {hex-salt}:{hex-hash}
  title text, -- optional label
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- unique constraint on project_id + password_hash to prevent duplicates
create unique index if not exists idx_portfolio_passwords_project_hash
  on portfolio_passwords (project_id, password_hash);

-- rate_limits: tracks failed password attempts per client
create table if not exists rate_limits (
  client_id text primary key,
  attempts int default 0,
  blocked boolean default false,
  first_attempt_at timestamptz,
  last_attempt_at timestamptz
);
