-- Phase 0, migration 4: take the RLS helpers off the public API.
--
-- `current_org_ids()` and `is_org_admin()` are internals of the policy layer,
-- but living in `public` made them callable as REST endpoints at
-- /rest/v1/rpc/... by anon and authenticated alike. Neither leaks another
-- user's data -- both are scoped to auth.uid() -- but an internal helper should
-- not be an API endpoint, and `is_org_admin` in particular lets a caller probe
-- arbitrary organisation ids.
--
-- Simply revoking EXECUTE would break every policy: RLS expressions run with
-- the querying user's privileges, so the caller must be able to execute the
-- function the policy depends on. The fix is to move them into `app_private`,
-- which PostgREST does not expose, and grant EXECUTE there instead.

create function app_private.current_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select org_id from public.memberships where user_id = auth.uid();
$$;

create function app_private.is_org_admin(target uuid)
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

-- USAGE on the schema is required to call a function inside it. It does not
-- grant table access -- those grants stay revoked, and connection_secrets keeps
-- its deny-all RLS -- and it does not add the schema to the exposed API.
grant usage on schema app_private to authenticated, service_role;

revoke all on function app_private.current_org_ids() from public;
revoke all on function app_private.is_org_admin(uuid) from public;
grant execute on function app_private.current_org_ids() to authenticated, service_role;
grant execute on function app_private.is_org_admin(uuid) to authenticated, service_role;

-- Repoint every policy before dropping the old functions.
alter policy organizations_read on public.organizations
  using (id in (select app_private.current_org_ids()));

alter policy organizations_update on public.organizations
  using (app_private.is_org_admin(id)) with check (app_private.is_org_admin(id));

alter policy memberships_read on public.memberships
  using (org_id in (select app_private.current_org_ids()));

alter policy memberships_admin_write on public.memberships
  using (app_private.is_org_admin(org_id)) with check (app_private.is_org_admin(org_id));

alter policy connections_read on public.connections
  using (org_id in (select app_private.current_org_ids()));

alter policy connections_admin_write on public.connections
  using (app_private.is_org_admin(org_id)) with check (app_private.is_org_admin(org_id));

alter policy connection_audit_read on public.connection_audit
  using (org_id in (select app_private.current_org_ids()));

drop function public.current_org_ids();
drop function public.is_org_admin(uuid);

comment on function app_private.current_org_ids is 'RLS helper. Lives outside the API schema so it is not callable as an RPC endpoint.';
comment on function app_private.is_org_admin is 'RLS helper. Scoped to auth.uid(); never reveals another user''s membership.';
