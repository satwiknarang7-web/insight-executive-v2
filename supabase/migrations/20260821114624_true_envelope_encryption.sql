-- Phase 0, migration 5: make the envelope real.
--
-- Migration 2 stored a single ciphertext encrypted directly under the master
-- key and called it envelope encryption. It was not. The difference is entirely
-- about rotation: with one key encrypting everything, rotating it means
-- decrypting and re-encrypting every credential in the vault -- a migration
-- that must not be interrupted, run against exactly the secrets you least want
-- to corrupt.
--
-- With a real envelope, each credential gets its own random data key (DEK). The
-- credential is encrypted under the DEK; the DEK is encrypted under the master
-- key (KEK). Rotating the master key then means re-wrapping a handful of small
-- keys, never touching the credential ciphertext at all.

alter table app_private.connection_secrets
  add column dek_wrapped bytea,
  add column dek_iv      bytea,
  add column dek_tag     bytea;

-- The table is empty, so the columns can be made mandatory immediately. Doing
-- this later, with rows in place, would need a backfill.
alter table app_private.connection_secrets
  alter column dek_wrapped set not null,
  alter column dek_iv      set not null,
  alter column dek_tag     set not null;

comment on column app_private.connection_secrets.ciphertext  is 'Credential JSON, AES-256-GCM under the per-credential DEK.';
comment on column app_private.connection_secrets.dek_wrapped is 'The DEK itself, AES-256-GCM under the master key. Rotation re-wraps this and nothing else.';
comment on column app_private.connection_secrets.key_version is 'Which master key wrapped the DEK. Lets an old and a new key coexist during a rotation.';
