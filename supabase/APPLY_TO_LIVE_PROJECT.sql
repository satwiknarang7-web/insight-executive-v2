-- ===========================================================================
-- RUN THIS IN THE SQL EDITOR OF THE PROJECT YOUR APP USES (epqrforyglcrzsyomcpu).
--   https://supabase.com/dashboard/project/epqrforyglcrzsyomcpu/sql/new
--
-- Part 1 adds two-factor sign-in. It has no prerequisites and always runs.
-- Part 2 fixes the credential vault, and is skipped with a notice if this
-- project has not had the vault migrations applied — so a half-set-up project
-- still gets working sign-in rather than an all-or-nothing failure.
--
-- Safe to run more than once.
-- ===========================================================================

create schema if not exists app_private;

-- ===========================================================================
-- PART 1 — two-factor sign-in (always applies)
-- ===========================================================================

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

create table if not exists app_private.auth_challenges (
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

create index if not exists auth_challenges_email_idx on app_private.auth_challenges (email);
create index if not exists auth_challenges_expires_idx on app_private.auth_challenges (expires_at);

revoke all on app_private.auth_challenges from public;
revoke all on app_private.auth_challenges from anon, authenticated;
alter table app_private.auth_challenges enable row level security;

create table if not exists app_private.trusted_devices (
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

create index if not exists trusted_devices_user_idx on app_private.trusted_devices (user_id);

revoke all on app_private.trusted_devices from public;
revoke all on app_private.trusted_devices from anon, authenticated;
alter table app_private.trusted_devices enable row level security;

comment on table app_private.auth_challenges is
  'Pending one-time codes for sign-up and sign-in. Server-only, service-role access.';
comment on table app_private.trusted_devices is
  'Browsers that have passed a code and may skip the second factor until expiry.';


-- ---------------------------------------------------------------------------
-- Two-factor challenges
-- ---------------------------------------------------------------------------

-- Opening a challenge closes any other open one for the same address. Two live
-- codes in one inbox is a real failure mode: the user reads the older email and
-- is told a correct-looking code is wrong, with no way to tell why.
create or replace function public.svc_challenge_create(
  p_email      text,
  p_user_id    uuid,
  p_purpose    text,
  p_code_hash  text,
  p_expires_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = app_private, pg_catalog
as $$
declare
  v_id uuid;
begin
  update app_private.auth_challenges
     set consumed_at = now()
   where email = p_email and consumed_at is null;

  insert into app_private.auth_challenges (email, user_id, purpose, code_hash, expires_at)
  values (p_email, p_user_id, p_purpose, p_code_hash, p_expires_at)
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.svc_challenge_create from public, anon, authenticated;
grant execute on function public.svc_challenge_create to service_role;

-- Never returns code_hash: the caller has no legitimate use for it, and the
-- claim below is what does the comparison.
create or replace function public.svc_challenge_get(p_id uuid)
returns table (
  id uuid, email text, user_id uuid, purpose text, attempts integer,
  created_at timestamptz, last_sent_at timestamptz,
  expires_at timestamptz, consumed_at timestamptz
)
language sql
security definer
set search_path = app_private, pg_catalog
as $$
  select id, email, user_id, purpose, attempts,
         created_at, last_sent_at, expires_at, consumed_at
    from app_private.auth_challenges
   where id = p_id;
$$;

revoke all on function public.svc_challenge_get from public, anon, authenticated;
grant execute on function public.svc_challenge_get to service_role;

-- The whole state machine in one transaction, under a row lock.
--
-- Doing this as read-then-compare-then-update in JavaScript leaves a race: two
-- requests submitting the same wrong code both read attempts=4, both write 5,
-- and the cap silently becomes six. `for update` serialises them, so every
-- guess is counted exactly once.
create or replace function public.svc_challenge_claim(p_id uuid, p_code_hash text)
returns table (ok boolean, reason text, attempts integer, email text, purpose text, user_id uuid)
language plpgsql
security definer
set search_path = app_private, pg_catalog
as $$
declare
  c app_private.auth_challenges%rowtype;
begin
  select * into c from app_private.auth_challenges where id = p_id for update;

  if not found then
    return query select false, 'missing', 0, null::text, null::text, null::uuid;
    return;
  end if;
  if c.consumed_at is not null then
    return query select false, 'consumed', c.attempts, c.email, c.purpose, c.user_id;
    return;
  end if;
  if c.attempts >= 5 then
    return query select false, 'locked', c.attempts, c.email, c.purpose, c.user_id;
    return;
  end if;
  if c.expires_at <= now() then
    return query select false, 'expired', c.attempts, c.email, c.purpose, c.user_id;
    return;
  end if;

  if c.code_hash <> p_code_hash then
    -- Table-qualified on purpose. `attempts` is also the name of one of this
    -- function's RETURNS TABLE columns, and plpgsql resolves a bare reference
    -- to that output parameter instead of the column — "column reference
    -- "attempts" is ambiguous", raised on every wrong guess and only on a
    -- wrong guess, since no other branch writes to the row.
    update app_private.auth_challenges
       set attempts = auth_challenges.attempts + 1
     where id = p_id
    returning auth_challenges.attempts into c.attempts;
    return query select false,
                        case when c.attempts >= 5 then 'locked' else 'wrong' end,
                        c.attempts, c.email, c.purpose, c.user_id;
    return;
  end if;

  update app_private.auth_challenges set consumed_at = now() where id = p_id;
  return query select true, 'ok', c.attempts, c.email, c.purpose, c.user_id;
end;
$$;

revoke all on function public.svc_challenge_claim from public, anon, authenticated;
grant execute on function public.svc_challenge_claim to service_role;

-- Rotating deliberately does NOT reset `attempts`: otherwise "resend" is an
-- unlimited supply of guesses and the five-attempt cap means nothing.
create or replace function public.svc_challenge_rotate(p_id uuid, p_code_hash text, p_expires_at timestamptz)
returns void
language sql
security definer
set search_path = app_private, pg_catalog
as $$
  update app_private.auth_challenges
     set code_hash = p_code_hash, expires_at = p_expires_at, last_sent_at = now()
   where id = p_id and consumed_at is null;
$$;

revoke all on function public.svc_challenge_rotate from public, anon, authenticated;
grant execute on function public.svc_challenge_rotate to service_role;

create or replace function public.svc_challenge_purge(p_email text)
returns void
language sql
security definer
set search_path = app_private, pg_catalog
as $$
  delete from app_private.auth_challenges where email = p_email;
$$;

revoke all on function public.svc_challenge_purge from public, anon, authenticated;
grant execute on function public.svc_challenge_purge to service_role;

-- ---------------------------------------------------------------------------
-- Trusted devices
-- ---------------------------------------------------------------------------

create or replace function public.svc_device_trust(
  p_user_id    uuid,
  p_token_hash text,
  p_label      text,
  p_expires_at timestamptz
)
returns void
language sql
security definer
set search_path = app_private, pg_catalog
as $$
  insert into app_private.trusted_devices (user_id, token_hash, label, expires_at)
  values (p_user_id, p_token_hash, p_label, p_expires_at)
  on conflict (token_hash) do update
    set expires_at = excluded.expires_at, last_seen_at = now();
$$;

revoke all on function public.svc_device_trust from public, anon, authenticated;
grant execute on function public.svc_device_trust to service_role;

-- Matched on the user id as well as the token, so a token issued for one
-- account can never wave through a sign-in to another.
create or replace function public.svc_device_check(p_token_hash text, p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = app_private, pg_catalog
as $$
declare
  d app_private.trusted_devices%rowtype;
begin
  select * into d
    from app_private.trusted_devices
   where token_hash = p_token_hash and user_id = p_user_id;

  if not found then return false; end if;

  if d.expires_at <= now() then
    delete from app_private.trusted_devices where id = d.id;
    return false;
  end if;

  update app_private.trusted_devices set last_seen_at = now() where id = d.id;
  return true;
end;
$$;

revoke all on function public.svc_device_check from public, anon, authenticated;
grant execute on function public.svc_device_check to service_role;

create or replace function public.svc_device_forget_all(p_user_id uuid)
returns void
language sql
security definer
set search_path = app_private, pg_catalog
as $$
  delete from app_private.trusted_devices where user_id = p_user_id;
$$;

revoke all on function public.svc_device_forget_all from public, anon, authenticated;
grant execute on function public.svc_device_forget_all to service_role;

create or replace function public.svc_auth_purge_expired()
returns void
language sql
security definer
set search_path = app_private, pg_catalog
as $$
  delete from app_private.auth_challenges where expires_at < now();
  delete from app_private.trusted_devices where expires_at < now();
$$;

revoke all on function public.svc_auth_purge_expired from public, anon, authenticated;
grant execute on function public.svc_auth_purge_expired to service_role;


-- ===========================================================================
-- PART 2 — credential vault entry points (skipped if not applicable)
-- ===========================================================================

do $outer$
begin
  if to_regprocedure('app_private.read_connection_secret(uuid)') is null then
    raise notice 'Skipping the vault wrappers: this project has no app_private.read_connection_secret. Sign-in is unaffected. Apply supabase/migrations/2026082111*.sql if you want saved database connections.';
  else
    execute $vault$

create or replace function public.svc_upsert_connection_secret(
  p_org_id      uuid,
  p_name        text,
  p_source      text,
  p_config      jsonb,
  p_created_by  uuid,
  p_ciphertext  bytea,
  p_iv          bytea,
  p_auth_tag    bytea,
  p_dek_wrapped bytea,
  p_dek_iv      bytea,
  p_dek_tag     bytea,
  p_key_version integer,
  p_connection_id uuid default null
)
returns uuid
language sql
security definer
set search_path = public, app_private, pg_catalog
as $fn$
  select app_private.upsert_connection_secret(
    p_org_id, p_name, p_source, p_config, p_created_by,
    p_ciphertext, p_iv, p_auth_tag, p_dek_wrapped, p_dek_iv, p_dek_tag,
    p_key_version, p_connection_id
  );
$fn$;

revoke all on function public.svc_upsert_connection_secret from public, anon, authenticated;
grant execute on function public.svc_upsert_connection_secret to service_role;

create or replace function public.svc_read_connection_secret(p_connection_id uuid)
returns table (
  ciphertext bytea, iv bytea, auth_tag bytea,
  dek_wrapped bytea, dek_iv bytea, dek_tag bytea,
  key_version integer
)
language sql
security definer
set search_path = public, app_private, pg_catalog
as $fn$
  select * from app_private.read_connection_secret(p_connection_id);
$fn$;

revoke all on function public.svc_read_connection_secret from public, anon, authenticated;
grant execute on function public.svc_read_connection_secret to service_role;

create or replace function public.svc_delete_connection_secret(p_connection_id uuid)
returns void
language sql
security definer
set search_path = app_private, pg_catalog
as $fn$
  delete from app_private.connection_secrets where connection_id = p_connection_id;
$fn$;

revoke all on function public.svc_delete_connection_secret from public, anon, authenticated;
grant execute on function public.svc_delete_connection_secret to service_role;


    $vault$;
    raise notice 'Vault entry points installed.';
  end if;
end
$outer$;

-- Make everything visible to the REST layer immediately.
notify pgrst, 'reload schema';

-- Readiness check. The six svc_challenge_*/svc_device_* rows are what sign-in
-- needs; every row should read true, true.
select p.proname,
       has_function_privilege('service_role', p.oid, 'execute') as server_can_call,
       not has_function_privilege('anon', p.oid, 'execute')     as browser_blocked
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname like 'svc\_%'
 order by 1;
