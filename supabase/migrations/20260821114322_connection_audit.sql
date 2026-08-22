-- Phase 0, migration 3: the audit trail.
--
-- A vault is not finished when it stores something. Knowing who read which
-- credential, and when, is the difference between a vault and a table full of
-- secrets -- and it is the first thing anyone asks for after an incident.

create table public.connection_audit (
  id            bigint generated always as identity primary key,
  org_id        uuid not null references public.organizations(id) on delete cascade,
  connection_id uuid references public.connections(id) on delete set null,
  user_id       uuid references auth.users(id) on delete set null,
  action        text not null check (action in (
                  'created', 'updated', 'tested', 'used',
                  'secret_read', 'revoked', 'deleted')),
  -- Never the credential, and never anything derived from it: host and query
  -- shape at most.
  detail        jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

create index connection_audit_org_time_idx  on public.connection_audit (org_id, created_at desc);
create index connection_audit_conn_time_idx on public.connection_audit (connection_id, created_at desc);

alter table public.connection_audit enable row level security;

create policy connection_audit_read on public.connection_audit
  for select using (org_id in (select public.current_org_ids()));

-- Deliberately no INSERT policy. Only the server writes audit rows, so a client
-- cannot forge or backdate them, and a compromised browser session cannot cover
-- its own tracks.

comment on table public.connection_audit is 'Append-only from the server. Clients may read their organisation''s entries, never write them.';
