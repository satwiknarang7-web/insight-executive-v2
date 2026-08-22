-- Phase 0, migration 2: the connection vault.
--
-- Split deliberately across two schemas. `public.connections` holds the
-- metadata a user needs to see -- what the connection is called, what it points
-- at -- and is readable by their organisation through RLS. Everything that
-- authenticates lives in `app_private`, a schema that is NOT exposed through
-- the REST API, has its grants revoked, and carries a deny-all RLS policy set.
--
-- The effect is that a browser cannot reach a secret even if a policy is later
-- written carelessly: the table is not addressable from the API at all. Only
-- the service role, held solely by the server, can read it.

create table public.connections (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  name         text not null check (length(trim(name)) > 0),
  source       text not null check (source in (
                 'postgres', 'supabase', 'mysql', 'sqlserver',
                 'oracle', 'snowflake', 'fabric', 'tableau')),
  -- Non-secret detail only: host, port, database, warehouse, role, schema.
  -- Anything that authenticates belongs in app_private.connection_secrets.
  config       jsonb not null default '{}'::jsonb,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz,
  unique (org_id, name)
);

create index connections_org_id_idx on public.connections (org_id);

alter table public.connections enable row level security;

create policy connections_read on public.connections
  for select using (org_id in (select public.current_org_ids()));

create policy connections_admin_write on public.connections
  for all using (public.is_org_admin(org_id)) with check (public.is_org_admin(org_id));

create function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger connections_touch_updated_at
  before update on public.connections
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Secrets
-- ---------------------------------------------------------------------------

create schema app_private;
revoke all on schema app_private from public;
revoke all on schema app_private from anon, authenticated;

create table app_private.connection_secrets (
  connection_id uuid primary key references public.connections(id) on delete cascade,
  -- AES-256-GCM envelope. The master key lives in the host environment, never
  -- in this database -- otherwise compromising the database compromises the key
  -- along with it, and the encryption is decoration.
  ciphertext    bytea not null,
  iv            bytea not null,
  auth_tag      bytea not null,
  -- Rotation: a re-encrypted row bumps this, so old and new keys can coexist
  -- while a rotation runs rather than invalidating every stored credential.
  key_version   integer not null default 1,
  updated_at    timestamptz not null default now()
);

revoke all on app_private.connection_secrets from public;
revoke all on app_private.connection_secrets from anon, authenticated;

-- RLS with zero policies denies every non-bypassing role outright. The service
-- role bypasses RLS, which is exactly the one path that should reach this.
alter table app_private.connection_secrets enable row level security;

comment on schema app_private is 'Not exposed through PostgREST. Server-only, service-role access.';
comment on table public.connections is 'Connection metadata. Never stores anything that authenticates.';
comment on table app_private.connection_secrets is 'Encrypted credentials. Plaintext exists only in the connector runtime, per request.';
