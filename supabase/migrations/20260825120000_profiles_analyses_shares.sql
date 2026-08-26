-- Saved analyses, the handles people share them by, and the shares themselves.
--
-- Three tables in `public` rather than `app_private`, because unlike a stored
-- credential these are things a signed-in user is *supposed* to read through
-- the API — their own, plus whatever has been shared with them. That makes RLS
-- the actual control here, so each policy below is load-bearing.

-- ---------------------------------------------------------------------------
-- Handles
-- ---------------------------------------------------------------------------

-- Sharing needs a name a person can type. An email address would work but
-- publishes one user's address to another; a handle is the usual answer and
-- reveals nothing that was not chosen for the purpose.
create table public.profiles (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  handle       text not null unique check (handle ~ '^[a-z0-9_]{3,24}$'),
  display_name text check (display_name is null or length(trim(display_name)) between 1 and 60),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index profiles_handle_idx on public.profiles (handle);

alter table public.profiles enable row level security;

-- Every signed-in user can look up a handle: that is what makes "share with
-- @sam" possible at all. Only non-sensitive columns live in this table for
-- exactly that reason.
create policy profiles_read on public.profiles
  for select to authenticated using (true);

create policy profiles_write_own on public.profiles
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Saved analyses
-- ---------------------------------------------------------------------------

-- Only what the user chose to keep. Nothing is written here automatically:
-- an analysis lives in the browser until someone presses Save, which is what
-- keeps this from becoming a silent archive of every file anyone opened.
create table public.analyses (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references auth.users(id) on delete cascade,
  title        text not null check (length(trim(title)) > 0),
  dataset_name text,
  row_count    integer,
  -- The storyboard, summary, KPIs and measures — the analysis, not the data.
  -- Chart result sets are already aggregated; raw rows are never stored.
  payload      jsonb not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index analyses_owner_idx on public.analyses (owner_id, updated_at desc);

alter table public.analyses enable row level security;

-- ---------------------------------------------------------------------------
-- Shares
-- ---------------------------------------------------------------------------

create table public.analysis_shares (
  analysis_id uuid not null references public.analyses(id) on delete cascade,
  shared_with uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (analysis_id, shared_with)
);

create index analysis_shares_user_idx on public.analysis_shares (shared_with);

alter table public.analysis_shares enable row level security;

-- A policy on `analyses` that queries `analysis_shares`, and a policy on
-- `analysis_shares` that queries `analyses`, would recurse through each other.
-- SECURITY DEFINER breaks the cycle; the pinned search_path stops the function
-- being hijacked by a shadowing table.
create function app_private.can_read_analysis(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1 from public.analyses a where a.id = target and a.owner_id = auth.uid()
  ) or exists (
    select 1 from public.analysis_shares s where s.analysis_id = target and s.shared_with = auth.uid()
  );
$$;

grant execute on function app_private.can_read_analysis to authenticated;

create function app_private.owns_analysis(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1 from public.analyses a where a.id = target and a.owner_id = auth.uid()
  );
$$;

grant execute on function app_private.owns_analysis to authenticated;

-- Read what you own or what was shared with you; write only what you own.
-- The owner check is inline, and must stay inline: `can_read_analysis`
-- re-queries this table, and during INSERT ... RETURNING the new row is not yet
-- visible to its snapshot, so every save would be denied with 42501. Comparing
-- owner_id on the row being returned needs no self-query. The shared case still
-- goes through the function, which is what breaks the policy recursion.
create policy analyses_read on public.analyses
  for select to authenticated
  using (owner_id = auth.uid() or app_private.can_read_analysis(id));

create policy analyses_insert on public.analyses
  for insert to authenticated with check (owner_id = auth.uid());

create policy analyses_update on public.analyses
  for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy analyses_delete on public.analyses
  for delete to authenticated using (owner_id = auth.uid());

-- Both sides of a share may see it: the owner to manage it, the recipient to
-- know why an analysis is in their list and who put it there.
create policy shares_read on public.analysis_shares
  for select to authenticated
  using (shared_with = auth.uid() or app_private.owns_analysis(analysis_id));

-- Only the owner grants or revokes access.
create policy shares_write on public.analysis_shares
  for all to authenticated
  using (app_private.owns_analysis(analysis_id))
  with check (app_private.owns_analysis(analysis_id));

create trigger analyses_touch_updated_at
  before update on public.analyses
  for each row execute function public.touch_updated_at();

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- Explicit grants: an RLS policy on a table the role cannot see surfaces as
-- "Could not find the table in the schema cache", which points at the wrong bug.
grant select, insert, update, delete on public.profiles        to authenticated;
grant select, insert, update, delete on public.analyses        to authenticated;
grant select, insert, update, delete on public.analysis_shares to authenticated;

comment on table public.profiles is 'Public handle per user, so analyses can be shared without exposing email addresses.';
comment on table public.analyses is 'Analyses a user explicitly saved. Never written automatically.';
comment on table public.analysis_shares is 'Who else may open a saved analysis.';
