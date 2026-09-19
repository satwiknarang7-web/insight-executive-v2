-- When each user last looked at their notifications.
--
-- Deliberately *not* a notifications table. The event this app needs to notify
-- anybody about already exists and is already correct: `analysis_shares` holds
-- one row per (analysis, recipient) with the moment it was granted, and the
-- recipient can already read it. Writing a second copy of that into a feed
-- table would add a way for the two to disagree — a share revoked and the
-- notification left behind, a notification written and the share rolled back —
-- in exchange for nothing the shares table cannot answer.
--
-- What is genuinely missing is one timestamp per person: how far down the list
-- they have read. That is this table, and it is the whole of it. A share newer
-- than `seen_at` is unread; there is nothing to backfill, and notifications
-- work for shares created long before this migration ran.
--
-- The cost of the shape is that "mark this one read" is not expressible, only
-- "I have seen everything up to now" — which is what opening a bell menu means
-- in every product that has one.

create table if not exists public.notification_reads (
  user_id uuid primary key references auth.users(id) on delete cascade,
  seen_at timestamptz not null default now()
);

alter table public.notification_reads enable row level security;

-- Your own marker and nobody else's. There is no owner/recipient split here
-- and no reason for one user to read another's: unlike a share, this row is
-- not about a relationship between two people.
drop policy if exists notification_reads_own on public.notification_reads;
create policy notification_reads_own on public.notification_reads
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Explicit, for the same reason the sharing migration says: an RLS policy on a
-- table the role cannot see surfaces as "Could not find the table in the schema
-- cache", which points at the wrong bug.
grant select, insert, update, delete on public.notification_reads to authenticated;

comment on table public.notification_reads is
  'How far down their notifications each user has read. The notifications themselves are rows in analysis_shares.';
