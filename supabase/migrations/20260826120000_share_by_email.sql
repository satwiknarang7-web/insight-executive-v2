-- Remember what the owner typed when they shared.
--
-- An analysis can now be shared by email address as well as by username, which
-- means a recipient no longer necessarily has a row in `public.profiles` — and
-- the owner's "shared with" list reads that table for the name to display. So
-- someone shared with by address, before they picked a username, showed up as
-- an anonymous row in a list the owner is supposed to be able to manage.
--
-- The value is only ever what the owner already knew: the username they typed,
-- or the address they typed. It is readable by the two people the existing
-- `shares_read` policy already lets read the row — the owner and the recipient —
-- so this publishes nothing to anyone new.

alter table public.analysis_shares
  add column if not exists shared_as text
  check (shared_as is null or length(shared_as) between 3 and 320);

comment on column public.analysis_shares.shared_as is
  'The username or email address the owner used when sharing. Display only; authorisation is shared_with.';

notify pgrst, 'reload schema';
