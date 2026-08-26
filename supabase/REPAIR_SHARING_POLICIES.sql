-- ===========================================================================
-- Diagnose and repair the row-level-security policies for the library.
--
-- Symptom this fixes: reading the library works, but saving fails with
-- "new row violates row-level security policy for table analyses" (42501).
-- That means the tables and the SELECT policy applied but the INSERT policy
-- did not — a half-applied run.
--
-- Safe to run any number of times: every policy is dropped and recreated.
-- ===========================================================================

-- 1. What is there now, before any change.
select 'BEFORE' as stage, tablename, policyname, cmd
  from pg_policies
 where schemaname = 'public'
   and tablename in ('profiles', 'analyses', 'analysis_shares')
 order by tablename, policyname;

-- 2. Recreate all eight, unconditionally.
drop policy if exists profiles_read      on public.profiles;
drop policy if exists profiles_write_own on public.profiles;
drop policy if exists analyses_read      on public.analyses;
drop policy if exists analyses_insert    on public.analyses;
drop policy if exists analyses_update    on public.analyses;
drop policy if exists analyses_delete    on public.analyses;
drop policy if exists shares_read        on public.analysis_shares;
drop policy if exists shares_write       on public.analysis_shares;

create policy profiles_read on public.profiles
  for select to authenticated using (true);

create policy profiles_write_own on public.profiles
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy analyses_read on public.analyses
  for select to authenticated
  using (owner_id = auth.uid() or app_private.can_read_analysis(id));

create policy analyses_insert on public.analyses
  for insert to authenticated with check (owner_id = auth.uid());

create policy analyses_update on public.analyses
  for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy analyses_delete on public.analyses
  for delete to authenticated using (owner_id = auth.uid());

create policy shares_read on public.analysis_shares
  for select to authenticated
  using (shared_with = auth.uid() or app_private.owns_analysis(analysis_id));

create policy shares_write on public.analysis_shares
  for all to authenticated
  using (app_private.owns_analysis(analysis_id))
  with check (app_private.owns_analysis(analysis_id));

-- The policies call these, and a function is unreachable without USAGE on its
-- schema even when EXECUTE is granted.
grant usage on schema app_private to authenticated;
grant execute on function app_private.can_read_analysis to authenticated;
grant execute on function app_private.owns_analysis     to authenticated;

notify pgrst, 'reload schema';

-- 3. What is there now. Expect eight rows: 2 profiles, 4 analyses, 2 shares.
select 'AFTER' as stage, tablename, policyname, cmd
  from pg_policies
 where schemaname = 'public'
   and tablename in ('profiles', 'analyses', 'analysis_shares')
 order by tablename, policyname;
