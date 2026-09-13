-- ---------------------------------------------------------------------------
-- Which plan an account is on, and therefore whether it may reach a model.
-- ---------------------------------------------------------------------------
--
-- A separate table from `public.profiles`, deliberately. A profile row only
-- exists once someone claims a handle, and most people never do — a gate that
-- depends on an optional row is a gate with a hole in it. Every confirmed
-- account gets a row here, written by the server at the moment the address is
-- verified.
--
-- The browser may read its own plan and may not write any plan. There is no
-- INSERT or UPDATE policy for `authenticated` at all, so a free account cannot
-- promote itself by calling PostgREST directly — which it otherwise could, the
-- API being public and the anon key being in every page. The only way in is the
-- service-role entrypoint at the bottom of this file.
--
-- Upgrading is therefore always a server decision. Today the upgrade screen
-- grants it outright, because nothing charges yet; when a payment provider is
-- added, its webhook calls the same function and nothing else has to change.

create table public.account_plans (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  plan       text not null default 'free' check (plan in ('free', 'pro')),
  chosen_at  timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.account_plans enable row level security;

-- Your own plan, and nobody else's. What someone pays is not public the way a
-- handle is, and no feature needs to read another user's tier.
create policy account_plans_read_own on public.account_plans
  for select to authenticated using (user_id = auth.uid());

-- Supabase's default privileges hand `authenticated` full DML on every new
-- table in `public`, so granting SELECT is not the same as granting only
-- SELECT. RLS would still refuse a write — there is no policy for one — but a
-- table whose grants say INSERT and whose policies say otherwise is a gate held
-- shut by one lock when it was meant to have two. Take the rest away.
revoke all on public.account_plans from anon, authenticated;
grant select on public.account_plans to authenticated;

create trigger account_plans_touch_updated_at
  before update on public.account_plans
  for each row execute function public.touch_updated_at();

comment on table public.account_plans is
  'One row per confirmed account. Readable by its owner, writable only by the service role.';

-- ---------------------------------------------------------------------------
-- The only writer
-- ---------------------------------------------------------------------------

create function public.svc_set_account_plan(p_user_id uuid, p_plan text)
returns text
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if p_plan is null or p_plan not in ('free', 'pro') then
    raise exception 'unknown plan: %', coalesce(p_plan, 'null');
  end if;

  insert into public.account_plans (user_id, plan)
  values (p_user_id, p_plan)
  on conflict (user_id) do update
    set plan = excluded.plan,
        updated_at = now();

  return p_plan;
end;
$$;

revoke all on function public.svc_set_account_plan(uuid, text) from public;
revoke all on function public.svc_set_account_plan(uuid, text) from anon, authenticated;
grant execute on function public.svc_set_account_plan(uuid, text) to service_role;

comment on function public.svc_set_account_plan(uuid, text) is
  'Set an account plan. Service role only — this is where a payment webhook will call in.';
