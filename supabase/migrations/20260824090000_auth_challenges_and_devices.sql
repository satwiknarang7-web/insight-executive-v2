-- Two-factor sign-in: emailed one-time codes, and the devices that have passed one.
--
-- Both tables live in `app_private` for the same reason the credential vault
-- does: that schema is not exposed through PostgREST, its grants are revoked,
-- and RLS with zero policies denies every role that does not bypass it. Only
-- the service role — held solely by the server — can read either table.
--
-- That matters more here than it looks. A code hash is low-entropy by nature
-- (six digits), and a device token hash is a bearer credential: either one
-- readable from the browser would defeat the second factor entirely.

create table app_private.auth_challenges (
  id           uuid primary key default gen_random_uuid(),
  -- The address is stored alongside the user id because a sign-up challenge
  -- exists before the account is confirmed, and lookups happen by address.
  email        text not null,
  user_id      uuid references auth.users(id) on delete cascade,
  purpose      text not null check (purpose in ('signup', 'signin')),
  -- HMAC-SHA256 of the code under a server-held pepper. Never the code itself:
  -- a million-entry search space is not protected by a bare hash.
  code_hash    text not null,
  attempts     integer not null default 0,
  created_at   timestamptz not null default now(),
  last_sent_at timestamptz not null default now(),
  expires_at   timestamptz not null,
  consumed_at  timestamptz
);

create index auth_challenges_email_idx on app_private.auth_challenges (email);
create index auth_challenges_expires_idx on app_private.auth_challenges (expires_at);

revoke all on app_private.auth_challenges from public;
revoke all on app_private.auth_challenges from anon, authenticated;
alter table app_private.auth_challenges enable row level security;

create table app_private.trusted_devices (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  -- SHA-256 of a 256-bit random token. Unique so a lookup by digest is a
  -- single index probe, and so the same token cannot be registered twice.
  token_hash   text not null unique,
  label        text,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at   timestamptz not null
);

create index trusted_devices_user_idx on app_private.trusted_devices (user_id);

revoke all on app_private.trusted_devices from public;
revoke all on app_private.trusted_devices from anon, authenticated;
alter table app_private.trusted_devices enable row level security;

comment on table app_private.auth_challenges is
  'Pending one-time codes for sign-up and sign-in. Server-only, service-role access.';
comment on table app_private.trusted_devices is
  'Browsers that have passed a code and may skip the second factor until expiry.';
