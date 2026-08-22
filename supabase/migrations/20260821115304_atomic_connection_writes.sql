-- Phase 0, migration 6: write the connection and its secret atomically.
--
-- Creating a connection touches two tables in two schemas. The Supabase client
-- cannot open a transaction across two calls, so doing it from JavaScript means
-- a window where the metadata row exists with no credential behind it -- a
-- connection that looks usable and is not. Compensating deletes narrow that
-- window but do not close it.
--
-- A function closes it: one statement, one transaction, both rows or neither.

create function app_private.upsert_connection_secret(
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
language plpgsql
security definer
set search_path = public, app_private, pg_catalog
as $$
declare
  v_id uuid;
begin
  if p_connection_id is null then
    insert into public.connections (org_id, name, source, config, created_by)
    values (p_org_id, p_name, p_source, p_config, p_created_by)
    returning id into v_id;
  else
    update public.connections
       set name = p_name, source = p_source, config = p_config
     where id = p_connection_id and org_id = p_org_id
    returning id into v_id;

    if v_id is null then
      raise exception 'Connection % not found in organisation %', p_connection_id, p_org_id;
    end if;
  end if;

  insert into app_private.connection_secrets
    (connection_id, ciphertext, iv, auth_tag, dek_wrapped, dek_iv, dek_tag, key_version)
  values
    (v_id, p_ciphertext, p_iv, p_auth_tag, p_dek_wrapped, p_dek_iv, p_dek_tag, p_key_version)
  on conflict (connection_id) do update set
    ciphertext  = excluded.ciphertext,
    iv          = excluded.iv,
    auth_tag    = excluded.auth_tag,
    dek_wrapped = excluded.dek_wrapped,
    dek_iv      = excluded.dek_iv,
    dek_tag     = excluded.dek_tag,
    key_version = excluded.key_version,
    updated_at  = now();

  return v_id;
end;
$$;

-- Only the server may call this. It writes credentials and takes the
-- organisation as a parameter, so an authenticated caller reaching it directly
-- could write into someone else's tenant -- authorisation happens in the
-- server before the call, never here.
revoke all on function app_private.upsert_connection_secret from public;
revoke all on function app_private.upsert_connection_secret from anon, authenticated;
grant execute on function app_private.upsert_connection_secret to service_role;

-- Reading a secret is equally service-role only.
create function app_private.read_connection_secret(p_connection_id uuid)
returns table (
  ciphertext bytea, iv bytea, auth_tag bytea,
  dek_wrapped bytea, dek_iv bytea, dek_tag bytea, key_version integer
)
language sql
security definer
set search_path = app_private, pg_catalog
as $$
  select ciphertext, iv, auth_tag, dek_wrapped, dek_iv, dek_tag, key_version
  from app_private.connection_secrets
  where connection_id = p_connection_id;
$$;

revoke all on function app_private.read_connection_secret from public;
revoke all on function app_private.read_connection_secret from anon, authenticated;
grant execute on function app_private.read_connection_secret to service_role;

comment on function app_private.upsert_connection_secret is 'Server-only. Writes metadata and credential in one transaction. Does NOT authorise -- the caller must.';
comment on function app_private.read_connection_secret is 'Server-only. Does NOT authorise -- the caller must check membership first.';
