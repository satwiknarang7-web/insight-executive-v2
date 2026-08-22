-- Phase 0, migration 1: organisations and membership.
--
-- There is exactly one organisation in a self-hosted deployment, but the column
-- and its row-level security exist from the first migration so that a hosted,
-- multi-tenant version never has to retrofit tenant isolation onto a live
-- credential store.

create table public.organizations (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(trim(name)) > 0),
  created_at timestamptz not null default now()
);

create table public.memberships (
  user_id    uuid not null references auth.users(id) on delete cascade,
  org_id     uuid not null references public.organizations(id) on delete cascade,
  role       text not null default 'member' check (role in ('owner', 'admin', 'member')),
  created_at timestamptz not null default now(),
  primary key (user_id, org_id)
);

create index memberships_org_id_idx on public.memberships (org_id);

-- SECURITY DEFINER matters here: a policy on `memberships` that queries
-- `memberships` would recurse into its own policy forever. Running as the
-- definer bypasses that, and the pinned search_path stops the function being
-- hijacked by a shadowing table on someone else's path.
create function public.current_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select org_id from public.memberships where user_id = auth.uid();
$$;

create function public.is_org_admin(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1
    from public.memberships
    where user_id = auth.uid()
      and org_id = target
      and role in ('owner', 'admin')
  );
$$;

alter table public.organizations enable row level security;
alter table public.memberships   enable row level security;

create policy organizations_read on public.organizations
  for select using (id in (select public.current_org_ids()));

create policy organizations_update on public.organizations
  for update using (public.is_org_admin(id)) with check (public.is_org_admin(id));

create policy memberships_read on public.memberships
  for select using (org_id in (select public.current_org_ids()));

create policy memberships_admin_write on public.memberships
  for all using (public.is_org_admin(org_id)) with check (public.is_org_admin(org_id));

-- Deliberately no INSERT policy on organizations: creating one is a server
-- operation performed with the service role, so a client cannot mint itself a
-- tenant.

comment on table public.organizations is 'Tenant boundary. One row in a self-hosted deployment; many in a hosted one.';
comment on table public.memberships is 'Which users belong to which organisation, and with what authority.';
